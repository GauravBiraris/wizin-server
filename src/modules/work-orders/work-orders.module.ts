import { Module } from '@nestjs/common';
import { WorkOrdersService,  } from './work-orders.service';
import { WorkOrdersController } from './work-orders.controller';
import { ProductLinesService,  } from '../product-lines/product-lines.service'; // Import the ProductLinesService
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [WorkOrdersService, ProductLinesService],
  controllers: [WorkOrdersController]
})
export class WorkOrdersModule {}
