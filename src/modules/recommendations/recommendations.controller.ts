import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { RecommendationOrchestrator } from './recommendation-orchestrator.service';
import { ProductsService } from './products.service';
import { RecommendationDeliveryService } from './recommendation-delivery.service';

@ApiTags('recommendations')
@UseGuards(ApiKeyGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly orchestrator: RecommendationOrchestrator,
    private readonly productsService: ProductsService,
    private readonly deliveryService: RecommendationDeliveryService,
  ) {}

  // ── Catalog (global) ─────────────────────────────────────────────────────
  @Get('catalog')
  listCatalog() { return this.productsService.list(); }

  @Post('catalog')
  createProduct(@Body() body: Record<string, unknown>) { return this.productsService.create(body as Parameters<ProductsService['create']>[0]); }

  @Put('catalog/:id')
  updateProduct(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.productsService.update(id, body as Parameters<ProductsService['update']>[1]); }

  @Delete('catalog/:id')
  deleteProduct(@Param('id') id: string) { return this.productsService.delete(id); }

  // ── Analysis ─────────────────────────────────────────────────────────────
  @Post('analyze')
  analyze(@Body() body: { sessionId: string; phone: string; topN?: number }) { return this.orchestrator.analyze(body); }

  @Post('batch')
  async batch(@Body() body: { sessionId: string; phones: string[]; topN?: number }) {
    const generated = await this.orchestrator.batch(body.sessionId, body.phones, body.topN);
    return { generated };
  }

  // ── Pending / delivery ───────────────────────────────────────────────────
  @Get('pending')
  pending(@Query('sessionId') sessionId: string) { return this.orchestrator.listPending(sessionId); }

  @Post('deliver-all')
  deliverAll(@Body() body: { sessionId: string }) { return this.deliveryService.deliverAllPending(body.sessionId); }

  @Post('deliver-batch')
  deliverBatch(@Body() body: { sessionId: string; phone?: string }) {
    return body.phone
      ? this.deliveryService.deliverPendingForPhone(body.sessionId, body.phone)
      : this.deliveryService.deliverAllPending(body.sessionId);
  }

  // Dynamic routes — must come AFTER the static ones above.
  @Post(':id/deliver')
  deliver(@Param('id') id: string) { return this.deliveryService.deliverOne(id); }

  @Delete(':id')
  delete(@Param('id') id: string) { return this.orchestrator.deleteRecommendation(id); }
}
