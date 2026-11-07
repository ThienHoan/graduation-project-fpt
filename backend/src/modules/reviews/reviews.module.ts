import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { ReviewPermissionService } from './services/review-permission.service';
import { ReviewStatisticsService } from './services/review-statistics.service';
import { ReviewModerationService } from './services/review-moderation.service';
import { ReviewQueryService } from './services/review-query.service';

@Module({
  imports: [PrismaModule, NotificationsModule, AuthModule],
  controllers: [ReviewsController],
  providers: [
    ReviewsService,
    ReviewPermissionService,
    ReviewStatisticsService,
    ReviewModerationService,
    ReviewQueryService,
  ],
  exports: [
    ReviewsService,
    ReviewPermissionService,
    ReviewStatisticsService,
    ReviewModerationService,
    ReviewQueryService,
  ],
})
export class ReviewsModule { }
