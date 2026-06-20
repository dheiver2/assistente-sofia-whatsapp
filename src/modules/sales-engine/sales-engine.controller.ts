import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { SalesEngineService } from './sales-engine.service';
import { CampaignService } from './campaign.service';
import { GenerateOutreachDto, OutreachResultDto } from './dto/generate-outreach.dto';
import {
  CreateCampaignDto,
  CreateLeadSourceDto,
  GenerateCampaignDto,
  OptOutDto,
  UpdateOutreachDto,
} from './dto/sales.dto';
import { Campaign, LeadSource, Outreach, OutreachStage } from './entities/sales.entities';

@ApiTags('sales-engine')
@Controller('sales')
export class SalesEngineController {
  constructor(
    private readonly salesEngine: SalesEngineService,
    private readonly campaignService: CampaignService,
  ) {}

  // ---- Preview rápido (sem persistir) ----
  @Post('outreach/generate')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Preview: gera abordagem por lead (necessidade + mensagem). NÃO envia.' })
  async generate(@Body() dto: GenerateOutreachDto): Promise<OutreachResultDto[]> {
    return this.salesEngine.generateOutreach(dto);
  }

  // ---- Fontes de leads (Item 1) ----
  @Get('sources')
  @ApiOperation({ summary: 'Lista fontes de leads de uma sessão/empresa' })
  listSources(@Query('sessionId') sessionId: string): Promise<LeadSource[]> {
    return this.campaignService.listSources(sessionId);
  }
  @Post('sources')
  @RequireRole(ApiKeyRole.OPERATOR)
  createSource(@Body() dto: CreateLeadSourceDto): Promise<LeadSource> {
    return this.campaignService.createSource(dto);
  }
  @Post('sources/:id/test')
  @RequireRole(ApiKeyRole.OPERATOR)
  testSource(@Param('id') id: string): Promise<{ ok: boolean; message: string }> {
    return this.campaignService.testSource(id);
  }
  @Delete('sources/:id')
  @RequireRole(ApiKeyRole.OPERATOR)
  deleteSource(@Param('id') id: string): Promise<void> {
    return this.campaignService.deleteSource(id);
  }

  // ---- Campanhas (Item 2) ----
  @Get('campaigns')
  @ApiOperation({ summary: 'Lista campanhas de uma sessão/empresa' })
  listCampaigns(@Query('sessionId') sessionId: string): Promise<Campaign[]> {
    return this.campaignService.listCampaigns(sessionId);
  }
  @Post('campaigns')
  @RequireRole(ApiKeyRole.OPERATOR)
  createCampaign(@Body() dto: CreateCampaignDto): Promise<Campaign> {
    return this.campaignService.createCampaign(dto);
  }
  @Delete('campaigns/:id')
  @RequireRole(ApiKeyRole.OPERATOR)
  deleteCampaign(@Param('id') id: string): Promise<void> {
    return this.campaignService.deleteCampaign(id);
  }

  @Post('campaigns/:id/generate')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Gera as abordagens da campanha (busca leads na fonte + roda a IA)' })
  generateCampaign(@Param('id') id: string, @Body() dto: GenerateCampaignDto): Promise<Outreach[]> {
    return this.campaignService.generate(id, dto.leads);
  }

  @Get('campaigns/:id/outreach')
  @ApiOperation({ summary: 'Lista as abordagens geradas (para revisão)' })
  listOutreach(@Param('id') id: string): Promise<Outreach[]> {
    return this.campaignService.listOutreach(id);
  }

  @Put('outreach/:id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Edita a mensagem ou muda o estágio de uma abordagem' })
  updateOutreach(@Param('id') id: string, @Body() dto: UpdateOutreachDto): Promise<Outreach> {
    return this.campaignService.updateOutreach(id, { message: dto.message, stage: dto.stage as OutreachStage });
  }

  @Post('campaigns/:id/send')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Aprova as abordagens pendentes e dispara o envio com cadência (Item 3)' })
  send(@Param('id') id: string): Promise<{ approved: number }> {
    return this.campaignService.approveAndSend(id);
  }

  // ---- Funil / métricas (Item 4) ----
  @Get('campaigns/:id/metrics')
  @ApiOperation({ summary: 'Métricas do funil da campanha (contagem por estágio)' })
  metrics(@Param('id') id: string): Promise<Record<string, number>> {
    return this.campaignService.metrics(id);
  }

  // ---- Opt-out (Item 3) ----
  @Post('opt-out')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Adiciona um contato à lista de descadastro (opt-out)' })
  async optOut(@Body() dto: OptOutDto): Promise<{ ok: boolean }> {
    await this.campaignService.addOptOut(dto.sessionId, dto.phone);
    return { ok: true };
  }
}
