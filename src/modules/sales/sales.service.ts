import { Injectable, BadRequestException } from '@nestjs/common';
import { eq, and, sql, inArray, desc, gte, lte } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class SalesService {
  
  //  Fetching lots for the Sales Order dropdown
  async getValidLotsForProduct(tenantId: string, productId: string) {
    return await db.select({
      id: schema.inventoryLots.id,
      lotNumber: schema.inventoryLots.lotNumber,
      currentQuantity: schema.inventoryLots.currentQuantity,
      unitCost: schema.inventoryLots.unitCost, 
      createdAt: schema.inventoryLots.createdAt
    })
    .from(schema.inventoryLots)
    .where(and(
      eq(schema.inventoryLots.tenantId, tenantId),
      eq(schema.inventoryLots.productId, productId),
      sql`${schema.inventoryLots.currentQuantity} > 0` // Only show lots with stock
    ))
    .orderBy(schema.inventoryLots.createdAt); // FIFO: Oldest lots show first
  }

  // 1. CREATE SALES ORDER (The Commercial Agreement)
  async createSalesOrder(tenantId: string, payload: { customerId: string, orderNumber: string, items: { productId: string, qty: number, unitPrice: number }[] }) {
    return await db.transaction(async (tx) => {
      // Create Header
      const [so] = await tx.insert(schema.salesOrders).values({
        tenantId,
        customerId: payload.customerId,
        orderNumber: payload.orderNumber,
        totalAmount: payload.items.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0).toString()
      }).returning();

      // Create Items
      const itemsToInsert = payload.items.map(item => ({
        salesOrderId: so.id,
        productId: item.productId,
        orderedQuantity: item.qty.toString(),
        unitPrice: item.unitPrice.toString()
      }));
      await tx.insert(schema.salesOrderItems).values(itemsToInsert);

      return so;
    });
  }

  // 2. DISPATCH & COGS RECOGNITION (The Physical & Financial "OUT" Gate)
  async fulfillDispatch(tenantId: string, salesOrderId: string, dispatchLines: { salesOrderItemId: string, lotId: string, dispatchQty: number }[], userEmail: string) {
    return await db.transaction(async (tx) => {
      
      // A. Fetch Settings & Validate
      const [settings] = await tx.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenantId));
      if (!settings?.cogsAccountId || !settings?.salesRevenueAccountId || !settings?.accountsReceivableId || !settings?.finishedGoodsAssetId) {
        throw new BadRequestException("Mandatory Sales/COGS Financial Accounts are not fully mapped in Settings.");
      }

      // B. Create Dispatch Note Header
      const [dispatchNote] = await tx.insert(schema.dispatchNotes).values({
        tenantId, salesOrderId, dispatchedBy: userEmail
      }).returning();

      let totalCogs = 0;
      let totalRevenue = 0;
      const dispatchItemsToInsert: any[] = [];

      // C. Process Each Dispatch Line (Strict Lot Deduction)
      for (const line of dispatchLines) {
        if (line.dispatchQty <= 0) continue;

        // 1. Fetch and validate the specific Inventory Lot
        const [lot] = await tx.select().from(schema.inventoryLots).where(and(eq(schema.inventoryLots.id, line.lotId), eq(schema.inventoryLots.tenantId, tenantId)));
        if (!lot || Number(lot.currentQuantity) < line.dispatchQty) {
          throw new BadRequestException(`Hard Block: Insufficient quantity in Lot ${lot?.lotNumber || line.lotId}. Requested ${line.dispatchQty}, Available: ${lot?.currentQuantity}`);
        }

        // 2. Fetch the Sales Order Item to get the Selling Price
        const [soItem] = await tx.select().from(schema.salesOrderItems).where(eq(schema.salesOrderItems.id, line.salesOrderItemId));

        // 3. Deduct from Strict Lot
        await tx.update(schema.inventoryLots)
          .set({ currentQuantity: sql`${schema.inventoryLots.currentQuantity} - ${line.dispatchQty}` })
          .where(eq(schema.inventoryLots.id, lot.id));

        // 4. Deduct from Global Product Master Inventory
        await tx.update(schema.products)
          .set({ currentStock: sql`${schema.products.currentStock} - ${line.dispatchQty}` })
          .where(eq(schema.products.id, lot.productId));

        // 5. Update SO Item Fulfilled Qty
        await tx.update(schema.salesOrderItems)
          .set({ fulfilledQuantity: sql`${schema.salesOrderItems.fulfilledQuantity} + ${line.dispatchQty}` })
          .where(eq(schema.salesOrderItems.id, soItem.id));

        // 6. Calculate Financials for this line
        const lineCogs = line.dispatchQty * Number(lot.unitCost);
        const lineRevenue = line.dispatchQty * Number(soItem.unitPrice);
        totalCogs += lineCogs;
        totalRevenue += lineRevenue;

        dispatchItemsToInsert.push({
          dispatchNoteId: dispatchNote.id,
          salesOrderItemId: soItem.id,
          inventoryLotId: lot.id,
          quantity: line.dispatchQty.toString(),
          cogsUnitCost: lot.unitCost.toString() // Snapshot the cost for historical integrity
        });
      }

      await tx.insert(schema.dispatchItems).values(dispatchItemsToInsert);

      // D. Update Sales Order Status (Check if fully fulfilled)
      const allItems = await tx.select().from(schema.salesOrderItems).where(eq(schema.salesOrderItems.salesOrderId, salesOrderId));
      const isFullyFulfilled = allItems.every(item => Number(item.fulfilledQuantity) >= Number(item.orderedQuantity));
      
      await tx.update(schema.salesOrders)
        .set({ status: isFullyFulfilled ? 'fulfilled' : 'partial' })
        .where(eq(schema.salesOrders.id, salesOrderId));

      // E. Double-Entry Accounting (The Financial Out-Gate)
      const [journalEntry] = await tx.insert(schema.journalEntries).values({
        tenantId, referenceId: dispatchNote.id, referenceType: 'sales_dispatch', description: `Dispatch & COGS for SO ${salesOrderId.substring(0,8)}`
      }).returning();

      const lines = [
        // Transaction 1: Remove FG Inventory, Recognize Expense (COGS)
        { tenantId, entryId: journalEntry.id, accountId: settings.cogsAccountId, debit: totalCogs.toFixed(2), credit: '0.00' },
        { tenantId, entryId: journalEntry.id, accountId: settings.finishedGoodsAssetId, debit: '0.00', credit: totalCogs.toFixed(2) }, // Assuming all dispatches are FG for simplicity
        
        // Transaction 2: Recognize Revenue, Increase Accounts Receivable
        { tenantId, entryId: journalEntry.id, accountId: settings.accountsReceivableId, debit: totalRevenue.toFixed(2), credit: '0.00' },
        { tenantId, entryId: journalEntry.id, accountId: settings.salesRevenueAccountId, debit: '0.00', credit: totalRevenue.toFixed(2) }
      ];

      await tx.insert(schema.journalLines).values(lines);

      return dispatchNote;
    });
}

async getSalesOrders(tenantId: string, startDate?: string, endDate?: string) {
    const conditions = [eq(schema.salesOrders.tenantId, tenantId)];
    
    if (startDate) conditions.push(gte(schema.salesOrders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.salesOrders.createdAt, end));
    }

    const orders = await db.select()
      .from(schema.salesOrders)
      .where(and(...conditions))
      .orderBy(desc(schema.salesOrders.createdAt))
      .limit(10);

    if (orders.length === 0) return [];

    const orderIds = orders.map(o => o.id);
    const items = await db.select({
      id: schema.salesOrderItems.id,
      salesOrderId: schema.salesOrderItems.salesOrderId,
      productId: schema.salesOrderItems.productId,
      productName: schema.products.name,
      orderedQuantity: schema.salesOrderItems.orderedQuantity,
      fulfilledQuantity: schema.salesOrderItems.fulfilledQuantity,
      unitPrice: schema.salesOrderItems.unitPrice
    })
    .from(schema.salesOrderItems)
    .innerJoin(schema.products, eq(schema.salesOrderItems.productId, schema.products.id))
    .where(inArray(schema.salesOrderItems.salesOrderId, orderIds));

    return orders.map(order => ({
      ...order,
      items: items.filter(i => i.salesOrderId === order.id)
    }));
  }
}