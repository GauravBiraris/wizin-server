import { Controller, Put, Get, Query, Post, Param, Request, Body, UseGuards } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('api/procurement')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER' ,'SUPERVISOR')
export class ProcurementController {
    constructor(private readonly procurementService: ProcurementService) {}

    @Put('po/:id/approve')
  async approvePO(@Param('id') id: string, @Request() req: any) {
    return this.procurementService.approvePO(req.user.tenantId, id, req.user.email);
  }

  @Post('po/:id/receive')
  async receiveGRN(@Param('id') id: string, @Body('extraCosts') extraCosts: number, @Request() req: any) {
    return this.procurementService.receiveGRN(req.user.tenantId, id, extraCosts || 0, req.user.email);
  }

@Get('po')
  async getAllPOs(@Request() req: any, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.procurementService.getAllPOs(req.user.tenantId, startDate, endDate);
  }

  @Roles('ADMIN', 'MANAGER' ,'SUPERVISOR', 'OPERATOR') // All roles can create POs, including Operators who are blocked from other actions.
  @Post('po')
  async createPO(@Body() payload: any, @Request() req: any) {
    return this.procurementService.createPO(req.user.tenantId, payload, req.user.email);
  }

}
