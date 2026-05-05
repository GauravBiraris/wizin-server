import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { RegistriesService } from './registries.service';
import { FirebaseAuthGuard } from '../../../common/guards/firebase-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';

@Controller('api/master-data')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER' ,'SUPERVISOR')
export class RegistriesController {
  constructor(private readonly registriesService: RegistriesService) {}

  @Get('labor') async getLabor(@Request() req: any) { return this.registriesService.getLabor(req.user.tenantId); }
  @Post('labor') async createLabor(@Body() dto: any, @Request() req: any) { return this.registriesService.createLabor(req.user.tenantId, dto); }
  @Delete('labor/:id') @Roles('ADMIN', 'MANAGER') async deleteLabor(@Param('id') id: string, @Request() req: any) { return this.registriesService.deleteLabor(req.user.tenantId, id); }

  @Get('machines') async getMachines(@Request() req: any) { return this.registriesService.getMachines(req.user.tenantId); }
  @Post('machines') async createMachine(@Body() dto: any, @Request() req: any) { return this.registriesService.createMachine(req.user.tenantId, dto); }
  @Delete('machines/:id') async deleteMachine(@Param('id') id: string, @Request() req: any) { return this.registriesService.deleteMachine(req.user.tenantId, id); }

  @Get('utilities') async getUtilities(@Request() req: any) { return this.registriesService.getUtilities(req.user.tenantId); }
  @Post('utilities') async createUtility(@Body() dto: any, @Request() req: any) { return this.registriesService.createUtility(req.user.tenantId, dto); }
  @Delete('utilities/:id') @Roles('ADMIN', 'MANAGER') async deleteUtility(@Param('id') id: string, @Request() req: any) { return this.registriesService.deleteUtility(req.user.tenantId, id); }

  @Get('vendors') async getVendors(@Request() req: any) { return this.registriesService.getVendors(req.user.tenantId); }
  @Post('vendors') async createVendor(@Body() dto: any, @Request() req: any) { return this.registriesService.createVendor(req.user.tenantId, dto); }
  @Delete('vendors/:id') @Roles('ADMIN', 'MANAGER')async deleteVendor(@Param('id') id: string, @Request() req: any) { return this.registriesService.deleteVendor(req.user.tenantId, id); }
  @Put('vendors/:id') 
  async updateVendor(@Param('id') id: string, @Body() dto: any, @Request() req: any) { 
    return this.registriesService.updateVendor(req.user.tenantId, id, dto); 
  }
  @Put('labor/:id') async updateLabor(@Param('id') id: string, @Body() dto: any, @Request() req: any) { return this.registriesService.updateLabor(req.user.tenantId, id, dto); }
  @Put('machines/:id') async updateMachine(@Param('id') id: string, @Body() dto: any, @Request() req: any) { return this.registriesService.updateMachine(req.user.tenantId, id, dto); }
  @Put('utilities/:id') async updateUtility(@Param('id') id: string, @Body() dto: any, @Request() req: any) { return this.registriesService.updateUtility(req.user.tenantId, id, dto); }
  
  
  @Get('products') async getProducts(@Request() req: any) { return this.registriesService.getProducts(req.user.tenantId); }
  @Post('products') async createProduct(@Body() dto: any, @Request() req: any) { return this.registriesService.createProduct(req.user.tenantId, dto); }
  @Put('products/:id') async updateProduct(@Param('id') id: string, @Body() dto: any, @Request() req: any) { return this.registriesService.updateProduct(req.user.tenantId, id, dto); }
  @Delete('products/:id') @Roles('ADMIN', 'MANAGER')  async deleteProduct(@Param('id') id: string, @Request() req: any) { return this.registriesService.deleteProduct(req.user.tenantId, id); }
  
  @Put('registries/products/:id/direct-edit')
  @Roles('ADMIN', 'MANAGER')
  async directInventoryEdit(
    @Param('id') id: string,
    @Body() payload: { newStock: number; reason: string },
    @Request() req: any
  ) {
    return this.registriesService.directInventoryEdit(
      req.user.tenantId,
      id,
      payload.newStock,
      payload.reason,
      req.user.email
    );
  }
  
  @Get('customers')
  async getCustomers(@Request() req: any) {
    return this.registriesService.getCustomers(req.user.tenantId);
  }
  
}