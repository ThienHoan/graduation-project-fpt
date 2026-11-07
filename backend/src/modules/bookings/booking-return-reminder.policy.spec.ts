import { describe, expect, it } from "vitest";
import {
  evaluateReturnReminderPolicy,
  extractVnDateString,
  createVnDateTime,
} from "./booking-return-reminder.policy";

describe("BookingReturnReminderPolicy (Pure Business Logic)", () => {
  const BOOKING_ID = "00000000-0000-4000-8000-000000000001";
  const TEST_DATE = "2026-11-08";

  // 1. Deadline hợp lệ, T-3h chính xác cho system_midnight
  it("Scenario 1: calculates exact T-3h for system_midnight deadline", () => {
    // rentalEndDate: 2026-11-08
    // system_midnight deadline: 2026-11-09 00:00:00 (UTC+7) = 2026-11-08 17:00:00.000Z
    // T-3h: 2026-11-08 21:00:00 (UTC+7) = 2026-11-08 14:00:00.000Z
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "renting",
      rentalEndDate: TEST_DATE,
      deadlineType: "system_midnight",
      now: new Date("2026-11-08T14:30:00.000Z"), // 21:30 VN
    });

    expect(decision.status).toBe("ELIGIBLE");
    if (decision.status === "ELIGIBLE") {
      expect(decision.deadline.toISOString()).toBe("2026-11-08T17:00:00.000Z");
      expect(decision.scheduledReminderTime.toISOString()).toBe("2026-11-08T14:00:00.000Z");
      expect(decision.isDue).toBe(true);
      expect(decision.deadlineType).toBe("system_midnight");
      expect(decision.hoursUntilDeadline).toBe(2.5);
    }
  });

  // 1b. Deadline hợp lệ, T-3h chính xác cho store_closing
  it("Scenario 1b: calculates exact T-3h for store_closing deadline (20:00 showroom closing)", () => {
    // rentalEndDate: 2026-11-08
    // store_closing (20:00 VN) = 2026-11-08 13:00:00.000Z
    // T-3h: 17:00 VN = 2026-11-08 10:00:00.000Z
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "renting",
      rentalEndDate: TEST_DATE,
      deadlineType: "store_closing",
      storeClosingTime: "20:00",
      now: new Date("2026-11-08T10:05:00.000Z"), // 17:05 VN
    });

    expect(decision.status).toBe("ELIGIBLE");
    if (decision.status === "ELIGIBLE") {
      expect(decision.deadline.toISOString()).toBe("2026-11-08T13:00:00.000Z");
      expect(decision.scheduledReminderTime.toISOString()).toBe("2026-11-08T10:00:00.000Z");
      expect(decision.isDue).toBe(true);
    }
  });

  // 2. Deadline qua ranh giới ngày
  it("Scenario 2: correctly handles day boundary transition for midnight deadline", () => {
    // System midnight deadline for 2026-11-08 is 2026-11-09 00:00:00 VN.
    // Scheduled reminder (21:00 VN) is on 2026-11-08, while deadline is on 2026-11-09.
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "renting",
      rentalEndDate: TEST_DATE,
      deadlineType: "system_midnight",
      now: new Date("2026-11-08T13:59:00.000Z"), // 20:59 VN (1 minute before T-3h)
    });

    expect(decision.status).toBe("ELIGIBLE");
    if (decision.status === "ELIGIBLE") {
      expect(decision.isDue).toBe(false); // Chưa đến 21:00
      expect(decision.scheduledReminderTime.toISOString()).toBe("2026-11-08T14:00:00.000Z");
      expect(decision.deadline.toISOString()).toBe("2026-11-08T17:00:00.000Z");
    }
  });

  // 3. UTC và giờ Việt Nam nhất quán (Asia/Ho_Chi_Minh = UTC+7)
  it("Scenario 3: maintains consistent UTC conversion across Asia/Ho_Chi_Minh timezone", () => {
    const vnDateStr = extractVnDateString(new Date("2026-11-08T17:30:00.000Z")); // 00:30 on 2026-11-09 in VN
    expect(vnDateStr).toBe("2026-11-09");

    const createdVnTime = createVnDateTime("2026-11-08", 20, 0); // 20:00 VN
    expect(createdVnTime?.toISOString()).toBe("2026-11-08T13:00:00.000Z");
  });

  // 4. Deadline thiếu thông tin (không truyền deadlineType) -> POLICY_UNCONFIRMED
  it("Scenario 4: returns POLICY_UNCONFIRMED when date-only exists without confirmed deadline policy", () => {
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "renting",
      rentalEndDate: TEST_DATE,
      // No deadlineType specified
    });

    expect(decision.status).toBe("POLICY_UNCONFIRMED");
    if (decision.status === "POLICY_UNCONFIRMED") {
      expect(decision.reason).toBe("missing_deadline_time");
      expect(decision.dateOnly).toBe("2026-11-08");
      expect(decision.suggestedMidnightDeadline.toISOString()).toBe("2026-11-08T17:00:00.000Z");
      expect(decision.suggestedClosingDeadline?.toISOString()).toBe("2026-11-08T13:00:00.000Z");
    }
  });

  // 5. Deadline không hợp lệ
  it("Scenario 5: returns INELIGIBLE with invalid_date when rentalEndDate cannot be parsed", () => {
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "renting",
      rentalEndDate: "invalid-date-string",
      deadlineType: "system_midnight",
    });

    expect(decision.status).toBe("INELIGIBLE");
    if (decision.status === "INELIGIBLE") {
      expect(decision.reason).toBe("invalid_date");
    }
  });

  // 6. Booking đã hoàn tất (status: completed / returned) -> INELIGIBLE
  it("Scenario 6: rejects completed or returned booking from return reminder", () => {
    const returnedDecision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "returned",
      rentalEndDate: TEST_DATE,
      deadlineType: "system_midnight",
    });
    expect(returnedDecision.status).toBe("INELIGIBLE");
    if (returnedDecision.status === "INELIGIBLE") {
      expect(returnedDecision.reason).toBe("invalid_status");
    }

    const completedDecision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "completed",
      rentalEndDate: TEST_DATE,
      deadlineType: "system_midnight",
    });
    expect(completedDecision.status).toBe("INELIGIBLE");
    if (completedDecision.status === "INELIGIBLE") {
      expect(completedDecision.reason).toBe("invalid_status");
    }
  });

  // 7. Booking bị hủy (status: cancelled) -> INELIGIBLE
  it("Scenario 7: rejects cancelled booking from return reminder", () => {
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "cancelled",
      rentalEndDate: TEST_DATE,
      deadlineType: "system_midnight",
    });

    expect(decision.status).toBe("INELIGIBLE");
    if (decision.status === "INELIGIBLE") {
      expect(decision.reason).toBe("invalid_status");
    }
  });

  // 8. Ngày trả đã được gia hạn (newEndDate = 2026-11-12)
  it("Scenario 8: respects extended rentalEndDate and recalculates new deadline accordingly", () => {
    const extendedDate = "2026-11-12";
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "renting",
      rentalEndDate: extendedDate,
      deadlineType: "system_midnight",
      now: new Date("2026-11-08T15:00:00.000Z"), // Still on Nov 8
    });

    expect(decision.status).toBe("ELIGIBLE");
    if (decision.status === "ELIGIBLE") {
      // Deadline is now midnight Nov 13 VN (2026-11-12 17:00:00.000Z)
      expect(decision.deadline.toISOString()).toBe("2026-11-12T17:00:00.000Z");
      expect(decision.isDue).toBe(false); // Not due on Nov 8
    }
  });

  // 9. Extension pending chưa được áp dụng chính thức -> INELIGIBLE (has_pending_extension)
  it("Scenario 9: temporarily defers reminder when an extension is currently pending payment hold", () => {
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "renting",
      rentalEndDate: TEST_DATE,
      deadlineType: "system_midnight",
      hasPendingExtension: true, // 30m payment hold
    });

    expect(decision.status).toBe("INELIGIBLE");
    if (decision.status === "INELIGIBLE") {
      expect(decision.reason).toBe("has_pending_extension");
    }
  });

  // Past deadline check
  it("Scenario: marks past_deadline when current time exceeds resolved deadline", () => {
    const decision = evaluateReturnReminderPolicy({
      bookingId: BOOKING_ID,
      status: "renting",
      rentalEndDate: TEST_DATE,
      deadlineType: "system_midnight",
      now: new Date("2026-11-08T17:01:00.000Z"), // 00:01 VN next day
    });

    expect(decision.status).toBe("INELIGIBLE");
    if (decision.status === "INELIGIBLE") {
      expect(decision.reason).toBe("past_deadline");
    }
  });
});

