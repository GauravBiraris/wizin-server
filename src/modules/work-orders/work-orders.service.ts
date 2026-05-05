// src/modules/work-orders/work-orders.service.ts
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { eq, desc, asc, and, inArray, or, gte, lte, sql, ne } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '../../db/schema';
import { ProductLinesService } from '../product-lines/product-lines.service';  
import { NotificationsService } from '../notifications/notifications.service';

export interface CompleteWorkOrderDto {
  userId: string; // The operator completing the batch
  actualYield: number; // QC Passed units
  rejectedYield: number; // QC Failed units
  rejectedProductId?: string; // The SKU representing the scrap/reject pile
  
  // Mapping for the Financial Bucket (These should be fetched/configured at the tenant level)
  accountMapping: {
    finishedGoodsAssetId: string;
    rawMaterialAssetId: string;
    wagesPayableId: string;
    machineOverheadId: string;
    utilitiesPayableId: string;
    vendorPayableId: string;
  };
}

@Injectable()
export class WorkOrdersService {
    // Inject the ProductLinesService
  constructor(private readonly productLinesService: ProductLinesService, private readonly notificationsService: NotificationsService) {}
  
  async findAll(tenantId: string, startDate?: string, endDate?: string) {
    // 1. Base Query with new 'actualYield' column
    const baseQuery = db.select({
      id: schema.workOrders.id,
      batchNumber: schema.workOrders.batchNumber,
      targetQuantity: schema.workOrders.targetQuantity,
      actualYield: schema.workOrders.actualYield,  
      status: schema.workOrders.status,
      createdAt: schema.workOrders.createdAt,
      productLineName: schema.productLines.name,
      mainProductName: schema.products.name,
    })
    .from(schema.workOrders)
    .innerJoin(schema.productLines, eq(schema.workOrders.productLineId, schema.productLines.id))
    .leftJoin(schema.products, eq(schema.productLines.mainProductId, schema.products.id));

    // 2. Apply Date Range OR Default Limit
    if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0,0,0,0);
      const end = new Date(endDate); end.setHours(23,59,59,999);

      return await baseQuery
        .where(and(
          eq(schema.workOrders.tenantId, tenantId),
          gte(schema.workOrders.createdAt, start),
          lte(schema.workOrders.createdAt, end)
        ))
        .orderBy(desc(schema.workOrders.createdAt));
    } else {
      // Default: Only fetch the last 15 batches to save resources
      return await baseQuery
        .where(eq(schema.workOrders.tenantId, tenantId))
        .orderBy(desc(schema.workOrders.createdAt))
        .limit(15);
    }
  }

  async create(tenantId: string, dto: { productLineId: string; targetQuantity: number }, userEmail: string = 'System') {
    const targetQty = dto.targetQuantity;
    const batchNumber = `BATCH-${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;

    // 1. Fetch the deep recipe with all costs and base quantities
    const recipe = await this.productLinesService.findOne(dto.productLineId, tenantId);
    if (!recipe) throw new NotFoundException("Recipe not found");

    const baseQty = Number(recipe.baseQuantity);
    
    // 2. The Core Scaling Logic
    const integerBatches = Math.ceil(targetQty / baseQty);
    const linearRatio = targetQty / baseQty;

    return await db.transaction(async (tx) => {
      // 3. Create the Work Order
      const [newOrder] = await tx.insert(schema.workOrders).values({
        tenantId,
        productLineId: dto.productLineId,
        batchNumber,
        targetQuantity: targetQty.toString(),
        status: 'planned',
      }).returning();

      // FIX 1: Explicitly tell TypeScript this array can hold our objects
      const requirements: any[] = [];

      // 4. Calculate exact requirements based on resource type
      for (const step of recipe.steps) {
        for (const input of step.inputs) {
          const isRawMaterial = input.resourceType === 'raw_material';
          
          const requiredQty = isRawMaterial 
            ? Number(input.quantity) * linearRatio 
            : Number(input.quantity) * integerBatches;
          
          const estimatedCost = requiredQty * Number(input.rate);

          // UOM Fix: Fallback to 'hr' for labor and machines if undefined
          const explicitUom = input.uom || (['machine', 'labor'].includes(input.resourceType) ? 'hr' : 'units');

          // FIX 2: Safely extract the name depending on which resource type it is
          const unifiedResourceName = 
            input.rawMaterialName || 
            input.laborTitle || 
            input.machineName || 
            input.utilityName || 
            input.vendorName || 
            'Unknown Resource';

          requirements.push({
            tenantId,
            workOrderId: newOrder.id,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            resourceName: unifiedResourceName,
            plannedQuantity: requiredQty.toString(),
            uom: explicitUom,
            estimatedCost: estimatedCost.toString()
          });
        }
        if (step.outputs) {
          for (const output of step.outputs) {
            // Outputs always scale linearly with the target batch
            const expectedYield = Number(output.quantity) * linearRatio;
            
            requirements.push({
              tenantId, workOrderId: newOrder.id, resourceType: 'product_output', // Distinct tag
              resourceId: output.productId, resourceName: output.resourceName || 'Product',
              plannedQuantity: expectedYield.toString(), uom: output.uom || 'units',
              estimatedCost: '0.00' // Cost is calculated against inputs, not outputs here
            });
          }
        }
      }

      // 5. Freeze the requirements into the database
      if (requirements.length > 0) {
        await tx.insert(schema.workOrderRequirements).values(requirements);
      }

      // 4. Auto-Generate the Sub-Batches (Runs)
      const runs: any[] = [];
      for (let i = 1; i <= integerBatches; i++) {
        runs.push({
          tenantId,
          workOrderId: newOrder.id,
          runSequence: i,
          status: 'planned' as const
        });
      }
      await tx.insert(schema.workOrderRuns).values(runs);

      // 5. Initialize the Operator Logbook
      await tx.insert(schema.workOrderLogs).values({
        tenantId,
        workOrderId: newOrder.id,
        author: userEmail,
        message: `Work Order created requiring ${integerBatches} machine run(s) to yield ${targetQty} units.`
      });

      return newOrder;
    });
  }

async getResourceMonitorLoad(tenantId: string, productLineId: string) {
    // 1. Fetch all active orders for this product line
    const activeOrders = await db.select({ id: schema.workOrders.id })
      .from(schema.workOrders)
      .where(and(
        eq(schema.workOrders.tenantId, tenantId),
        eq(schema.workOrders.productLineId, productLineId),
        inArray(schema.workOrders.status, ['planned', 'in_progress'])
      ));

    if (activeOrders.length === 0) return { labor: [], machines: [] };
    const orderIds = activeOrders.map(o => o.id);

    // 2. Fetch all frozen requirements for these active orders
    const reqs = await db.select().from(schema.workOrderRequirements)
      .where(inArray(schema.workOrderRequirements.workOrderId, orderIds));

    // 3. Fetch Master Data Capacities
    const [laborMaster, machineMaster] = await Promise.all([
      db.select().from(schema.labor).where(eq(schema.labor.tenantId, tenantId)),
      db.select().from(schema.machines).where(eq(schema.machines.tenantId, tenantId))
    ]);

    // 4. Aggregate required hours
    const laborLoad: Record<string, number> = {};
    const machineLoad: Record<string, number> = {};

    reqs.forEach(req => {
      const qty = Number(req.plannedQuantity);
      if (req.resourceType === 'labor') {
        laborLoad[req.resourceId] = (laborLoad[req.resourceId] || 0) + qty;
      } else if (req.resourceType === 'machine') {
        machineLoad[req.resourceId] = (machineLoad[req.resourceId] || 0) + qty;
      }
    });

    // 5. Format for the "Traffic Light" UI
    const formatLoad = (loadMap: Record<string, number>, masterList: any[]) => {
      return Object.entries(loadMap).map(([id, requiredHours]) => {
        const master = masterList.find(m => m.id === id);
        const dailyCapacity = Number(master?.dailyCapacityHours) || 8;
        const backlogDays = requiredHours / dailyCapacity;
        
        return {
          id,
          name: master?.title || master?.name || 'Unknown Resource',
          requiredHours,
          dailyCapacity,
          backlogDays
        };
      }).sort((a, b) => b.backlogDays - a.backlogDays); // Sort by highest bottleneck
    };

    return {
      labor: formatLoad(laborLoad, laborMaster),
      machines: formatLoad(machineLoad, machineMaster)
    };
  }

  async updateRunStatus(tenantId: string, runId: string, status: any, userEmail: string) {
    const updateData: any = { status };
    if (status === 'in_progress') updateData.startedAt = new Date();
    if (status === 'completed') updateData.completedAt = new Date();

    const [run] = await db.update(schema.workOrderRuns)
      .set(updateData)
      .where(and(eq(schema.workOrderRuns.id, runId), eq(schema.workOrderRuns.tenantId, tenantId)))
      .returning();
      
    if (!run) throw new NotFoundException('Run not found');

    // Auto-log the status change to maintain an immutable audit trail
    await db.insert(schema.workOrderLogs).values({
      tenantId,
      workOrderId: run.workOrderId,
      author: 'System',
      message: `Machine Run ${run.runSequence} changed to ${status.replace('_', ' ')} by ${userEmail}.`
    });

    return run;
  }

  async addLog(tenantId: string, workOrderId: string, message: string, userEmail: string) {
    const [log] = await db.insert(schema.workOrderLogs).values({
      tenantId, workOrderId, author: userEmail, message
    }).returning();
    return log;
  }

async getKanbanBoard(tenantId: string, productLineId: string) {
    // Archiving Rule: Hide completed orders older than 7 days
    const archiveThreshold = new Date();
    archiveThreshold.setDate(archiveThreshold.getDate() - 7);

    return await db.select({
      id: schema.workOrders.id,
      batchNumber: schema.workOrders.batchNumber,
      targetQuantity: schema.workOrders.targetQuantity,
      status: schema.workOrders.status,
      createdAt: schema.workOrders.createdAt,
    })
    .from(schema.workOrders)
    .where(and(
      eq(schema.workOrders.tenantId, tenantId),
      eq(schema.workOrders.productLineId, productLineId),
      or(
        inArray(schema.workOrders.status, ['planned', 'in_progress']),
        and(
          eq(schema.workOrders.status, 'completed'),
          gte(schema.workOrders.createdAt, archiveThreshold) // Fallback to createdAt if completedDate isn't set yet
        )
      )
    ))
    .orderBy(desc(schema.workOrders.createdAt)); // Newest at top
  }

async findOne(tenantId: string, id: string) {
    const [order] = await db.select({
      id: schema.workOrders.id,
      batchNumber: schema.workOrders.batchNumber,
      targetQuantity: schema.workOrders.targetQuantity,
      status: schema.workOrders.status,
      productLineName: schema.productLines.name,
      rejectedProductId: schema.productLines.rejectedProductId,
    })
    .from(schema.workOrders)
    .innerJoin(schema.productLines, eq(schema.workOrders.productLineId, schema.productLines.id))
    .where(and(eq(schema.workOrders.id, id), eq(schema.workOrders.tenantId, tenantId)));

    if (!order) throw new NotFoundException('Work Order not found');

    const requirements = await db.select().from(schema.workOrderRequirements).where(eq(schema.workOrderRequirements.workOrderId, id));
    
    // Fetch Runs
    const runs = await db.select().from(schema.workOrderRuns)
      .where(eq(schema.workOrderRuns.workOrderId, id))
      .orderBy(asc(schema.workOrderRuns.runSequence));

    // Fetch Logs
    const logs = await db.select().from(schema.workOrderLogs)
      .where(eq(schema.workOrderLogs.workOrderId, id))
      .orderBy(desc(schema.workOrderLogs.createdAt));

    return { ...order, requirements, runs, logs };
  }

  async updateStatus(tenantId: string, id: string, status: any, userEmail: string, force: boolean = false) {
    // INTERCEPT: If moving to "in_progress", route through the WIP Gatekeeper
    if (status === 'in_progress') {
      return this.startWorkOrder(tenantId, id, userEmail, force);
    }

    // Otherwise, perform a standard status update (e.g., for 'cancelled' or moving backwards)
    const [updated] = await db.update(schema.workOrders)
      .set({ status })
      .where(and(eq(schema.workOrders.id, id), eq(schema.workOrders.tenantId, tenantId)))
      .returning();
    return updated;
  }

  async startWorkOrder(tenantId: string, workOrderId: string, userEmail: string, forceStart: boolean = false) {
    return await db.transaction(async (tx) => {

      //  Resolve internal User UUID using the email
      const [internalUser] = await tx.select({ id: schema.users.id })
        .from(schema.users).where(eq(schema.users.email, userEmail));
      if (!internalUser) throw new BadRequestException(`User with email ${userEmail} not found.`);
      const userId = internalUser.id;

      // 1. Fetch Order and Settings
      const [order] = await tx.select().from(schema.workOrders).where(and(eq(schema.workOrders.id, workOrderId), eq(schema.workOrders.tenantId, tenantId)));
      if (!order || order.status !== 'planned') throw new BadRequestException('Order not found or not in planned status.');
      
      const [settings] = await tx.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenantId));
      if (!settings?.wipAssetId) throw new BadRequestException('WIP Asset Account not mapped in Tenant Settings.');

      // 2. Fetch Requirements and Master Data for Gatekeeper Validation
      const reqs = await tx.select().from(schema.workOrderRequirements).where(eq(schema.workOrderRequirements.workOrderId, workOrderId));
      const rmIds = reqs.filter(r => r.resourceType === 'raw_material').map(r => r.resourceId);
      
      const rawMaterials = rmIds.length > 0 ? await tx.select().from(schema.rawMaterials).where(inArray(schema.rawMaterials.id, rmIds)) : [];
      
      // Calculate active backlog (Assuming a 7-day weekly capacity threshold for the gatekeeper)
      const activeOrders = await tx.select({ id: schema.workOrders.id }).from(schema.workOrders).where(and(eq(schema.workOrders.tenantId, tenantId), eq(schema.workOrders.status, 'in_progress')));
      const activeOrderIds = activeOrders.map(o => o.id);
      const activeReqs = activeOrderIds.length > 0 ? await tx.select().from(schema.workOrderRequirements).where(inArray(schema.workOrderRequirements.workOrderId, activeOrderIds)) : [];

      let totalPlannedCost = 0;
      let rmCost = 0, laborCost = 0, machineCost = 0, utilityCost = 0, vendorCost = 0;

      // 3. GATEKEEPER LOOP
      for (const req of reqs) {
        if (req.resourceType === 'product_output') continue;
        
        const qty = Number(req.plannedQuantity);
        const cost = Number(req.estimatedCost);
        totalPlannedCost += cost;

        if (req.resourceType === 'raw_material') {
          const rm = rawMaterials.find(m => m.id === req.resourceId);
          if (!rm || Number(rm.currentStock) < qty) {
            throw new BadRequestException(`HARD BLOCK: Insufficient Inventory for ${req.resourceName}. Need ${qty}, but only have ${rm?.currentStock || 0}.`);
          }
          rmCost += cost;
          // Calculate the exact new stock locally
          const newStock = Number(rm.currentStock) - qty;
          
          // Deduct planned RM physically
          await tx.update(schema.rawMaterials).set({ currentStock: sql`${schema.rawMaterials.currentStock} - ${qty}` }).where(eq(schema.rawMaterials.id, req.resourceId));
          await tx.insert(schema.materialLedger).values({ tenantId, rawMaterialId: req.resourceId, quantityChange: (-qty).toString(), referenceType: 'production_consumption', recordedBy: userId }); // Using email as stand-in for ID here if needed
          
          // Check if this planned consumption drops us below reorder level!
          await this.notificationsService.evaluateReorderLevel(tx, tenantId, req.resourceId, newStock);
        } 
        else if (req.resourceType === 'machine' || req.resourceType === 'labor') {
          // Capacity Gatekeeper
          const currentLoad = activeReqs.filter(ar => ar.resourceId === req.resourceId).reduce((sum, ar) => sum + Number(ar.plannedQuantity), 0);
          // Simplified: We assume a baseline weekly capacity of 40 hours. You can dynamically fetch the specific labor/machine dailyCapacityHours here.
          const baselineCapacity = 40; 
          const proposedLoad = currentLoad + qty;
          
          if (proposedLoad > baselineCapacity * 1.10) {
            throw new BadRequestException(`HARD BLOCK: ${req.resourceName} capacity exceeded 110% limit. Current Load: ${currentLoad} hrs.`);
          } else if (proposedLoad > baselineCapacity && !forceStart) {
            // Throw a Conflict (409) so frontend knows to prompt a warning
            throw new ConflictException(`WARNING: ${req.resourceName} is over 100% capacity (at ${(proposedLoad/baselineCapacity*100).toFixed(1)}%). Proceed anyway?`);
          }
          
          if (req.resourceType === 'machine') machineCost += cost;
          if (req.resourceType === 'labor') laborCost += cost;
        }
        else if (req.resourceType === 'utility') utilityCost += cost;
        else if (req.resourceType === 'vendor') vendorCost += cost;
      }

      // 4. WIP ACCOUNTING (Event A)
      const [journalEntry] = await tx.insert(schema.journalEntries).values({
        tenantId, referenceId: workOrderId, referenceType: 'work_order_start', description: `WIP Pre-Accrual: WO ${order.batchNumber}`
      }).returning();

      const lines = [
        { tenantId, entryId: journalEntry.id, accountId: settings.wipAssetId, debit: totalPlannedCost.toFixed(2), credit: '0.00' }
      ];
      if (rmCost > 0) lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.rawMaterialAssetId!, debit: '0.00', credit: rmCost.toFixed(2) });
      if (laborCost > 0) lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.wagesPayableId!, debit: '0.00', credit: laborCost.toFixed(2) });
      if (machineCost > 0) lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.machineOverheadId!, debit: '0.00', credit: machineCost.toFixed(2) });
      if (utilityCost > 0) lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.utilitiesPayableId!, debit: '0.00', credit: utilityCost.toFixed(2) });
      if (vendorCost > 0) lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.vendorPayableId!, debit: '0.00', credit: vendorCost.toFixed(2) });

      await tx.insert(schema.journalLines).values(lines.filter(l => Number(l.credit) > 0 || Number(l.debit) > 0));

      // 5. Commit Status
      const [updated] = await tx.update(schema.workOrders)
        .set({ status: 'in_progress', startDate: new Date() })
        .where(eq(schema.workOrders.id, workOrderId))
        .returning();

      // NEW: Auto-start the first run
      await tx.update(schema.workOrderRuns)
        .set({ status: 'in_progress', startedAt: new Date() })
        .where(and(
          eq(schema.workOrderRuns.workOrderId, workOrderId),
          eq(schema.workOrderRuns.runSequence, 1) // Target exactly the first run
        ));

      // Auto-log the run start
      await tx.insert(schema.workOrderLogs).values({
        tenantId, workOrderId, author: 'System',
        message: `Machine Run 1 auto-started alongside Master Batch launch.`
      });

      return updated;
    });
  }

async completeWorkOrder(
    tenantId: string, 
    workOrderId: string, 
    payload: { actualYield: number; rejectedYield: number; actualUsages?: Record<string, number> }, 
    userEmail: string
  ) {
    try {
      return await db.transaction(async (tx) => {
        // 1. Resolve internal User UUID
        const [internalUser] = await tx.select({ id: schema.users.id })
          .from(schema.users).where(eq(schema.users.email, userEmail));
        if (!internalUser) throw new BadRequestException(`User with email ${userEmail} not found.`);
        const userId = internalUser.id;

        // 2. Fetch Order & Linked Product Line
        const [orderData] = await tx.select({
          order: schema.workOrders,
          mainProductId: schema.productLines.mainProductId,
          rejectedProductId: schema.productLines.rejectedProductId,
          batchNumber: schema.workOrders.batchNumber
        })
        .from(schema.workOrders)
        .innerJoin(schema.productLines, eq(schema.workOrders.productLineId, schema.productLines.id))
        .where(and(eq(schema.workOrders.id, workOrderId), eq(schema.workOrders.tenantId, tenantId)));

        if (!orderData) throw new BadRequestException('Work Order not found');

        const pendingRuns = await tx.select({ id: schema.workOrderRuns.id })
          .from(schema.workOrderRuns)
          .where(and(
            eq(schema.workOrderRuns.workOrderId, workOrderId),
            ne(schema.workOrderRuns.status, 'completed') // Finds any run NOT completed
          ));

        if (pendingRuns.length > 0) {
          throw new BadRequestException('HARD BLOCK: Cannot complete master batch. All individual machine runs must be marked as "Completed" first.');
        }
        
        // 3. Fetch Tenant Settings for fallback accounts
        const [settings] = await tx.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenantId));
        if (!settings) throw new BadRequestException('Financial Accounts are not mapped in Tenant Settings.');

        // 4. Fetch Requirements and output Product Details
        const requirements = await tx.select().from(schema.workOrderRequirements).where(eq(schema.workOrderRequirements.workOrderId, workOrderId));
        
        const productIds = requirements.filter(r => r.resourceType === 'product_output').map(r => r.resourceId);
        if (orderData.rejectedProductId && !productIds.includes(orderData.rejectedProductId)) productIds.push(orderData.rejectedProductId);
        
        const productsMaster = productIds.length > 0 
          ? await tx.select().from(schema.products).where(inArray(schema.products.id, productIds))
          : [];

// --- BUCKET A: RECONCILE DIFFERENCES ---
        // totalPlannedCost was already accrued into WIP. We only process the delta.
        let plannedTotalCost = 0;
        let actualTotalCost = 0;
        let rmDeltaCost = 0, laborDeltaCost = 0, machineDeltaCost = 0, utilityDeltaCost = 0, vendorDeltaCost = 0;

        for (const req of requirements) {
          if (req.resourceType === 'product_output') continue;

          const plannedQty = Number(req.plannedQuantity);
          const estCost = Number(req.estimatedCost);
          const unitRate = plannedQty > 0 ? estCost / plannedQty : 0; 
          const actualQty = payload.actualUsages?.[req.id] ?? plannedQty;
          const actualReqCost = actualQty * unitRate;

          plannedTotalCost += estCost;
          actualTotalCost += actualReqCost;

          const qtyDifference = actualQty - plannedQty; // If positive, we used MORE than planned.
          const costDifference = actualReqCost - estCost;

          await tx.update(schema.workOrderRequirements).set({ actualQuantity: actualQty.toString(), actualCost: actualReqCost.toString() }).where(eq(schema.workOrderRequirements.id, req.id));

          if (qtyDifference !== 0) {
            if (req.resourceType === 'raw_material') {
              // FIX: Fetch the RM, do the math safely in JS, and write back the exact string
              const [rm] = await tx.select().from(schema.rawMaterials).where(eq(schema.rawMaterials.id, req.resourceId));
              if (rm) {
                const newStock = Number(rm.currentStock) - qtyDifference;
                
                await tx.update(schema.rawMaterials)
                  .set({ currentStock: newStock.toString() })
                  .where(eq(schema.rawMaterials.id, req.resourceId));

                await tx.insert(schema.materialLedger).values({ 
                  tenantId, 
                  rawMaterialId: req.resourceId, 
                  quantityChange: (-qtyDifference).toString(), 
                  referenceType: 'production_variance', // to reflect it's a batch override
                  recordedBy: userId 
                });
                
                rmDeltaCost += costDifference;
                // If they used MORE than planned (qtyDifference > 0), check the threshold!
                if (qtyDifference > 0) {
                  await this.notificationsService.evaluateReorderLevel(tx, tenantId, req.resourceId, newStock);
                }
              }
            } 
            else if (req.resourceType === 'labor') laborDeltaCost += costDifference;
            else if (req.resourceType === 'machine') machineDeltaCost += costDifference;
            else if (req.resourceType === 'utility') utilityDeltaCost += costDifference;
            else if (req.resourceType === 'vendor') vendorDeltaCost += costDifference;
          }
        }

        const costVariance = actualTotalCost - plannedTotalCost;

        // --- BUCKET B: PROCESS YIELDS & CALCULATE RATIOS ---   
        let totalAllocableRevenue = 0;
        const outputValuations: any[] = [];

        for (const req of requirements) {
          if (req.resourceType !== 'product_output') continue;
          
          const product = productsMaster.find(p => p.id === req.resourceId);
          if (!product) continue;

          let quantityToAdd = Number(req.plannedQuantity);
          if (req.resourceId === orderData.mainProductId) quantityToAdd = payload.actualYield;
          else if (req.resourceId === orderData.rejectedProductId) continue;

          if (quantityToAdd > 0) {
            await tx.update(schema.products)
              .set({ currentStock: sql`${schema.products.currentStock} + ${quantityToAdd}` })
              .where(eq(schema.products.id, req.resourceId));
          }

          const expectedRevenue = quantityToAdd * Number(product.sellingPrice);
          totalAllocableRevenue += expectedRevenue;
          
          outputValuations.push({
            productId: req.resourceId,
            isMain: req.resourceId === orderData.mainProductId,
            expectedRevenue,
            inventoryAccountId: product.inventoryAccountId 
          });
        }

        if (payload.rejectedYield > 0 && orderData.rejectedProductId) {
          await tx.update(schema.products)
            .set({ currentStock: sql`${schema.products.currentStock} + ${payload.rejectedYield}` })
            .where(eq(schema.products.id, orderData.rejectedProductId));
        }

        // --- BUCKET C: DOUBLE-ENTRY COMPLETION ---
        const [journalEntry] = await tx.insert(schema.journalEntries).values({
           tenantId, referenceId: workOrderId, referenceType: 'work_order_completion', description: `WIP Flush: WO ${orderData.batchNumber}`
        }).returning();

        const lines: any[] = [];

        // 1. Flush the WIP Account (Credit the entire planned cost we parked there earlier)
        lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.wipAssetId, debit: '0.00', credit: plannedTotalCost.toFixed(2) });

        // 2. Debit Finished Goods (Standard Cost) & CREATE INVENTORY LOTS
        // CHANGED: Swapped forEach to for...of so we can safely use 'await' inside the loop
        for (const output of outputValuations) { 
          let allocatedCost = totalAllocableRevenue > 0 
            ? plannedTotalCost * (output.expectedRevenue / totalAllocableRevenue) 
            : (output.isMain ? plannedTotalCost : 0);

          if (allocatedCost > 0) {
            const accId = output.inventoryAccountId || (output.isMain ? settings.finishedGoodsAssetId : settings.byproductAssetId);
            lines.push({ tenantId, entryId: journalEntry.id, accountId: accId, debit: allocatedCost.toFixed(2), credit: '0.00' });

            // --- NEW: STRICT LOT GENERATION ---
            // Determine exact quantity: actualYield for Main Product, plannedQuantity for standard Byproducts
            const yieldedQty = output.isMain 
              ? payload.actualYield 
              : Number(requirements.find(r => r.resourceId === output.productId)?.plannedQuantity || 0);

            if (yieldedQty > 0) {
              const unitCost = allocatedCost / yieldedQty; // Derives the exact COGS unit value for this specific batch
              
              await tx.insert(schema.inventoryLots).values({
                tenantId,
                productId: output.productId,
                workOrderId: workOrderId, // The Genealogy Link
                lotNumber: `${orderData.batchNumber}-${output.isMain ? 'FG' : 'BP'}`, // e.g., 'WO-005-FG' or 'WO-005-BP'
                initialQuantity: yieldedQty.toString(),
                currentQuantity: yieldedQty.toString(),
                unitCost: unitCost.toFixed(2) // Locks in the exact historical cost
              });
            }
          }
        }

        // 3. Adjust Liabilities for the Deltas (Variance)
        const addDeltaLine = (accId: string, deltaCost: number) => {
          if (deltaCost > 0) lines.push({ tenantId, entryId: journalEntry.id, accountId: accId, debit: '0.00', credit: deltaCost.toFixed(2) }); 
          if (deltaCost < 0) lines.push({ tenantId, entryId: journalEntry.id, accountId: accId, debit: Math.abs(deltaCost).toFixed(2), credit: '0.00' }); 
        };
        
        if (rmDeltaCost !== 0) addDeltaLine(settings.rawMaterialAssetId!, rmDeltaCost);
        if (laborDeltaCost !== 0) addDeltaLine(settings.wagesPayableId!, laborDeltaCost);
        if (machineDeltaCost !== 0) addDeltaLine(settings.machineOverheadId!, machineDeltaCost);
        if (utilityDeltaCost !== 0) addDeltaLine(settings.utilitiesPayableId!, utilityDeltaCost);
        if (vendorDeltaCost !== 0) addDeltaLine(settings.vendorPayableId!, vendorDeltaCost);

        // 4. The Variance Plug
        if (Math.abs(costVariance) > 0.01) {
          if (costVariance > 0) lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.varianceExpenseId!, debit: costVariance.toFixed(2), credit: '0.00' });
          else lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.varianceExpenseId!, debit: '0.00', credit: Math.abs(costVariance).toFixed(2) });
        }

        // Insert Journal Lines
        if (lines.length > 0) {
          const totalDebits = lines.reduce((sum, l) => sum + Number(l.debit), 0);
          const totalCredits = lines.reduce((sum, l) => sum + Number(l.credit), 0);
          if (Math.abs(totalDebits - totalCredits) > 0.05) { 
             throw new BadRequestException(`Ledger imbalance detected! Debits: ${totalDebits}, Credits: ${totalCredits}`);
          }
          await tx.insert(schema.journalLines).values(lines);
        }

        // Finalize Status
        const [completedOrder] = await tx.update(schema.workOrders)
          .set({ 
            status: 'completed', 
            completedDate: new Date(),
            actualYield: payload.actualYield.toString(), // Logs the physical yield
            actualTotalCost: actualTotalCost.toFixed(2)  // Logs the exact calculated financial cost
          })
          .where(eq(schema.workOrders.id, workOrderId)).returning();

        await tx.insert(schema.workOrderLogs).values({
          tenantId, workOrderId, author: userEmail,
          message: `Batch Finalized. QC Passed: ${payload.actualYield}. QC Rejected: ${payload.rejectedYield}. Variance: ₹${costVariance.toFixed(2)}. Total Actual Cost: ₹${actualTotalCost.toFixed(2)}`
        });

        return completedOrder;
        
      });
    } catch (error) {
      console.error("\n=== TRANSACTION FAILED ===");
      console.error(error);
      console.error("==========================\n");
      throw error;
    }
  }

  async getVarianceReport(tenantId: string, startDate?: string, endDate?: string) {
    // Build the dynamic where conditions
    const conditions = [
      eq(schema.workOrders.tenantId, tenantId),
      eq(schema.workOrders.status, 'completed')
    ];

    if (startDate) conditions.push(gte(schema.workOrders.completedDate, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Include the whole end day
      conditions.push(lte(schema.workOrders.completedDate, end));
    }
    
    // 1. Fetch all requirements from COMPLETED orders
    const rawData = await db.select({
      resourceType: schema.workOrderRequirements.resourceType,
      resourceName: schema.workOrderRequirements.resourceName,
      plannedCost: schema.workOrderRequirements.estimatedCost,
      actualCost: schema.workOrderRequirements.actualCost,
      productLineName: schema.productLines.name,
      batchNumber: schema.workOrders.batchNumber,
    })
    .from(schema.workOrderRequirements)
    .innerJoin(schema.workOrders, eq(schema.workOrderRequirements.workOrderId, schema.workOrders.id))
    .innerJoin(schema.productLines, eq(schema.workOrders.productLineId, schema.productLines.id))
    .where(and(...conditions)); // USE SPREAD OPERATOR FOR DYNAMIC CONDITIONS

    // 2. Data Structures for Aggregation
    const byProductLine: Record<string, { planned: number; actual: number }> = {};
    const byResource: Record<string, { planned: number; actual: number }> = {};

    // 3. Process the Data
    rawData.forEach(row => {
      // Skip outputs, we only care about cost consumption here
      if (row.resourceType === 'product_output') return;

      const planned = Number(row.plannedCost) || 0;
      const actual = Number(row.actualCost) || planned; // If actual is null, assume it went to plan

      // Aggregate by Product Line
      if (!byProductLine[row.productLineName]) byProductLine[row.productLineName] = { planned: 0, actual: 0 };
      byProductLine[row.productLineName].planned += planned;
      byProductLine[row.productLineName].actual += actual;

      // Aggregate by Resource (e.g., specific Raw Material or Machine)
      const resourceKey = `[${row.resourceType.toUpperCase()}] ${row.resourceName}`;
      if (!byResource[resourceKey]) byResource[resourceKey] = { planned: 0, actual: 0 };
      byResource[resourceKey].planned += planned;
      byResource[resourceKey].actual += actual;
    });

    // 4. Formatting Helper to calculate the Variance and %
    const formatReport = (dataMap: Record<string, { planned: number; actual: number }>) => {
      return Object.entries(dataMap).map(([name, data]) => {
        const variance = data.actual - data.planned;
        const variancePercent = data.planned > 0 ? (variance / data.planned) * 100 : 0;
        return {
          name,
          plannedCost: data.planned,
          actualCost: data.actual,
          variance,
          variancePercent,
          isFavorable: variance <= 0 // Negative variance means we spent LESS than planned (Good!)
        };
      }).sort((a, b) => b.variance - a.variance); // Sort by highest unfavorable variance first
    };

    return {
      byProductLine: formatReport(byProductLine),
      byResource: formatReport(byResource)
    };
  }


}