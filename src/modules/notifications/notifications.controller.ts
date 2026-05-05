import { Controller, Get, Put, Param, Request, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('api/notifications')
@UseGuards(FirebaseAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Route to fetch alerts for the Bell Icon
  @Get()
  async getUnread(@Request() req: any) {
    return this.notificationsService.getUnreadNotifications(req.user.tenantId);
  }

  // Route to dismiss an alert
  @Put(':id/read')
  @Roles('ADMIN', 'MANAGER')
  async markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.notificationsService.markAsRead(req.user.tenantId, id);
  }
}