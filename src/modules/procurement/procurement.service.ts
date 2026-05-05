import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { eq, and, inArray, gte, lte, desc } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class ProcurementService {
  
  // 1. MANAGER APPROVAL LOGIC
  async approvePO(tenantId: string, poId: string, userEmail: string) {
    // Basic RBAC stand-in: In a real app, you'd verify the email against a roles table.
    // For now, we assume if they can click the button, we log their email.
    if (!userEmail) throw new UnauthorizedException('User email required for approval.');

    const [po] = await db.update(schema.purchaseOrders)
      .set({ status: 'approved', approvedBy: userEmail })
      .where(and(eq(schema.purchaseOrders.id, poId), eq(schema.purchaseOrders.status, 'pending_approval'), eq(schema.purchaseOrders.tenantId, tenantId)))
      .returning();

    if (!po) throw new BadRequestException('PO not found or already approved.');
    return po;
  }

  // 2. GRN & LANDED COSTING ENGINE
  async receiveGRN(tenantId: string, poId: string, extraCosts: number, userEmail: string) {
    return await db.transaction(async (tx) => {
      // --- NEW: Resolve internal User UUID ---
      const [internalUser] = await tx.select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, userEmail));
        
      if (!internalUser) {
        throw new BadRequestException(`User with email ${userEmail} not found in internal users table.`);
      }
      const userId = internalUser.id;

      // A. Fetch PO and Settings
      const [po] = await tx.select().from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.id, poId), eq(schema.purchaseOrders.tenantId, tenantId)));
      if (!po || po.status !== 'approved') throw new BadRequestException('PO must be approved before receiving.');

      const [settings] = await tx.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenantId));
      if (!settings?.rawMaterialAssetId) throw new BadRequestException('Raw Material Asset Account not mapped.');

      // B. Fetch Items & Calculate Landed Costs
      const items = await tx.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.poId, poId));
      
      const basePoTotal = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitPrice)), 0);
      const totalLandedCost = basePoTotal + extraCosts;
      
      // We distribute the extra cost proportionally based on the value of the items
      const costMultiplier = basePoTotal > 0 ? (totalLandedCost / basePoTotal) : 1;

      // C. Process Inventory & Moving Average Cost (MAC)
      for (const item of items) {
        const [rm] = await tx.select().from(schema.rawMaterials).where(eq(schema.rawMaterials.id, item.rawMaterialId));
        if (!rm) continue;

        const oldQty = Number(rm.currentStock) || 0;
        const oldPrice = Number(rm.unitPrice) || 0;
        const oldTotalValue = oldQty * oldPrice;

        const recvQty = Number(item.quantity);
        // Apply the proportional freight/extra costs to this item's unit price
        const landedUnitPrice = Number(item.unitPrice) * costMultiplier; 
        const newRecvValue = recvQty * landedUnitPrice;

        // MAC Formula
        const newTotalQty = oldQty + recvQty;
        const newMovingAveragePrice = newTotalQty > 0 ? ((oldTotalValue + newRecvValue) / newTotalQty) : 0;

        // Update RM Inventory
        await tx.update(schema.rawMaterials)
          .set({ 
            currentStock: newTotalQty.toString(), 
            unitPrice: newMovingAveragePrice.toString() // Update to the new blended rate
          })
          .where(eq(schema.rawMaterials.id, rm.id));

        // Material Ledger Log
        await tx.insert(schema.materialLedger).values({
          tenantId, 
          rawMaterialId: rm.id, 
          quantityChange: recvQty.toString(), 
          referenceType: 'purchase_restock', // Changed from 'goods_receipt'
          recordedBy: userId
        });
      }

      // D. Financial Double-Entry Accounting
      const [journalEntry] = await tx.insert(schema.journalEntries).values({
        tenantId, referenceId: poId, referenceType: 'goods_receipt', description: `GRN for PO #${poId.substring(0,8)}`
      }).returning();

      const lines: any[] = [];
      // Debit RM Asset with the FULL landed cost
      lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.rawMaterialAssetId, debit: totalLandedCost.toFixed(2), credit: '0.00' });

      // Credit routing based on tenant settings
      if (settings.mergeGrnAndInvoice) {
        if (!settings.vendorPayableId) throw new BadRequestException('Vendor Payable Account not mapped.');
        // Instant Invoice: Credit Accounts Payable
        lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.vendorPayableId, debit: '0.00', credit: totalLandedCost.toFixed(2) });
      } else {
        if (!settings.grniLiabilityId) throw new BadRequestException('GRNI Liability Account not mapped.');
        // Deferred Invoice: Credit GRNI (Goods Received Not Invoiced)
        lines.push({ tenantId, entryId: journalEntry.id, accountId: settings.grniLiabilityId, debit: '0.00', credit: totalLandedCost.toFixed(2) });
      }

      await tx.insert(schema.journalLines).values(lines);

      // E. Mark PO as Received
      const [updatedPo] = await tx.update(schema.purchaseOrders)
        .set({ status: 'received', receivedAt: new Date(), extraCosts: extraCosts.toString() })
        .where(eq(schema.purchaseOrders.id, poId))
        .returning();

      return updatedPo;
    });
  }

async getAllPOs(tenantId: string, startDate?: string, endDate?: string) {
    const conditions = [eq(schema.purchaseOrders.tenantId, tenantId)];
    
    if (startDate) conditions.push(gte(schema.purchaseOrders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Set to end of the day
      conditions.push(lte(schema.purchaseOrders.createdAt, end));
    }

    // Fetch Header with limit 10
    const pos = await db.select()
      .from(schema.purchaseOrders)
      .where(and(...conditions))
      .orderBy(desc(schema.purchaseOrders.createdAt))
      .limit(10); 

    if (pos.length === 0) return [];

    // Fetch Nested Items & Join Raw Material Names
    const poIds = pos.map(p => p.id);
    const items = await db.select({
      poId: schema.purchaseOrderItems.poId,
      rawMaterialName: schema.rawMaterials.name,
      quantity: schema.purchaseOrderItems.quantity,
      unitPrice: schema.purchaseOrderItems.unitPrice
    })
    .from(schema.purchaseOrderItems)
    .innerJoin(schema.rawMaterials, eq(schema.purchaseOrderItems.rawMaterialId, schema.rawMaterials.id))
    .where(inArray(schema.purchaseOrderItems.poId, poIds));

    // Stitch together
    return pos.map(po => ({
      ...po,
      items: items.filter(i => i.poId === po.id)
    }));
  }

  async createPO(tenantId: string, payload: { vendorId: string, items: { rawMaterialId: string, qty: number, unitPrice: number }[] }, userEmail: string) {
    return await db.transaction(async (tx) => {
      // 1. Calculate Total
      const totalAmount = payload.items.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
      
      // 2. Create PO Header
      const [po] = await tx.insert(schema.purchaseOrders).values({
        tenantId,
        vendorId: payload.vendorId,
        requestedBy: userEmail,
        totalAmount: totalAmount.toString(),
        status: 'pending_approval' // Routes it to the manager
      }).returning();

      // 3. Create PO Items
      const itemsToInsert = payload.items.map(item => ({
        poId: po.id,
        rawMaterialId: item.rawMaterialId,
        quantity: item.qty.toString(),
        unitPrice: item.unitPrice.toString()
      }));
      await tx.insert(schema.purchaseOrderItems).values(itemsToInsert);

      return po;
    });
  }

}