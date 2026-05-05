import { Controller, Get, Post, Body, Param, Request, UseGuards, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';


@Controller('api/sales')
@UseGuards(FirebaseAuthGuard, RolesGuard) 

export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('lots/:productId')
  async getValidLots(@Param('productId') productId: string, @Request() req: any) {
    return this.salesService.getValidLotsForProduct(req.user.tenantId, productId);
  }
  @Roles('ADMIN', 'MANAGER' ,'SUPERVISOR') // Only Admins, Managers, Supervisors can create sales orders. Operators are blocked.
  @Post('orders')
  async createOrder(@Body() payload: any, @Request() req: any) {
    return this.salesService.createSalesOrder(req.user.tenantId, payload);
  }

  @Post('orders/:id/dispatch')
  async dispatchOrder(@Param('id') id: string, @Body('dispatchLines') dispatchLines: any[], @Request() req: any) {
    return this.salesService.fulfillDispatch(req.user.tenantId, id, dispatchLines, req.user.email);
  }

 @Get('orders')
  async getOrders(@Request() req: any, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.salesService.getSalesOrders(req.user.tenantId, startDate, endDate);
  }

}