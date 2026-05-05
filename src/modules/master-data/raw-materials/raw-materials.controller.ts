import { Controller, Get, Put, Post, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { RawMaterialsService } from './raw-materials.service';
import type { CreateRawMaterialDto } from './raw-materials.service';
import { FirebaseAuthGuard } from '../../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';

@Controller('api/master-data/raw-materials')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER', 'SUPERVISOR')
export class RawMaterialsController {
  constructor(private readonly rawMaterialsService: RawMaterialsService) {}

  @Get()
  async getAll(@Request() req: any) {
    return this.rawMaterialsService.findAll(req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateRawMaterialDto, @Request() req: any) {
    return this.rawMaterialsService.create(req.user.tenantId, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  async delete(@Param('id') id: string, @Request() req: any) {
    return this.rawMaterialsService.delete(req.user.tenantId, id);
  }
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: CreateRawMaterialDto, @Request() req: any) {
    return this.rawMaterialsService.update(req.user.tenantId, id, dto);
  }
  @Put(':id/direct-edit')
  @Roles('ADMIN', 'MANAGER')
  async directInventoryEdit(
    @Param('id') id: string,
    @Body() payload: { newStock: number; reason: string },
    @Request() req: any
  ) {
    // req.user comes from your authentication guard
    return this.rawMaterialsService.directInventoryEdit(
      req.user.tenantId,
      id,
      payload.newStock,
      payload.reason,
      req.user.email 
    );
  }

  
}