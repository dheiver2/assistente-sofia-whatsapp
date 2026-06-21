import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Recommendation } from './entities/recommendation.entity';
import { ProductsService } from './products.service';
import { ProfileAgent } from './agents/profile.agent';
import { AnalysisAgent } from './agents/analysis.agent';
import { MatchingAgent } from './agents/matching.agent';
import { MessageCrafterAgent } from './agents/message-crafter.agent';
import { RecommendationOrchestrator } from './recommendation-orchestrator.service';
import { RecommendationsController } from './recommendations.controller';
import { Contact } from '../contacts/entities/contact.entity';
import { Session } from '../session/entities/session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Recommendation, Contact, Session], 'data')],
  providers: [ProductsService, ProfileAgent, AnalysisAgent, MatchingAgent, MessageCrafterAgent, RecommendationOrchestrator],
  controllers: [RecommendationsController],
  exports: [RecommendationOrchestrator, ProductsService],
})
export class RecommendationsModule {}
