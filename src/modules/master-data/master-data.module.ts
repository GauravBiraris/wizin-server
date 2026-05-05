import { Module } from '@nestjs/common';
import { RawMaterialsService } from './raw-materials/raw-materials.service';
import { RawMaterialsController } from './raw-materials/raw-materials.controller';
import { RegistriesService } from './registries/registries.service';
import { RegistriesController } from './registries/registries.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [RawMaterialsService, RegistriesService],
  controllers: [RawMaterialsController, RegistriesController]
})
export class MasterDataModule {}
