import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GarmentsModule } from "../garments/garments.module";
import { LocationsModule } from "../locations/locations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PricingModule } from "../pricing/pricing.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { InspectionsModule } from "../inspections/inspections.module";
import { VouchersModule } from "../vouchers/vouchers.module";
import { BookingAutomationService } from "./booking-automation.service";
import { BookingExtensionsService } from "./booking-extensions.service";
import { BookingsController } from "./bookings.controller";
import { BookingsScheduler } from "./bookings.scheduler";
import { BookingsService } from "./bookings.service";

@Module({
  imports: [AuthModule, NotificationsModule, LocationsModule, PricingModule, RealtimeModule, VouchersModule, InspectionsModule, GarmentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingAutomationService, BookingExtensionsService, BookingsScheduler],
  exports: [BookingExtensionsService],
})
export class BookingsModule {}
