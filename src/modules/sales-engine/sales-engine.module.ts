import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../session/entities/session.entity';
import { SalesEngineController } from './sales-engine.controller';
import { SalesEngineService } from './sales-engine.service';

/**
 * Motor de Vendas (MVP) — núcleo de IA do módulo de vendas ativas.
 * Lê a IA da empresa (Session.config.ai) e gera abordagens personalizadas por lead.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Session], 'data')],
  controllers: [SalesEngineController],
  providers: [SalesEngineService],
})
export class SalesEngineModule {}
