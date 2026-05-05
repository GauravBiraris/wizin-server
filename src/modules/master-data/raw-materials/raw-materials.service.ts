import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { db } from '../../../db';
import * as schema from '../../../db/schema';
import { NotificationsService } from '../../notifications/notifications.service';

export interface CreateRawMaterialDto {
  sku: string;
  name: string;
  currentStock: number;
  reorderLevel: number;
  unitPrice: number;
  uom: string;
}

@Injectable()
export class RawMaterialsService {
  
  async findAll(tenantId: string) {
    return await db.select()
      .from(schema.rawMaterials)
      .where(eq(schema.rawMaterials.tenantId, tenantId));
  }

  async create(tenantId: string, dto: CreateRawMaterialDto) {
    const [newMaterial] = await db.insert(schema.rawMaterials).values({
      tenantId,
      sku: dto.sku,
      name: dto.name,
      currentStock: dto.currentStock.toString(), // Neon decimal requires string parsing
      reorderLevel: dto.reorderLevel.toString(),
      unitPrice: dto.unitPrice.toString(),
      uom: dto.uom,
    }).returning();
    
    return newMaterial;
  }

  async delete(tenantId: string, id: string) {
    const [deleted] = await db.delete(schema.rawMaterials)
      .where(and(
        eq(schema.rawMaterials.id, id),
        eq(schema.rawMaterials.tenantId, tenantId)
      ))
      .returning();

    if (!deleted) throw new NotFoundException('Material not found');
    return { success: true, id: deleted.id };
  }

  async update(tenantId: string, id: string, dto: Partial<CreateRawMaterialDto>) {
    const [updated] = await db.update(schema.rawMaterials)
      .set({
        sku: dto.sku,
        name: dto.name,
        reorderLevel: dto.reorderLevel?.toString(),
        unitPrice: dto.unitPrice?.toString(),
        uom: dto.uom,
      })
      .where(and(eq(schema.rawMaterials.id, id), eq(schema.rawMaterials.tenantId, tenantId)))
      .returning();

    if (!updated) throw new NotFoundException('Material not found');
    return updated;
  }

  constructor(private notificationsService: NotificationsService) {}
  async directInventoryEdit(tenantId: string, rmId: string, newStock: number, reason: string, userEmail: string) {
    return await db.transaction(async (tx) => {
      // 1. Resolve and Strictly Validate the User UUID
      const [internalUser] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, userEmail));
      if (!internalUser) {
        throw new BadRequestException(`Audit Error: User with email ${userEmail} not found in the system.`);
      }
      const userId = internalUser.id;
      
      // 1. Verify Tenant Settings allow this
      const [settings] = await tx.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenantId));
      if (!settings?.allowDirectInventoryEdit) throw new BadRequestException("Direct inventory editing is disabled in Tenant Settings.");
      if (!reason || reason.trim() === '') throw new BadRequestException("A valid reason is required for manual inventory adjustments.");

      const [rm] = await tx.select().from(schema.rawMaterials).where(eq(schema.rawMaterials.id, rmId));
      if (!rm) throw new BadRequestException("Raw material not found.");

      const oldStock = Number(rm.currentStock) || 0;
      const delta = newStock - oldStock;

      if (delta !== 0) {
        // 2. Update Stock
        await tx.update(schema.rawMaterials).set({ currentStock: newStock.toString() }).where(eq(schema.rawMaterials.id, rmId));

        // 3. Log Immutable Audit Trail
        await tx.insert(schema.materialLedger).values({
          tenantId, rawMaterialId: rmId, quantityChange: delta.toString(),
          referenceType: 'manual_adjustment', reason, recordedBy: userId
        });

        // 4. Fire Reorder Trigger if stock decreased
        if (delta < 0) {
          await this.notificationsService.evaluateReorderLevel(tx, tenantId, rmId, newStock);
        }
      }
      return { success: true, newStock };
    });
}
}