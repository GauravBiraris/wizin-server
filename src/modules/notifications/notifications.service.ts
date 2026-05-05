import { Injectable } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class NotificationsService {
  
  // Method to fetch alerts for the frontend Bell Icon
  async getUnreadNotifications(tenantId: string) {
    return await db.select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, tenantId), eq(schema.notifications.isRead, false)))
      .orderBy(desc(schema.notifications.createdAt));
  }

  async markAsRead(tenantId: string, notificationId: string) {
    return await db.update(schema.notifications)
      .set({ isRead: true })
      .where(and(eq(schema.notifications.id, notificationId), eq(schema.notifications.tenantId, tenantId)));
  }

  // THE TRIGGER: Call this whenever Raw Material stock decreases
  async evaluateReorderLevel(tx: any, tenantId: string, rawMaterialId: string, newStock: number) {
    const [rm] = await tx.select().from(schema.rawMaterials).where(eq(schema.rawMaterials.id, rawMaterialId));
    
    if (rm && rm.reorderLevel && newStock <= Number(rm.reorderLevel)) {
      // Optional: Check if an unread alert already exists to prevent spamming
      const existing = await tx.select().from(schema.notifications).where(and(
        eq(schema.notifications.tenantId, tenantId),
        eq(schema.notifications.type, 'reorder_alert'),
        eq(schema.notifications.isRead, false),
        eq(schema.notifications.title, `Low Stock: ${rm.name}`)
      ));

      if (existing.length === 0) {
        await tx.insert(schema.notifications).values({
          tenantId,
          type: 'reorder_alert',
          title: `Low Stock: ${rm.name}`,
          message: `Inventory has dropped to ${newStock} ${rm.uom}. The reorder threshold is ${rm.reorderLevel}. Please initiate a Purchase Order.`
        });
      }
    }
  }
}