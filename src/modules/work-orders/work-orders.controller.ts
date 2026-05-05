// src/modules/work-orders/work-orders.controller.ts
import { Controller, Get, Post, Put, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { WorkOrdersService } from './work-orders.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('api/work-orders')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER', 'SUPERVISOR') // Default: Operators CANNOT access anything here unless overridden
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  // APPLIES CLASS DEFAULT: Only Admins, Managers, Supervisors can create orders
@Post()
  async create(@Body() dto: { productLineId: string; targetQuantity: number }, @Request() req: any) {
    return this.workOrdersService.create(req.user.tenantId, dto, req.user.email);
  }

  // OVERRIDE (OPEN UP): We explicitly add OPERATOR so they can view the list
@Get()
@Roles('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR')
  async findAll(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.workOrdersService.findAll(req.user.tenantId, startDate, endDate);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.workOrdersService.findOne(req.user.tenantId, id);
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body('status') status: string, @Body('force') force: boolean, @Request() req: any) {
    return this.workOrdersService.updateStatus(req.user.tenantId, id, status, req.user.email, force);
  }

  @Roles('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR')
  @Put('runs/:runId/status')
  async updateRunStatus(@Param('runId') runId: string, @Body('status') status: string, @Request() req: any) {
    // Note: req.user.email requires your firebase-auth.guard to pass the email along with tenantId
    return this.workOrdersService.updateRunStatus(req.user.tenantId, runId, status, req.user.email || 'Operator');
  }

  @Roles('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR')
  @Post(':id/log')
  async addLog(@Param('id') id: string, @Body('message') message: string, @Request() req: any) {
    return this.workOrdersService.addLog(req.user.tenantId, id, message, req.user.email || 'Operator');
  }

  @Roles('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR')
  @Get('monitor/:productLineId')
  @Roles('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR')
  async getResourceMonitor(@Param('productLineId') productLineId: string, @Request() req: any) {
    return this.workOrdersService.getResourceMonitorLoad(req.user.tenantId, productLineId);
  }

  @Get('kanban/:productLineId')
  async getKanbanBoard(@Param('productLineId') productLineId: string, @Request() req: any) {
    return this.workOrdersService.getKanbanBoard(req.user.tenantId, productLineId);
  }
 
  @Put(':id/start')
  @Roles('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR')
  async startWorkOrder(@Param('id') id: string, @Body('force') force: boolean, @Request() req: any) {
    return this.workOrdersService.startWorkOrder(req.user.tenantId, id, req.user.email, force);
  }

  @Post(':id/complete')
  async completeWorkOrder(
    @Param('id') id: string, 
    // FIX: Added actualUsages to the expected payload signature
    @Body() payload: { actualYield: number; rejectedYield: number; actualUsages?: Record<string, number> }, 
    @Request() req: any
  ) {
    const userEmail = req.user.email; 
    return this.workOrdersService.completeWorkOrder(req.user.tenantId, id, payload, userEmail);
  }

  @Get('reports/variance')
  async getVarianceReport(@Request() req: any, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.workOrdersService.getVarianceReport(req.user.tenantId, startDate, endDate);
  }

}