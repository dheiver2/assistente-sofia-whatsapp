import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../session/entities/session.entity';
import { MessageModule } from '../message/message.module';
import { Campaign, LeadSource, Outreach, OptOut } from './entities/sales.entities';
import { SalesEngineController } from './sales-engine.controller';
import { SalesEngineService } from './sales-engine.service';
import { DataConnectorService } from './data-connector.service';
import { CampaignService } from './campaign.service';
import { DispatcherService } from './dispatcher.service';

/**
 * Motor de Vendas — módulo completo:
 *  1) Conector de bases (Postgres read-only / inline) — DataConnectorService
 *  2) Campanhas + abordagens por IA — CampaignService / SalesEngineService
 *  3) Envio com cadência + opt-out — DispatcherService
 *  4) Funil + métricas + write-back CRM — CampaignService (hook) / DispatcherService
 */
@Module({
  imports: [TypeOrmModule.forFeature([Session, LeadSource, Campaign, Outreach, OptOut], 'data'), MessageModule],
  controllers: [SalesEngineController],
  providers: [SalesEngineService, DataConnectorService, CampaignService, DispatcherService],
})
export class SalesEngineModule {}
