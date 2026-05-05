import { ProductLinesService } from './product-lines.service';
import { Controller, Get, Post, Body, Put, Param, Request, UseGuards } from '@nestjs/common';
import type { CreateProductLineDto } from './dto/create-product-line.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('product-lines')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER' ,'SUPERVISOR')

export class ProductLinesController {
  constructor(private readonly productLinesService: ProductLinesService) {}

  @Roles('ADMIN', 'MANAGER' ,'SUPERVISOR', 'OPERATOR')  
  @Get(':id/cost')
  async getPlannedCost(@Param('id') id: string, @Request() req: any) {
    // IMPORTANT: For now, we are bypassing auth. 
    // In the next step, req.user.tenantId will be populated by our Firebase Guard.
    const tenantId = req.headers['x-tenant-id']; 
    
    return this.productLinesService.calculatePlannedCost(id, tenantId);
  }

  @Post()
  async createProductLine(@Body() payload: CreateProductLineDto, @Request() req: any) {
    const tenantId = req.user.tenantId; // Secured via FirebaseAuthGuard
    return this.productLinesService.createProductLine(tenantId, payload);
  }

  @Roles('ADMIN', 'MANAGER' ,'SUPERVISOR', 'OPERATOR')  
  @Get()
  async findAll(@Request() req: any) {
    return this.productLinesService.findAll(req.user.tenantId);
  }

  @Roles('ADMIN', 'MANAGER' ,'SUPERVISOR', 'OPERATOR')
  @Get(':id')
async findOne(@Param('id') id: string, @Request() req: any) {
  return this.productLinesService.findOne(id, req.user.tenantId);
}

  @Put(':id')
  async updateProductLine(@Param('id') id: string, @Body() dto: any, @Request() req: any) {
    return this.productLinesService.updateProductLine(req.user.tenantId, id, dto);
  }

}