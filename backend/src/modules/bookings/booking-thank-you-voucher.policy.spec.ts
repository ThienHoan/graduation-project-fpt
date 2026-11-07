import { describe, expect, it } from "vitest";
import {
  evaluateThankYouVoucherPolicy,
  buildThankYouVoucherCode,
  calculateVoucherBenefit,
  type ThankYouVoucherProgramConfig,
} from "./booking-thank-you-voucher.policy";

describe("BookingThankYouVoucherPolicy (Pure Logic)", () => {
  const BOOKING_ID = "00000000-0000-4000-8000-0000000000a1";
  const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000c1";

  const standardProgram: ThankYouVoucherProgramConfig = {
    enabled: true,
    benefit: {
      discountType: "percentage",
      discountValue: 15,
      maxDiscountAmount: 100_000,
      minOrderValue: 200_000,
      validDays: 30,
      excludePenalizedBookings: true,
    },
  };

  // 1. Booking completed hợp lệ
  it("Scenario 1: approves completed booking with valid percentage benefit", () => {
    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
        penaltyTotal: 0,
      },
      standardProgram,
    );

    expect(decision.status).toBe("ELIGIBLE");
    if (decision.status === "ELIGIBLE") {
      expect(decision.benefit.discountType).toBe("percentage");
      expect(decision.benefit.discountValue).toBe(15);
      expect(decision.benefit.maxDiscountAmount).toBe(100_000);
      expect(decision.benefit.minOrderValue).toBe(200_000);
      expect(decision.benefit.validDays).toBe(30);
      expect(decision.benefit.code).toBe(`TRIAN-00000000`);
    }
  });

  // 2. Booking chưa completed (vd: renting, returned)
  it("Scenario 2: rejects booking that is not completed", () => {
    const rentingDecision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "renting",
      },
      standardProgram,
    );
    expect(rentingDecision.status).toBe("NOT_ELIGIBLE");
    if (rentingDecision.status === "NOT_ELIGIBLE") {
      expect(rentingDecision.reason).toBe("invalid_booking_status");
    }

    const returnedDecision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "returned",
      },
      standardProgram,
    );
    expect(returnedDecision.status).toBe("NOT_ELIGIBLE");
    if (returnedDecision.status === "NOT_ELIGIBLE") {
      expect(returnedDecision.reason).toBe("invalid_booking_status");
    }
  });

  // 3. Booking cancelled
  it("Scenario 3: rejects cancelled booking", () => {
    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "cancelled",
      },
      standardProgram,
    );

    expect(decision.status).toBe("NOT_ELIGIBLE");
    if (decision.status === "NOT_ELIGIBLE") {
      expect(decision.reason).toBe("booking_cancelled");
    }
  });

  // 4. Missing customer
  it("Scenario 4: rejects booking with missing customerId", () => {
    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: "",
        status: "completed",
      },
      standardProgram,
    );

    expect(decision.status).toBe("NOT_ELIGIBLE");
    if (decision.status === "NOT_ELIGIBLE") {
      expect(decision.reason).toBe("missing_customer");
    }
  });

  // 5. Voucher program disabled
  it("Scenario 5: rejects when voucher program is disabled", () => {
    const disabledProgram: ThankYouVoucherProgramConfig = {
      enabled: false,
      benefit: standardProgram.benefit,
    };

    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
      },
      disabledProgram,
    );

    expect(decision.status).toBe("NOT_ELIGIBLE");
    if (decision.status === "NOT_ELIGIBLE") {
      expect(decision.reason).toBe("program_disabled");
    }
  });

  // 6. Missing settings -> POLICY_UNCONFIRMED
  it("Scenario 6: returns POLICY_UNCONFIRMED when program settings are completely missing", () => {
    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
      },
      null, // Missing settings
    );

    expect(decision.status).toBe("POLICY_UNCONFIRMED");
    if (decision.status === "POLICY_UNCONFIRMED") {
      expect(decision.reason).toBe("missing_program_config");
    }
  });

  // 7. Invalid percentage (>100 or <=0)
  it("Scenario 7: rejects benefit with invalid percentage values", () => {
    const over100Program: ThankYouVoucherProgramConfig = {
      enabled: true,
      benefit: {
        discountType: "percentage",
        discountValue: 120, // Invalid
        validDays: 30,
      },
    };

    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
      },
      over100Program,
    );

    expect(decision.status).toBe("NOT_ELIGIBLE");
    if (decision.status === "NOT_ELIGIBLE") {
      expect(decision.reason).toBe("invalid_discount_value");
    }
  });

  // 8. Invalid expiry (validDays <= 0)
  it("Scenario 8: rejects benefit with negative or zero validity duration", () => {
    const zeroDaysProgram: ThankYouVoucherProgramConfig = {
      enabled: true,
      benefit: {
        discountType: "percentage",
        discountValue: 10,
        validDays: 0, // Invalid
      },
    };

    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
      },
      zeroDaysProgram,
    );

    expect(decision.status).toBe("NOT_ELIGIBLE");
    if (decision.status === "NOT_ELIGIBLE") {
      expect(decision.reason).toBe("invalid_validity_duration");
    }
  });

  // 9. Fixed amount discount
  it("Scenario 9: calculates fixed amount benefit correctly", () => {
    const fixedProgram: ThankYouVoucherProgramConfig = {
      enabled: true,
      benefit: {
        discountType: "fixed",
        discountValue: 50_000,
        validDays: 14,
        minOrderValue: 150_000,
      },
    };

    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
      },
      fixedProgram,
    );

    expect(decision.status).toBe("ELIGIBLE");
    if (decision.status === "ELIGIBLE") {
      expect(decision.benefit.discountType).toBe("fixed");
      expect(decision.benefit.discountValue).toBe(50_000);
      expect(decision.benefit.description).toContain("50.000đ");
    }
  });

  // 10. Percentage discount
  it("Scenario 10: calculates percentage discount benefit correctly", () => {
    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
      },
      standardProgram,
    );

    expect(decision.status).toBe("ELIGIBLE");
    if (decision.status === "ELIGIBLE") {
      expect(decision.benefit.discountType).toBe("percentage");
      expect(decision.benefit.discountValue).toBe(15);
      expect(decision.benefit.description).toContain("15%");
    }
  });

  // 11. Maximum discount cap
  it("Scenario 11: preserves max discount cap", () => {
    const res = calculateVoucherBenefit(
      BOOKING_ID,
      null,
      {
        discountType: "percentage",
        discountValue: 20,
        maxDiscountAmount: 250_000,
        validDays: 30,
      },
    );

    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.benefit.maxDiscountAmount).toBe(250_000);
    }
  });

  // 12. Minimum order amount
  it("Scenario 12: sets minimum order value constraint", () => {
    const res = calculateVoucherBenefit(
      BOOKING_ID,
      null,
      {
        discountType: "fixed",
        discountValue: 30_000,
        minOrderValue: 100_000,
        validDays: 7,
      },
    );

    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.benefit.minOrderValue).toBe(100_000);
    }
  });

  // 13. Voucher already issued
  it("Scenario 13: returns ALREADY_ISSUED when alreadyIssued flag is true", () => {
    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
        alreadyIssued: true,
      },
      standardProgram,
    );

    expect(decision.status).toBe("ALREADY_ISSUED");
    if (decision.status === "ALREADY_ISSUED") {
      expect(decision.reason).toBe("already_issued");
    }
  });

  // 14. Penalized booking exclusion
  it("Scenario 14: rejects booking with damage penalty when excludePenalizedBookings is active", () => {
    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        status: "completed",
        penaltyTotal: 50_000, // Has damage penalty
      },
      standardProgram,
    );

    expect(decision.status).toBe("NOT_ELIGIBLE");
    if (decision.status === "NOT_ELIGIBLE") {
      expect(decision.reason).toBe("booking_penalized");
    }
  });

  // 15. Deterministic voucher code generation
  it("Scenario 15: generates consistent deterministic code prefixed with TRIAN-", () => {
    const code1 = buildThankYouVoucherCode(BOOKING_ID);
    expect(code1).toBe("TRIAN-00000000");

    const code2 = buildThankYouVoucherCode(BOOKING_ID, "BK-999");
    expect(code2).toBe("TRIAN-BK-999");
  });
});

