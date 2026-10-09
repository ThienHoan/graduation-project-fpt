import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AssetsModule } from "./modules/assets/assets.module";
import { AccessoriesModule } from "./modules/accessories/accessories.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { GarmentsModule } from "./modules/garments/garments.module";
import { HealthModule } from "./modules/health/health.module";
import { InspectionsModule } from "./modules/inspections/inspections.module";
import { AiModule } from "./modules/ai/ai.module";
import { LocationsModule } from "./modules/locations/locations.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PricingModule } from "./modules/pricing/pricing.module";
import { FinancialModule } from "./modules/financial/financial.module";
import { RefundsModule } from "./modules/refunds/refunds.module";
import { UsersModule } from "./modules/users/users.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ChatModule } from "./modules/chat/chat.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { ReviewsModule } from "./modules/reviews/reviews.module";
import { VouchersModule } from "./modules/vouchers/vouchers.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AdminModule,
    AssetsModule,
    AccessoriesModule,
    HealthModule,
    AuthModule,
    UsersModule,
    GarmentsModule,
    LocationsModule,
    BookingsModule,
    NotificationsModule,
    InspectionsModule,
    PaymentsModule,
    PricingModule,
    FinancialModule,
    RefundsModule,
    AiModule,
    ChatModule,
    RealtimeModule,
    ReviewsModule,
    VouchersModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
