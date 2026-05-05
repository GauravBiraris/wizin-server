import { Test, TestingModule } from '@nestjs/testing';
import { ProductLinesService } from './product-lines.service';

describe('ProductLinesService', () => {
  let service: ProductLinesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductLinesService],
    }).compile();

    service = module.get<ProductLinesService>(ProductLinesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
