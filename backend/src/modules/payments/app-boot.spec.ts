import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { BookingsService } from "../bookings/bookings.service";
import { BookingChangeRequestsService } from "../bookings/booking-change-requests.service";
import { PaymentsService } from "./payments.service";

describe("AppModule DI boot (forwardRef Bookings <-> Payments)", () => {
  it("compiles the full module graph and resolves the cross-module providers", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    const bookings = moduleRef.get(BookingsService, { strict: false });
    const changeRequests = moduleRef.get(BookingChangeRequestsService, { strict: false });
    const payments = moduleRef.get(PaymentsService, { strict: false });

    expect(bookings).toBeInstanceOf(BookingsService);
    expect(changeRequests).toBeInstanceOf(BookingChangeRequestsService);
    expect(payments).toBeInstanceOf(PaymentsService);

    // The cycle must resolve: the booking-side service receives the payments service.
    expect((changeRequests as unknown as { payments?: PaymentsService }).payments).toBe(payments);

    await moduleRef.close();
  }, 30_000);
});