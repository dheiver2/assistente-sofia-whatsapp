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
import { RecommendationDeliveryService } from './recommendation-delivery.service';
import { AutoRecommendService } from './auto-recommend.service';
import { RecommendationsController } from './recommendations.controller';
import { Contact } from '../contacts/entities/contact.entity';
import { Session } from '../session/entities/session.entity';
import { MessageModule } from '../message/message.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Recommendation, Contact, Session], 'data'), MessageModule],
  providers: [ProductsService, ProfileAgent, AnalysisAgent, MatchingAgent, MessageCrafterAgent, RecommendationOrchestrator, RecommendationDeliveryService, AutoRecommendService],
  controllers: [RecommendationsController],
  exports: [RecommendationOrchestrator, ProductsService],
})
export class RecommendationsModule {}
