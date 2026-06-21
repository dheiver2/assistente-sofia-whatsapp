import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { RecommendationOrchestrator } from './recommendation-orchestrator.service';
import { ProductsService } from './products.service';

@ApiTags('recommendations')
@UseGuards(ApiKeyGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly orchestrator: RecommendationOrchestrator,
    private readonly productsService: ProductsService,
  ) {}

  // ── Products catalog ─────────────────────────────────────────────────────
  @Get('products')
  listProducts(@Query('sessionId') sessionId: string) { return this.productsService.list(sessionId); }

  @Post('products')
  createProduct(@Body() body: Record<string, unknown>) { return this.productsService.create(body as Parameters<ProductsService['create']>[0]); }

  @Post('products/:id')
  updateProduct(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.productsService.update(id, body as Parameters<ProductsService['update']>[1]); }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) { return this.productsService.delete(id); }

  // ── Orchestration ────────────────────────────────────────────────────────
  @Post('analyze')
  analyze(@Body() body: { sessionId: string; phone: string; topN?: number; externalData?: Record<string, unknown> }) {
    return this.orchestrator.orchestrate(body);
  }

  @Post('batch')
  batch(@Body() body: { sessionId: string; phones: string[]; campaignId?: string }) {
    return this.orchestrator.orchestrateBatch(body.phones, body.sessionId, body.campaignId);
  }

  @Get('pending')
  pending(@Query('sessionId') sessionId: string) { return this.orchestrator.getPendingRecommendations(sessionId); }

  @Delete(':id')
  delete(@Param('id') id: string) { return this.orchestrator.deleteRecommendation(id); }
}
