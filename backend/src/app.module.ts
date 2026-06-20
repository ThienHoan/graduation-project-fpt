import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AssetsModule } from "./modules/assets/assets.module";
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
import { RefundsModule } from "./modules/refunds/refunds.module";
import { UsersModule } from "./modules/users/users.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AdminModule,
    AssetsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    GarmentsModule,
    LocationsModule,
    BookingsModule,
    NotificationsModule,
    InspectionsModule,
    PaymentsModule,
    RefundsModule,
    AiModule,
  ],
})
export class AppModule {}
