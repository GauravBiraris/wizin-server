import { Module } from '@nestjs/common';
import { ProductLinesService } from './product-lines.service';
import { ProductLinesController } from './product-lines.controller';

@Module({
  providers: [ProductLinesService],
  controllers: [ProductLinesController]
})
export class ProductLinesModule {}
