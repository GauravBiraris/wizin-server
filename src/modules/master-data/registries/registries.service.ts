import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../../db';
import * as schema from '../../../db/schema';

@Injectable()
export class RegistriesService {
  
    // --- PRODUCTS ---
  async getProducts(tenantId: string) { 
    return db.select().from(schema.products).where(eq(schema.products.tenantId, tenantId)); 
  }

  async createProduct(tenantId: string, dto: { sku: string; name: string; type: any; uom: string; sellingPrice: number; inventoryAccountId?: string | null }) {
    const [record] = await db.insert(schema.products).values({ 
      tenantId, 
      sku: dto.sku,
      name: dto.name, 
      type: dto.type,
      uom: dto.uom,
      sellingPrice: dto.sellingPrice.toString(),
      inventoryAccountId: dto.inventoryAccountId || null, // Updated mapping
      currentStock: '0', 
    }).returning();
    return record;
  }

  async updateProduct(tenantId: string, id: string, dto: { sku: string; name: string; type: any; uom: string; sellingPrice: number; inventoryAccountId?: string | null }) {
    const [updated] = await db.update(schema.products).set({ 
      sku: dto.sku,
      name: dto.name, 
      type: dto.type,
      uom: dto.uom,
      sellingPrice: dto.sellingPrice.toString(),
      inventoryAccountId: dto.inventoryAccountId || null // Updated mapping
    })
    .where(and(eq(schema.products.id, id), eq(schema.products.tenantId, tenantId))).returning();
    
    if (!updated) throw new NotFoundException('Not found'); 
    return updated;
  }

  async deleteProduct(tenantId: string, id: string) {
    const [deleted] = await db.delete(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.tenantId, tenantId))).returning();
    if (!deleted) throw new NotFoundException('Not found'); return { success: true };
  }

  // --- LABOR ---
  async getLabor(tenantId: string) { return db.select().from(schema.labor).where(eq(schema.labor.tenantId, tenantId)); }
async createLabor(tenantId: string, dto: { title: string; hourlyRate: number; dailyCapacityHours: number }) {
    const [record] = await db.insert(schema.labor).values({ 
      tenantId, 
      title: dto.title, 
      hourlyRate: dto.hourlyRate.toString(),
      dailyCapacityHours: dto.dailyCapacityHours.toString() // Add this
    }).returning();
    return record;
  }
  async deleteLabor(tenantId: string, id: string) {
    const [deleted] = await db.delete(schema.labor).where(and(eq(schema.labor.id, id), eq(schema.labor.tenantId, tenantId))).returning();
    if (!deleted) throw new NotFoundException('Not found'); return { success: true };
  }

  // --- MACHINES ---
  async getMachines(tenantId: string) { return db.select().from(schema.machines).where(eq(schema.machines.tenantId, tenantId)); }
  async createMachine(tenantId: string, dto: { name: string; hourlyCost: number; dailyCapacityHours: number }) {
    const [record] = await db.insert(schema.machines).values({ 
      tenantId, 
      name: dto.name, 
      hourlyCost: dto.hourlyCost.toString(),
      dailyCapacityHours: dto.dailyCapacityHours.toString() // Add this
    }).returning();
    return record;
  }
  async deleteMachine(tenantId: string, id: string) {
    const [deleted] = await db.delete(schema.machines).where(and(eq(schema.machines.id, id), eq(schema.machines.tenantId, tenantId))).returning();
    if (!deleted) throw new NotFoundException('Not found'); return { success: true };
  }

  // --- UTILITIES ---
  async getUtilities(tenantId: string) { return db.select().from(schema.utilities).where(eq(schema.utilities.tenantId, tenantId)); }
  async createUtility(tenantId: string, dto: { name: string; uom: string; ratePerUnit: number }) {
    const [record] = await db.insert(schema.utilities).values({ tenantId, name: dto.name, uom: dto.uom, ratePerUnit: dto.ratePerUnit.toString() }).returning();
    return record;
  }
  async deleteUtility(tenantId: string, id: string) {
    const [deleted] = await db.delete(schema.utilities).where(and(eq(schema.utilities.id, id), eq(schema.utilities.tenantId, tenantId))).returning();
    if (!deleted) throw new NotFoundException('Not found'); return { success: true };
  }

  // --- VENDORS ---
  async getVendors(tenantId: string) { return db.select().from(schema.vendors).where(eq(schema.vendors.tenantId, tenantId)); }
  async createVendor(tenantId: string, dto: { name: string; serviceType: string; rate: number }) {
    const [record] = await db.insert(schema.vendors).values({ tenantId, name: dto.name, serviceType: dto.serviceType, rate: dto.rate.toString() }).returning();
    return record;
  }
  async deleteVendor(tenantId: string, id: string) {
    const [deleted] = await db.delete(schema.vendors).where(and(eq(schema.vendors.id, id), eq(schema.vendors.tenantId, tenantId))).returning();
    if (!deleted) throw new NotFoundException('Not found'); return { success: true };
  }

  async updateVendor(tenantId: string, id: string, dto: { name: string; serviceType: string; rate: number; baseUnit: string }) {
    const [updated] = await db.update(schema.vendors)
      .set({ 
        name: dto.name, 
        serviceType: dto.serviceType, 
        rate: dto.rate.toString(),
        baseUnit: dto.baseUnit
      })
      .where(and(eq(schema.vendors.id, id), eq(schema.vendors.tenantId, tenantId)))
      .returning();
      
    if (!updated) throw new NotFoundException('Vendor not found'); 
    return updated;
  }

async updateLabor(tenantId: string, id: string, dto: { title: string; hourlyRate: number; dailyCapacityHours: number }) {
    const [updated] = await db.update(schema.labor).set({ 
      title: dto.title, 
      hourlyRate: dto.hourlyRate.toString(),
      dailyCapacityHours: dto.dailyCapacityHours.toString() // Add this
    })
      .where(and(eq(schema.labor.id, id), eq(schema.labor.tenantId, tenantId))).returning();
    if (!updated) throw new NotFoundException('Not found'); return updated;
  }

async updateMachine(tenantId: string, id: string, dto: { name: string; hourlyCost: number; dailyCapacityHours: number }) {
    const [updated] = await db.update(schema.machines).set({ 
      name: dto.name, 
      hourlyCost: dto.hourlyCost.toString(),
      dailyCapacityHours: dto.dailyCapacityHours.toString() // Add this
    })
      .where(and(eq(schema.machines.id, id), eq(schema.machines.tenantId, tenantId))).returning();
    if (!updated) throw new NotFoundException('Not found'); return updated;
  }

  async updateUtility(tenantId: string, id: string, dto: { name: string; uom: string; ratePerUnit: number }) {
    const [updated] = await db.update(schema.utilities).set({ name: dto.name, uom: dto.uom, ratePerUnit: dto.ratePerUnit.toString() })
      .where(and(eq(schema.utilities.id, id), eq(schema.utilities.tenantId, tenantId))).returning();
    if (!updated) throw new NotFoundException('Not found'); return updated;
  }

  async directInventoryEdit(tenantId: string, productId: string, newStock: number, reason: string, userEmail: string) {
    return await db.transaction(async (tx) => {
      // Resolve User ID
      const [internalUser] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, userEmail));
      const userId = internalUser?.id || null;
      // 1. Verify Settings
      const [settings] = await tx.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenantId));
      if (!settings?.allowDirectInventoryEdit) throw new BadRequestException("Direct inventory editing is disabled in Tenant Settings.");
      if (!reason || reason.trim() === '') throw new BadRequestException("A valid reason is required for manual inventory adjustments.");

      const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, productId));
      if (!product) throw new BadRequestException("Product not found.");

      const oldStock = Number(product.currentStock) || 0;
      const delta = newStock - oldStock;

      if (delta !== 0) {
        // 2. Update Stock
        await tx.update(schema.products).set({ currentStock: newStock.toString() }).where(eq(schema.products.id, productId));

        // 3. Log Immutable Audit Trail
        await tx.insert(schema.productLedger).values({
          tenantId, productId, quantityChange: delta.toString(),
          referenceType: 'manual_adjustment', reason, recordedBy: userId
        });

        // 4. Auto-Generate Lot for Strict Tracking (ONLY if adding stock)
        if (delta > 0) {
          // Generate a unique lot number using a timestamp snippet
          const manualLotNumber = `MANUAL-FG-${Date.now().toString().slice(-6)}`;
          
          await tx.insert(schema.inventoryLots).values({
            tenantId,
            productId,
            lotNumber: manualLotNumber,
            initialQuantity: delta.toString(),
            currentQuantity: delta.toString(),
            unitCost: '0.00' // Ghost inventory has no production cost
          });
        }
        
        // Note: If delta < 0 (operator manually removed FG stock), we do NOT automatically deduct from a lot here. 
        // In strict ERPs, manual negative adjustments of FG require a dedicated "Write-Off/Scrap" modal where the operator selects *which* lot they dropped/broke, ensuring COGS accuracy. For this scope, updating global stock is sufficient, but lot balance will technically be higher than global stock.
      }
      return { success: true, newStock };
    });
  }

  

  async getCustomers(tenantId: string) {
    return await db.select()
      .from(schema.customers)
      .where(eq(schema.customers.tenantId, tenantId))
      .orderBy(desc(schema.customers.createdAt));
  }
  
  // 1. Create Customer
  async createCustomer(tenantId: string, payload: { name: string, email?: string, phone?: string, address?: string, gstin?: string, creditLimit?: number }) {
    const [customer] = await db.insert(schema.customers).values({
      tenantId,
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      address: payload.address,
      gstin: payload.gstin?.toUpperCase(), // Standardize GSTIN
      creditLimit: payload.creditLimit?.toString() || '0.00'
    }).returning();
    
    return customer;
  }

  // 2. Update Customer
  async updateCustomer(tenantId: string, id: string, payload: any) {
    const [customer] = await db.update(schema.customers)
      .set({
        ...payload,
        gstin: payload.gstin?.toUpperCase(),
        creditLimit: payload.creditLimit?.toString()
      })
      .where(and(eq(schema.customers.id, id), eq(schema.customers.tenantId, tenantId)))
      .returning();
      
    return customer;
  }

  // 3. Delete Customer (With safety check)
  async deleteCustomer(tenantId: string, id: string) {
    try {
      await db.delete(schema.customers)
        .where(and(eq(schema.customers.id, id), eq(schema.customers.tenantId, tenantId)));
      return { success: true };
    } catch (error: any) {
      // If the database throws a foreign key violation (code 23503 in Postgres)
      if (error.code === '23503') {
        throw new BadRequestException("Cannot delete this customer because they have linked Sales Orders. Please edit their details instead.");
      }
      throw new BadRequestException("Failed to delete customer.");
    }
  }
  
}