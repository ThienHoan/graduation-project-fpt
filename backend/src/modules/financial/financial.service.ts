import { Injectable } from "@nestjs/common";
import { BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { FinancialQueryDto } from "./dto/financial-query.dto";

type DateRange = { gte: Date; lte: Date };

@Injectable()
export class FinancialService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Financial Summary API
  // ═══════════════════════════════════════════════════════════════════════════

  async getSummary(query: FinancialQueryDto) {
    const range = this.buildDateRange(query);

    // Revenue statuses: bookings that generate rental revenue
    const REVENUE_STATUSES: BookingStatus[] = [
      BookingStatus.completed,
      BookingStatus.renting,
      BookingStatus.returned,
      BookingStatus.inspection_pending,
      BookingStatus.refund_pending,
    ];

    // All statuses that imply customer has paid (deposit is being held)
    const DEPOSIT_HOLDING_STATUSES: BookingStatus[] = [
      BookingStatus.paid,
      BookingStatus.preparing,
      BookingStatus.ready_for_pickup,
      BookingStatus.delivering,
      BookingStatus.renting,
      BookingStatus.returned,
      BookingStatus.inspection_pending,
      BookingStatus.refund_pending,
      BookingStatus.overdue,
    ];

    const bookingDateFilter: Prisma.BookingWhereInput = range
      ? { createdAt: { gte: range.gte, lte: range.lte } }
      : {};

    const paymentMethodFilter: Prisma.BookingWhereInput =
      query.paymentMethod ? { paymentMethod: query.paymentMethod } : {};

    const refundDateFilter: Prisma.RefundWhereInput = range
      ? { updated_at: { gte: range.gte, lte: range.lte } }
      : {};

    const penaltyDateFilter: Prisma.PenaltyWhereInput = range
      ? { createdAt: { gte: range.gte, lte: range.lte } }
      : {};

    const txDateFilter: Prisma.FinancialTransactionWhereInput = range
      ? { createdAt: { gte: range.gte, lte: range.lte } }
      : {};

    const [
      revenueAgg,
      depositReceivedAgg,
      depositHeldAgg,
      completedNotRefunded,
      refundedAgg,
      penaltyAgg,
      forfeitedBookings,
      totalTransactions,
      totalBookings,
      paidBookings,
      unpaidBookings,
    ] = await Promise.all([
      this.prisma.booking.aggregate({
        where: {
          status: { in: REVENUE_STATUSES },
          ...bookingDateFilter,
          ...paymentMethodFilter,
        },
        _sum: { rentalTotal: true },
        _count: { _all: true },
      }),
      this.prisma.booking.aggregate({
        where: {
          status: {
            notIn: [
              BookingStatus.draft,
              BookingStatus.pending_confirmation,
              BookingStatus.cancelled,
              BookingStatus.rejected,
              BookingStatus.awaiting_payment,
            ],
          },
          ...bookingDateFilter,
          ...paymentMethodFilter,
        },
        _sum: { depositTotal: true },
      }),
      this.prisma.booking.aggregate({
        where: {
          status: { in: DEPOSIT_HOLDING_STATUSES },
          ...bookingDateFilter,
          ...paymentMethodFilter,
        },
        _sum: { depositTotal: true },
        _count: { _all: true },
      }),
      this.prisma.booking.findMany({
        where: {
          status: BookingStatus.completed,
          ...bookingDateFilter,
          ...paymentMethodFilter,
          refunds: {
            none: {
              status: { in: [PaymentStatus.refunded, PaymentStatus.partially_refunded] },
            },
          },
        },
        select: { depositTotal: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          status: { in: [PaymentStatus.refunded, PaymentStatus.partially_refunded] },
          ...refundDateFilter,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.penalty.aggregate({
        where: penaltyDateFilter,
        _sum: { amount: true },
      }),
      this.prisma.booking.findMany({
        where: {
          status: BookingStatus.completed,
          ...bookingDateFilter,
          refunds: {
            none: {
              status: { in: [PaymentStatus.refunded, PaymentStatus.partially_refunded] },
            },
          },
        },
        select: { depositTotal: true, penaltyTotal: true },
      }),
      this.prisma.financialTransaction.count({
        where: txDateFilter,
      }),
      this.prisma.booking.count({
        where: { ...bookingDateFilter, ...paymentMethodFilter },
      }),
      this.prisma.booking.count({
        where: {
          status: {
            notIn: [
              BookingStatus.draft,
              BookingStatus.pending_confirmation,
              BookingStatus.cancelled,
              BookingStatus.rejected,
              BookingStatus.awaiting_payment,
            ],
          },
          ...bookingDateFilter,
          ...paymentMethodFilter,
        },
      }),
      this.prisma.booking.count({
        where: {
          status: { in: [BookingStatus.awaiting_payment, BookingStatus.pending_confirmation] },
          ...bookingDateFilter,
          ...paymentMethodFilter,
        },
      }),
    ]);

    const rentalRevenue = Number(revenueAgg._sum.rentalTotal ?? 0);
    const depositReceived = Number(depositReceivedAgg._sum.depositTotal ?? 0);

    const completedNotRefundedDeposit = completedNotRefunded.reduce(
      (sum, b) => sum + Number(b.depositTotal),
      0,
    );

    const depositHeld =
      Number(depositHeldAgg._sum.depositTotal ?? 0) + completedNotRefundedDeposit;
    const depositHeldCount =
      (depositHeldAgg._count._all ?? 0) + completedNotRefunded.length;

    const refundedDeposit = Number(refundedAgg._sum.amount ?? 0);
    const damageDeduction = Number(penaltyAgg._sum.amount ?? 0);

    const forfeitedDeposit = forfeitedBookings
      .filter((b) => Number(b.penaltyTotal) >= Number(b.depositTotal) && Number(b.depositTotal) > 0)
      .reduce((sum, b) => sum + Number(b.depositTotal), 0);

    return ok({
      rentalRevenue,
      depositReceived,
      depositHeld,
      depositHeldCount,
      refundedDeposit,
      damageDeduction,
      forfeitedDeposit,
      totalTransactions,
      totalBookings,
      paidBookings,
      unpaidBookings,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Revenue by Day (for charts)
  // ═══════════════════════════════════════════════════════════════════════════

  async getRevenueByDay(query: FinancialQueryDto) {
    const range = this.buildDateRange(query) ?? this.defaultMonthRange();

    const REVENUE_STATUSES: BookingStatus[] = [
      BookingStatus.completed,
      BookingStatus.renting,
      BookingStatus.returned,
      BookingStatus.inspection_pending,
      BookingStatus.refund_pending,
    ];

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: REVENUE_STATUSES },
        createdAt: { gte: range.gte, lte: range.lte },
      },
      select: {
        createdAt: true,
        rentalTotal: true,
        depositTotal: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const dayMap = new Map<string, { rentalRevenue: number; depositReceived: number }>();
    for (const b of bookings) {
      const dateKey = b.createdAt.toISOString().slice(0, 10);
      const existing = dayMap.get(dateKey) ?? { rentalRevenue: 0, depositReceived: 0 };
      existing.rentalRevenue += Number(b.rentalTotal);
      existing.depositReceived += Number(b.depositTotal);
      dayMap.set(dateKey, existing);
    }

    const days = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    return ok(days);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Revenue by Payment Method
  // ═══════════════════════════════════════════════════════════════════════════

  async getRevenueByPaymentMethod(query: FinancialQueryDto) {
    const range = this.buildDateRange(query);

    const REVENUE_STATUSES: BookingStatus[] = [
      BookingStatus.completed,
      BookingStatus.renting,
      BookingStatus.returned,
      BookingStatus.inspection_pending,
      BookingStatus.refund_pending,
    ];

    const dateFilter: Prisma.BookingWhereInput = range
      ? { createdAt: { gte: range.gte, lte: range.lte } }
      : {};

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: {
          notIn: [
            BookingStatus.draft,
            BookingStatus.cancelled,
            BookingStatus.rejected,
          ],
        },
        ...dateFilter,
      },
      select: {
        paymentMethod: true,
        rentalTotal: true,
        depositTotal: true,
        status: true,
      },
    });

    const methodMap = new Map<
      string,
      { rentalRevenue: number; depositReceived: number; refundedAmount: number; transactionCount: number }
    >();

    for (const b of bookings) {
      const method = b.paymentMethod || "unknown";
      const existing = methodMap.get(method) ?? {
        rentalRevenue: 0,
        depositReceived: 0,
        refundedAmount: 0,
        transactionCount: 0,
      };
      if (REVENUE_STATUSES.includes(b.status)) {
        existing.rentalRevenue += Number(b.rentalTotal);
      }
      existing.depositReceived += Number(b.depositTotal);
      existing.transactionCount += 1;
      methodMap.set(method, existing);
    }

    const result = Array.from(methodMap.entries()).map(([paymentMethod, data]) => ({
      paymentMethod,
      ...data,
    }));

    return ok(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Deposit List
  // ═══════════════════════════════════════════════════════════════════════════

  async getDeposits(query: FinancialQueryDto & { bookingId?: string; customerId?: string; status?: string }) {
    const range = this.buildDateRange(query);
    const dateFilter: Prisma.BookingWhereInput = range
      ? { createdAt: { gte: range.gte, lte: range.lte } }
      : {};

    const where: Prisma.BookingWhereInput = {
      status: {
        notIn: [
          BookingStatus.draft,
          BookingStatus.cancelled,
          BookingStatus.rejected,
          BookingStatus.awaiting_payment,
          BookingStatus.pending_confirmation,
        ],
      },
      depositTotal: { gt: 0 },
      ...dateFilter,
    };

    if (query.bookingId) {
      where.id = query.bookingId;
    }
    if (query.customerId) {
      where.customerId = query.customerId;
    }

    const bookings = await this.prisma.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, phone: true } },
          },
        },
        refunds: {
          where: {
            status: { in: [PaymentStatus.refunded, PaymentStatus.partially_refunded, PaymentStatus.pending, PaymentStatus.refunding] },
          },
          orderBy: { createdAt: "desc" },
        },
        penalties: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    const deposits = bookings.map((b) => {
      const originalDeposit = Number(b.depositTotal);
      const penaltyTotal = Number(b.penaltyTotal);
      const successfulRefunds = b.refunds.filter(
        (r) => r.status === PaymentStatus.refunded || r.status === PaymentStatus.partially_refunded,
      );
      const refundedAmount = successfulRefunds.reduce((s, r) => s + Number(r.amount), 0);
      const pendingRefunds = b.refunds.filter(
        (r) => r.status === PaymentStatus.pending || r.status === PaymentStatus.refunding,
      );
      const pendingRefundAmount = pendingRefunds.reduce((s, r) => s + Number(r.amount), 0);

      let depositStatus: string;
      if (refundedAmount >= originalDeposit) {
        depositStatus = "FULLY_REFUNDED";
      } else if (refundedAmount > 0) {
        depositStatus = "PARTIALLY_REFUNDED";
      } else if (penaltyTotal >= originalDeposit && b.status === BookingStatus.completed) {
        depositStatus = "FORFEITED";
      } else if (penaltyTotal > 0 && b.status === BookingStatus.completed && refundedAmount > 0) {
        depositStatus = "DEDUCTED";
      } else if (pendingRefundAmount > 0) {
        depositStatus = "PENDING";
      } else {
        depositStatus = "PENDING";
      }

      // Apply status filter if provided
      if (query.status && depositStatus !== query.status) {
        return null;
      }

      return {
        bookingId: b.id,
        customerId: b.customerId,
        customerName: b.customer?.profile?.fullName ?? b.customer?.email ?? null,
        customerPhone: b.customer?.profile?.phone ?? null,
        originalDeposit,
        refundedAmount,
        damageDeduction: penaltyTotal,
        forfeitedAmount: depositStatus === "FORFEITED" ? originalDeposit : 0,
        remainingAmount: Math.max(0, originalDeposit - refundedAmount - (depositStatus === "FORFEITED" ? originalDeposit : 0)),
        status: depositStatus,
        bookingStatus: b.status,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        refunds: b.refunds.map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          status: r.status,
          reason: r.reason,
          refundMethod: r.refund_method,
          processedBy: r.processed_by,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
        penalties: b.penalties.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          reason: p.reason,
          createdBy: p.createdBy,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    });

    return ok(deposits.filter(Boolean));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Deposit Detail
  // ═══════════════════════════════════════════════════════════════════════════

  async getDepositDetail(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, phone: true } },
          },
        },
        refunds: {
          orderBy: { createdAt: "desc" },
          include: {
            user_accounts: {
              select: {
                email: true,
                profile: { select: { fullName: true } },
              },
            },
          },
        },
        penalties: {
          orderBy: { createdAt: "desc" },
          include: {
            createdByUser: {
              select: {
                email: true,
                profile: { select: { fullName: true } },
              },
            },
          },
        },
        items: {
          select: {
            id: true,
            garment_sizes: {
              select: {
                size_label: true,
                garments: {
                  select: {
                    name: true,
                    images: { orderBy: { sortOrder: "asc" }, take: 1, select: { imageUrl: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return ok(null);
    }

    const originalDeposit = Number(booking.depositTotal);
    const penaltyTotal = Number(booking.penaltyTotal);
    const successfulRefunds = booking.refunds.filter(
      (r) => r.status === PaymentStatus.refunded || r.status === PaymentStatus.partially_refunded,
    );
    const refundedAmount = successfulRefunds.reduce((s, r) => s + Number(r.amount), 0);

    let depositStatus: string;
    if (refundedAmount >= originalDeposit) {
      depositStatus = "FULLY_REFUNDED";
    } else if (refundedAmount > 0) {
      depositStatus = "PARTIALLY_REFUNDED";
    } else if (penaltyTotal >= originalDeposit && booking.status === BookingStatus.completed) {
      depositStatus = "FORFEITED";
    } else {
      depositStatus = "PENDING";
    }

    // Build deposit history (audit trail)
    const history: Array<{
      action: string;
      amount: number;
      reason: string | null;
      processedBy: string | null;
      processedAt: string;
    }> = [];

    // Add refund events
    for (const r of booking.refunds) {
      const actionMap: Record<string, string> = {
        refunded: "REFUND_APPROVED",
        partially_refunded: "REFUND_APPROVED",
        pending: "REFUND_REQUESTED",
        refunding: "REFUND_PROCESSING",
        cancelled: "REFUND_REJECTED",
        failed: "REFUND_FAILED",
      };
      history.push({
        action: actionMap[r.status] ?? r.status,
        amount: Number(r.amount),
        reason: r.reason,
        processedBy: r.user_accounts?.profile?.fullName ?? r.user_accounts?.email ?? null,
        processedAt: r.updated_at.toISOString(),
      });
    }

    // Add penalty events
    for (const p of booking.penalties) {
      history.push({
        action: "DAMAGE_DEDUCTION",
        amount: Number(p.amount),
        reason: p.reason,
        processedBy: p.createdByUser?.profile?.fullName ?? p.createdByUser?.email ?? null,
        processedAt: p.createdAt.toISOString(),
      });
    }

    // Sort by date desc
    history.sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime());

    return ok({
      bookingId: booking.id,
      customer: {
        id: booking.customerId,
        name: booking.customer?.profile?.fullName ?? booking.customer?.email ?? null,
        phone: booking.customer?.profile?.phone ?? null,
        email: booking.customer?.email ?? null,
      },
      originalDeposit,
      refundedAmount,
      damageDeduction: penaltyTotal,
      forfeitedAmount: depositStatus === "FORFEITED" ? originalDeposit : 0,
      remainingAmount: Math.max(0, originalDeposit - refundedAmount),
      status: depositStatus,
      bookingStatus: booking.status,
      items: booking.items.map((item) => ({
        id: item.id,
        garmentName: item.garment_sizes?.garments?.name ?? null,
        sizeLabel: item.garment_sizes?.size_label ?? null,
        imageUrl: item.garment_sizes?.garments?.images?.[0]?.imageUrl ?? null,
      })),
      history,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Financial Transactions List
  // ═══════════════════════════════════════════════════════════════════════════

  async getTransactions(query: FinancialQueryDto & { page?: number; limit?: number }) {
    const range = this.buildDateRange(query);
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const where: Prisma.FinancialTransactionWhereInput = {};

    if (range) {
      where.createdAt = { gte: range.gte, lte: range.lte };
    }

    if (query.transactionStatus) {
      if (query.transactionStatus === "REFUND") {
        where.transactionType = { startsWith: "refund" };
      } else if (query.transactionStatus === "RENTAL") {
        where.transactionType = "payment";
      } else if (query.transactionStatus === "DEPOSIT") {
        where.transactionType = "deposit";
      } else if (query.transactionStatus === "DAMAGE_DEDUCTION") {
        where.transactionType = "penalty";
      } else {
        where.transactionType = query.transactionStatus;
      }
    }

    if (query.method) {
      const method = query.method.toLowerCase();
      where.OR = [
        { refund: { refund_method: { equals: method, mode: "insensitive" } } },
        { payment: { paymentMethod: { equals: method, mode: "insensitive" } } },
        { 
          refundId: null, 
          paymentId: null,
          booking: { paymentMethod: { equals: method, mode: "insensitive" } } 
        }
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          booking: {
            select: {
              id: true,
              customerId: true,
              paymentMethod: true,
              customer: {
                select: {
                  email: true,
                  profile: { select: { fullName: true } },
                },
              },
            },
          },
          payment: {
            select: {
              id: true,
              paymentMethod: true,
              status: true,
            },
          },
          refund: {
            select: {
              id: true,
              status: true,
              refund_method: true,
              processed_by: true,
            },
          },
          penalty: {
            select: {
              id: true,
              reason: true,
              createdBy: true,
            },
          },
        },
      }),
      this.prisma.financialTransaction.count({ where }),
    ]);

    const serialized = items.map((tx) => ({
      id: tx.id,
      bookingId: tx.bookingId,
      customerName:
        tx.booking?.customer?.profile?.fullName ?? tx.booking?.customer?.email ?? null,
      type: this.mapTransactionType(tx.transactionType),
      rawType: tx.transactionType,
      amount: Number(tx.amount),
      method: tx.refund?.refund_method ?? tx.payment?.paymentMethod ?? tx.booking?.paymentMethod ?? null,
      status: tx.refund?.status ?? tx.payment?.status ?? "completed",
      note: tx.note,
      createdAt: tx.createdAt.toISOString(),
      processedBy: tx.refund?.processed_by ?? tx.penalty?.createdBy ?? null,
    }));

    return ok({ items: serialized, total, page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Daily Reconciliation
  // ═══════════════════════════════════════════════════════════════════════════

  async getReconciliation(query: FinancialQueryDto) {
    const range = this.buildDateRange(query) ?? this.todayRange();

    const REVENUE_STATUSES: BookingStatus[] = [
      BookingStatus.completed,
      BookingStatus.renting,
      BookingStatus.returned,
      BookingStatus.inspection_pending,
      BookingStatus.refund_pending,
    ];

    // Rental transactions in range
    const [bookingsInRange, refundsInRange, penaltiesInRange, transactionCount] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          createdAt: { gte: range.gte, lte: range.lte },
          status: { in: REVENUE_STATUSES },
        },
        select: { rentalTotal: true, depositTotal: true },
      }),
      this.prisma.refund.findMany({
        where: {
          status: { in: [PaymentStatus.refunded, PaymentStatus.partially_refunded] },
          updated_at: { gte: range.gte, lte: range.lte },
        },
        select: { amount: true },
      }),
      this.prisma.penalty.findMany({
        where: {
          createdAt: { gte: range.gte, lte: range.lte },
        },
        select: { amount: true },
      }),
      this.prisma.financialTransaction.count({
        where: {
          createdAt: { gte: range.gte, lte: range.lte },
        },
      }),
    ]);

    const rentalRevenue = bookingsInRange.reduce((s, b) => s + Number(b.rentalTotal), 0);
    const depositReceived = bookingsInRange.reduce((s, b) => s + Number(b.depositTotal), 0);
    const refundedDeposit = refundsInRange.reduce((s, r) => s + Number(r.amount), 0);
    const damageDeduction = penaltiesInRange.reduce((s, p) => s + Number(p.amount), 0);

    return ok({
      period: {
        start: range.gte.toISOString(),
        end: range.lte.toISOString(),
      },
      rentalRevenue,
      depositReceived,
      refundedDeposit,
      damageDeduction,
      transactionCount,
      netCashFlow: rentalRevenue + depositReceived - refundedDeposit,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private buildDateRange(query: FinancialQueryDto): DateRange | null {
    const now = new Date();

    switch (query.preset) {
      case "today":
        return this.todayRange();
      case "this_year": {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        startOfYear.setHours(0, 0, 0, 0);
        const endOfYear = new Date(now.getFullYear(), 11, 31);
        endOfYear.setHours(23, 59, 59, 999);
        return { gte: startOfYear, lte: endOfYear };
      }
      case "this_month":
        return this.defaultMonthRange();
      case "custom":
        if (query.startDate && query.endDate) {
          const start = new Date(query.startDate);
          start.setHours(0, 0, 0, 0);
          const end = new Date(query.endDate);
          end.setHours(23, 59, 59, 999);
          return { gte: start, lte: end };
        }
        return null;
      default:
        if (query.startDate && query.endDate) {
          const start = new Date(query.startDate);
          start.setHours(0, 0, 0, 0);
          const end = new Date(query.endDate);
          end.setHours(23, 59, 59, 999);
          return { gte: start, lte: end };
        }
        return null;
    }
  }

  private todayRange(): DateRange {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    return { gte: startOfDay, lte: endOfDay };
  }

  private defaultMonthRange(): DateRange {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);
    return { gte: startOfMonth, lte: endOfMonth };
  }

  private mapTransactionType(rawType: string): string {
    const map: Record<string, string> = {
      refund_cash_pending: "REFUND",
      refund_bank_transfer_pending: "REFUND",
      refund_cash: "REFUND",
      refund_bank_transfer_approved: "REFUND",
      refund_rejected: "REFUND",
      payment: "RENTAL",
      deposit: "DEPOSIT",
      penalty: "DAMAGE_DEDUCTION",
    };
    if (rawType.startsWith("refund")) return "REFUND";
    if (rawType.startsWith("penalty")) return "DAMAGE_DEDUCTION";
    return map[rawType] ?? rawType.toUpperCase();
  }
}
