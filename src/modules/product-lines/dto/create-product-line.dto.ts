export interface CreateStepInputDto {
  rawMaterialId?: string;
  laborId?: string;
  machineId?: string;
  utilityId?: string;
  vendorId?: string;
  quantity: number;
  customCostOverride?: number;
}

export interface CreateStepOutputDto {
  productId: string;
  quantity: number;
}

export interface CreateProductLineStepDto {
  stepOrder: number;
  name: string;
  timeSpanHours: number;
  inputs: any[]; 
  outputs: CreateStepOutputDto[];
}

export interface CreateProductLineDto {
  name: string;
  mainProductId: string;
  baseQuantity: number;
  steps: CreateProductLineStepDto[];
}