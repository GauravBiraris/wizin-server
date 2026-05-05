import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductLinesModule } from './modules/product-lines/product-lines.module';
import { AuthModule } from './modules/auth/auth.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { SalesModule } from './modules/sales/sales.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [ProductLinesModule, AuthModule, MasterDataModule, WorkOrdersModule, AccountsModule, ProcurementModule, SalesModule, NotificationsModule, UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}