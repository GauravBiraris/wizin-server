 
import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, desc, and, asc, inArray } from 'drizzle-orm';
import { db } from '../../db'; // Assumes db is exported from src/db/index.ts
import * as schema from '../../db/schema';
import { CreateProductLineDto } from './dto/create-product-line.dto';

// 1. Exported interfaces fix the Controller inference errors
export interface StepInputDetail {
  resourceType: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface BreakdownItem {
  stepName: string;
  stepTotalCost: number;
  inputs: StepInputDetail[];
}

@Injectable()
export class ProductLinesService {

    async findOne(id: string, tenantId: string) {
  // 1. Fetch the parent Product Line
  const [line] = await db.select().from(schema.productLines)
    .where(and(eq(schema.productLines.id, id), eq(schema.productLines.tenantId, tenantId)));

  if (!line) throw new NotFoundException('Recipe not found');

  // 2. Fetch all Steps in order
  const steps = await db.select().from(schema.productLineSteps)
    .where(eq(schema.productLineSteps.productLineId, id))
    .orderBy(asc(schema.productLineSteps.stepOrder));

  // 3. For each step, fetch Inputs and Outputs with their master data names
  const detailedSteps = await Promise.all(steps.map(async (step) => {
    // 1. Fetch raw data strictly using database columns
const rawInputs = await db.select({
      id: schema.stepInputs.id,
      quantity: schema.stepInputs.quantity,
      rawMaterialId: schema.stepInputs.rawMaterialId,
      laborId: schema.stepInputs.laborId,
      machineId: schema.stepInputs.machineId,
      utilityId: schema.stepInputs.utilityId,
      vendorId: schema.stepInputs.vendorId,
      rawMaterialName: schema.rawMaterials.name,
      laborTitle: schema.labor.title,
      machineName: schema.machines.name,
      utilityName: schema.utilities.name,
      vendorName: schema.vendors.name,
      uom: schema.rawMaterials.uom,
      // ADD THESE FIVE LINES:
      rawMaterialRate: schema.rawMaterials.unitPrice,
      laborRate: schema.labor.hourlyRate,
      machineRate: schema.machines.hourlyCost,
      utilityRate: schema.utilities.ratePerUnit,
      vendorRate: schema.vendors.rate,
    })
    .from(schema.stepInputs)
    .leftJoin(schema.rawMaterials, eq(schema.stepInputs.rawMaterialId, schema.rawMaterials.id))
    .leftJoin(schema.labor, eq(schema.stepInputs.laborId, schema.labor.id))
    .leftJoin(schema.machines, eq(schema.stepInputs.machineId, schema.machines.id))
    .leftJoin(schema.utilities, eq(schema.stepInputs.utilityId, schema.utilities.id))
    .leftJoin(schema.vendors, eq(schema.stepInputs.vendorId, schema.vendors.id))
    .where(eq(schema.stepInputs.stepId, step.id));

    // 2. Map the resourceType using standard JavaScript
    const inputs = rawInputs.map(i => ({
      id: i.id,
      quantity: i.quantity,
      resourceType: i.rawMaterialId ? 'raw_material' : 
                    i.laborId ? 'labor' : 
                    i.machineId ? 'machine' : 
                    i.utilityId ? 'utility' : 'vendor',
      resourceId: i.rawMaterialId || i.laborId || i.machineId || i.utilityId || i.vendorId,
      rawMaterialName: i.rawMaterialName,
      laborTitle: i.laborTitle,
      machineName: i.machineName,
      utilityName: i.utilityName,
      vendorName: i.vendorName,
      uom: i.uom,

      rate: i.rawMaterialRate || i.laborRate || i.machineRate || i.utilityRate || i.vendorRate
    }));

    const outputs = await db.select({
      productId: schema.stepOutputs.productId,
      quantity: schema.stepOutputs.quantity,
      resourceName: schema.products.name,
      uom: schema.products.uom,
      sellingPrice: schema.products.sellingPrice
    })
    .from(schema.stepOutputs)
    .leftJoin(schema.products, eq(schema.stepOutputs.productId, schema.products.id))
    .where(eq(schema.stepOutputs.stepId, step.id));

    return { ...step, inputs, outputs };
  }));

  return { ...line, steps: detailedSteps };
}
  
    async findAll(tenantId: string) {
    return await db.select({
      id: schema.productLines.id,
      name: schema.productLines.name,
      baseQuantity: schema.productLines.baseQuantity,
      mainProductName: schema.products.name,
      mainProductSku: schema.products.sku,
    })
    .from(schema.productLines)
    .leftJoin(schema.products, eq(schema.productLines.mainProductId, schema.products.id))
    .where(eq(schema.productLines.tenantId, tenantId))
    .orderBy(desc(schema.productLines.id));
  }

  async calculatePlannedCost(productLineId: string, tenantId: string) {
    // 1. Fetch the Product Line
    const [productLine] = await db
      .select()
      .from(schema.productLines)
      .where(eq(schema.productLines.id, productLineId));

    if (!productLine || productLine.tenantId !== tenantId) {
      throw new NotFoundException('Product line not found');
    }

    // 2. Fetch all steps for this product line
    const steps = await db
      .select()
      .from(schema.productLineSteps)
      .where(eq(schema.productLineSteps.productLineId, productLineId));

    let totalPlannedCost = 0;
    
    // Explicitly typing the array prevents the 'never[]' error
    const breakdown: BreakdownItem[] = []; 

    // 3. Iterate through steps and resolve specific ID inputs
    for (const step of steps) {
      const inputs = await db
        .select()
        .from(schema.stepInputs)
        .where(eq(schema.stepInputs.stepId, step.id));

      let stepCost = 0;
      
      // Explicitly typing the array prevents the 'never[]' error
      const stepInputDetails: StepInputDetail[] = []; 

      for (const input of inputs) {
        let resourceType = 'unknown';
        let unitCost = 0;

        // 4. Determine resource type based on which explicit ID is present
        if (input.rawMaterialId) {
          resourceType = 'raw_material';
          const [rm] = await db.select().from(schema.rawMaterials).where(eq(schema.rawMaterials.id, input.rawMaterialId));
          unitCost = rm ? Number(rm.unitPrice) : 0;
        } else if (input.laborId) {
          resourceType = 'labor';
          const [lb] = await db.select().from(schema.labor).where(eq(schema.labor.id, input.laborId));
          unitCost = lb ? Number(lb.hourlyRate) : 0;
        } else if (input.machineId) {
          resourceType = 'machine';
          const [mc] = await db.select().from(schema.machines).where(eq(schema.machines.id, input.machineId));
          unitCost = mc ? Number(mc.hourlyCost) : 0;
        } else if (input.utilityId) {
          resourceType = 'utility';
          const [ut] = await db.select().from(schema.utilities).where(eq(schema.utilities.id, input.utilityId));
          unitCost = ut ? Number(ut.ratePerUnit) : 0;
        } else if (input.vendorId) {
          resourceType = 'vendor';
          const [vd] = await db.select().from(schema.vendors).where(eq(schema.vendors.id, input.vendorId));
          unitCost = vd ? Number(vd.rate) : 0;
        }

        // 5. Apply custom override if the user specified one for this specific recipe step
        if (input.customCostOverride !== null) {
          unitCost = Number(input.customCostOverride);
        }

        const inputTotalCost = unitCost * Number(input.quantity);
        stepCost += inputTotalCost;
        
        stepInputDetails.push({
          resourceType,
          quantity: Number(input.quantity),
          unitCost,
          totalCost: inputTotalCost
        });
      }

      totalPlannedCost += stepCost;
      breakdown.push({
        stepName: step.name,
        stepTotalCost: stepCost,
        inputs: stepInputDetails
      });
    }

    // Convert the string decimal from the database into a JavaScript number
    const baseQuantityNum = Number(productLine.baseQuantity);
    
    // Protect against division by zero just in case
    const costPerUnit = baseQuantityNum > 0 ? totalPlannedCost / baseQuantityNum : 0;

    // Returns exact planned cost, accounting for materials, labor, and overheads 
    return {
      productLineId,
      name: productLine.name,
      baseQuantity: baseQuantityNum,
      totalPlannedCost,
      costPerUnit,
      breakdown,
    };
  }

 
  async createProductLine(tenantId: string, payload: CreateProductLineDto) {
    try {
      return await db.transaction(async (tx) => {
        // 1. Create the Product Line Parent
        const [newProductLine] = await tx.insert(schema.productLines).values({
          tenantId,
          name: payload.name,
          mainProductId: payload.mainProductId || null, // Safely handles if no main product is selected
          baseQuantity: payload.baseQuantity.toString(),
        }).returning();

        // 2. Iterate and Create Steps
        for (const step of payload.steps) {
          const [newStep] = await tx.insert(schema.productLineSteps).values({
            tenantId,
            productLineId: newProductLine.id,
            stepOrder: step.stepOrder,
            name: step.name,
            timeSpanHours: step.timeSpanHours.toString(),
          }).returning();

          // 3. Explicitly Map and Insert Inputs (Guarantees null instead of undefined)
          if (step.inputs && step.inputs.length > 0) {
            const safeInputs = step.inputs.map(i => ({
              tenantId,
              stepId: newStep.id,
              rawMaterialId: i.rawMaterialId || null,
              laborId: i.laborId || null,
              machineId: i.machineId || null,
              utilityId: i.utilityId || null,
              vendorId: i.vendorId || null,
              quantity: i.quantity.toString(),
              customCostOverride: null // Add logic here later if you enable custom overrides in UI
            }));
            await tx.insert(schema.stepInputs).values(safeInputs);
          }

          // 4. Explicitly Map and Insert Outputs
          if (step.outputs && step.outputs.length > 0) {
            const safeOutputs = step.outputs.map(o => ({
              tenantId,
              stepId: newStep.id,
              productId: o.productId, // This cannot be null
              quantity: o.quantity.toString()
            }));
            await tx.insert(schema.stepOutputs).values(safeOutputs);
          }
        }

        return { success: true, id: newProductLine.id };
      });
    } catch (error) {
      console.error("--- TRANSACTION FAILED ---");
      console.error(error);
      throw error; // Let NestJS throw the 500, but now we have the exact trace in the terminal
    }
  }

  async updateProductLine(tenantId: string, id: string, payload: CreateProductLineDto) {
    try {
      return await db.transaction(async (tx) => {
        // 1. Update the Product Line Parent
        const [updatedLine] = await tx.update(schema.productLines).set({
          name: payload.name,
          mainProductId: payload.mainProductId || null,
          baseQuantity: payload.baseQuantity.toString(),
        })
        .where(and(eq(schema.productLines.id, id), eq(schema.productLines.tenantId, tenantId)))
        .returning();

        if (!updatedLine) throw new NotFoundException('Product line not found');

        // 2. Safely clear old steps, inputs, and outputs to prevent duplicates
        const existingSteps = await tx.select({ id: schema.productLineSteps.id })
          .from(schema.productLineSteps)
          .where(eq(schema.productLineSteps.productLineId, id));

        const stepIds = existingSteps.map(s => s.id);

        if (stepIds.length > 0) {
           await tx.delete(schema.stepInputs).where(inArray(schema.stepInputs.stepId, stepIds));
           await tx.delete(schema.stepOutputs).where(inArray(schema.stepOutputs.stepId, stepIds));
           await tx.delete(schema.productLineSteps).where(eq(schema.productLineSteps.productLineId, id));
        }

        // 3. Insert the new Steps, Inputs, and Outputs
        for (const step of payload.steps) {
          const [newStep] = await tx.insert(schema.productLineSteps).values({
            tenantId,
            productLineId: updatedLine.id,
            stepOrder: step.stepOrder,
            name: step.name,
            timeSpanHours: step.timeSpanHours.toString(),
          }).returning();

          if (step.inputs && step.inputs.length > 0) {
            const safeInputs = step.inputs.map(i => ({
              tenantId,
              stepId: newStep.id,
              rawMaterialId: i.rawMaterialId || null,
              laborId: i.laborId || null,
              machineId: i.machineId || null,
              utilityId: i.utilityId || null,
              vendorId: i.vendorId || null,
              quantity: i.quantity.toString()
            }));
            await tx.insert(schema.stepInputs).values(safeInputs);
          }

          if (step.outputs && step.outputs.length > 0) {
            const safeOutputs = step.outputs.map(o => ({
              tenantId,
              stepId: newStep.id,
              productId: o.productId,
              quantity: o.quantity.toString()
            }));
            await tx.insert(schema.stepOutputs).values(safeOutputs);
          }
        }

        return { success: true, id: updatedLine.id };
      });
    } catch (error) {
      console.error("--- UPDATE TRANSACTION FAILED ---");
      console.error(error);
      throw error;
    }
  }

}