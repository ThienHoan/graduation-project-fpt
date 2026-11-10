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
import { BookingPickupReminderBuilder } from "./booking-pickup-reminder.builder";
import { BookingReturnReminderBuilder } from "./booking-return-reminder.builder";
import { PickupReminderIdempotencyService } from "./pickup-reminder-idempotency.service";
import { ReturnReminderIdempotencyService } from "./return-reminder-idempotency.service";
import { BookingThankYouVoucherService } from "./booking-thank-you-voucher.service";
import { EmailTemplateBuilder } from "./email/email-templates.builder";
import { EmailPreviewService } from "./email/email-preview.service";
import { BookingEmailAdapter } from "./email/booking-email.adapter";
import { CustomerCareService } from "./customer-care/customer-care.service";
import { CustomerCareController } from "./customer-care/customer-care.controller";
import { NotificationRetryService } from "./customer-care/notification-retry.service";
import { BookingsController } from "./bookings.controller";
import { BookingsScheduler } from "./bookings.scheduler";
import { BookingsService } from "./bookings.service";
import { BookingsExportService } from "./bookings-export.service";

@Module({
  imports: [AuthModule, NotificationsModule, LocationsModule, PricingModule, RealtimeModule, VouchersModule, InspectionsModule, GarmentsModule],
  controllers: [BookingsController, CustomerCareController],
  providers: [
    BookingsService,
    BookingsExportService,
    BookingAutomationService,
    BookingExtensionsService,
    BookingsScheduler,
    BookingPickupReminderBuilder,
    BookingReturnReminderBuilder,
    PickupReminderIdempotencyService,
    ReturnReminderIdempotencyService,
    BookingThankYouVoucherService,
    EmailTemplateBuilder,
    EmailPreviewService,
    BookingEmailAdapter,
    CustomerCareService,
    NotificationRetryService,
  ],
  exports: [
    BookingsService,
    BookingsExportService,
    BookingExtensionsService,
    BookingPickupReminderBuilder,
    BookingReturnReminderBuilder,
    PickupReminderIdempotencyService,
    ReturnReminderIdempotencyService,
    BookingThankYouVoucherService,
    EmailTemplateBuilder,
    EmailPreviewService,
    BookingEmailAdapter,
    CustomerCareService,
    NotificationRetryService,
  ],
})
export class BookingsModule {}
