import { Test, TestingModule } from '@nestjs/testing';
import { ProductLinesController } from './product-lines.controller';

describe('ProductLinesController', () => {
  let controller: ProductLinesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductLinesController],
    }).compile();

    controller = module.get<ProductLinesController>(ProductLinesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
