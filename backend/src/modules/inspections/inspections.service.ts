import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AssetStatus, BookingStatus, InspectionStatus, MaintenanceStatus, PaymentStatus, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { CompleteInspectionDto } from "./dto/complete-inspection.dto";
import type { CreateFindingDto } from "./dto/create-finding.dto";
import type { CreateInspectionDto } from "./dto/create-inspection.dto";
import type { CreatePhotoDto } from "./dto/create-photo.dto";
import type { CompleteLaundryDto } from "./dto/laundry.dto";
import type { CompleteMaintenanceDto } from "./dto/maintenance.dto";

const ACTIVE_REFUND_STATUSES: PaymentStatus[] = [
  PaymentStatus.pending,
  PaymentStatus.refunding,
  PaymentStatus.refunded,
  PaymentStatus.partially_refunded,
];

const ACTIVE_INSPECTION_STATUSES: InspectionStatus[] = [
  InspectionStatus.pending,
  InspectionStatus.in_progress,
  InspectionStatus.disputed,
];

const MUTABLE_INSPECTION_STATUSES: InspectionStatus[] = [
  InspectionStatus.pending,
  InspectionStatus.in_progress,
];

const FINAL_ASSET_STATUSES: AssetStatus[] = [
  AssetStatus.laundry,
  AssetStatus.maintenance,
  AssetStatus.damaged,
];

const ACTIVE_MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  MaintenanceStatus.open,
  MaintenanceStatus.in_progress,
];

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async createOrGet(dto: CreateInspectionDto, staffId: string) {
    const session = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: dto.bookingId },
        include: { items: true },
      });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (booking.status !== BookingStatus.returned && booking.status !== BookingStatus.inspection_pending) {
        throw new BadRequestException("Booking is not ready for inspection.");
      }

      const asset = await tx.garmentAsset.findUnique({
        where: { id: dto.garmentAssetId },
        include: { garment_sizes: { include: { garments: true } } },
      });
      if (!asset) throw new NotFoundException("Garment asset not found.");
      if (asset.status !== AssetStatus.inspection_pending) {
        throw new BadRequestException(`Asset '${asset.assetCode}' is not ready for inspection (current: ${asset.status}).`);
      }

      const assignedToBooking = booking.items.some((item) => item.garmentAssetId === dto.garmentAssetId);
      if (!assignedToBooking) throw new BadRequestException("Asset is not assigned to this booking.");

      if (booking.status === BookingStatus.returned) {
        const claimed = await tx.booking.updateMany({
          where: { id: dto.bookingId, status: BookingStatus.returned },
          data: { status: BookingStatus.inspection_pending },
        });
        if (claimed.count !== 1) throw new ConflictException("Booking status changed while starting inspection.");
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: dto.bookingId,
            fromStatus: BookingStatus.returned,
            toStatus: BookingStatus.inspection_pending,
            changedBy: staffId,
            note: "Bắt đầu kiểm tra",
          },
        });
      } else {
        await tx.booking.update({ where: { id: dto.bookingId }, data: {} });
      }

      const existing = await tx.inspectionSession.findFirst({
        where: {
          bookingId: dto.bookingId,
          garmentAssetId: dto.garmentAssetId,
          status: { in: ACTIVE_INSPECTION_STATUSES },
        },
        include: this.sessionInclude(),
        orderBy: { createdAt: "asc" },
      });
      if (existing) return existing;

      return tx.inspectionSession.create({
        data: {
          bookingId: dto.bookingId,
          garmentAssetId: dto.garmentAssetId,
          status: InspectionStatus.in_progress,
          inspectedBy: staffId,
          note: dto.note ?? null,
        },
        include: this.sessionInclude(),
      });
    });

    this.realtime.inspectionChanged({
      id: session.id,
      bookingId: session.bookingId,
      assetId: session.garmentAssetId,
      status: session.status,
    });
    this.realtime.bookingChanged({
      id: session.bookingId,
      bookingId: session.bookingId,
      status: BookingStatus.inspection_pending,
    });

    return ok(this.serialize(session));
  }

  async findByBooking(bookingId: string) {
    const sessions = await this.prisma.inspectionSession.findMany({
      where: { bookingId }, orderBy: { createdAt: "desc" },
      include: this.sessionInclude(),
    });
    return ok(sessions.map((s) => this.serialize(s)));
  }

  async findOne(id: string) {
    const session = await this.prisma.inspectionSession.findUnique({
      where: { id },
      include: this.sessionInclude(),
    });
    if (!session) throw new NotFoundException("Inspection session not found.");
    return ok(this.serialize(session));
  }

  async addFinding(sessionId: string, dto: CreateFindingDto) {
    const finding = await this.prisma.runSerializable(async (tx) => {
      const session = await tx.inspectionSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException("Inspection session not found.");
      if (!MUTABLE_INSPECTION_STATUSES.includes(session.status)) {
        throw new BadRequestException("Cannot add finding to a completed inspection.");
      }
      return tx.inspectionFinding.create({
        data: {
          inspectionSessionId: sessionId,
          findingType: dto.findingType,
          severity: dto.severity ?? "low",
          description: dto.description ?? null,
          penaltyAmount: dto.penaltyAmount ?? 0,
        },
      });
    });

    return ok({
      id: finding.id,
      findingType: finding.findingType,
      severity: finding.severity,
      description: finding.description,
      penaltyAmount: Number(finding.penaltyAmount),
      createdAt: finding.createdAt.toISOString(),
    });
  }

  async addPhoto(sessionId: string, dto: CreatePhotoDto) {
    const photo = await this.prisma.runSerializable(async (tx) => {
      const session = await tx.inspectionSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException("Inspection session not found.");
      if (!MUTABLE_INSPECTION_STATUSES.includes(session.status)) {
        throw new BadRequestException("Cannot add photo to a completed inspection.");
      }
      return tx.inspectionPhoto.create({
        data: { inspectionSessionId: sessionId, imageUrl: dto.imageUrl, note: dto.note ?? null },
      });
    });

    return ok({ id: photo.id, imageUrl: photo.imageUrl, note: photo.note, createdAt: photo.createdAt.toISOString() });
  }

  async complete(id: string, dto: CompleteInspectionDto, staffId: string) {
    const updated = await this.prisma.runSerializable(async (tx) => {
      const finalAssetStatus = dto.finalAssetStatus as AssetStatus;
      if (!FINAL_ASSET_STATUSES.includes(finalAssetStatus)) {
        throw new BadRequestException("Inspection must send the asset to laundry, maintenance, or damaged.");
      }

      const session = await tx.inspectionSession.findUnique({
        where: { id },
        include: { booking: { include: { items: true } } },
      });
      if (!session) throw new NotFoundException("Inspection session not found.");
      if (!MUTABLE_INSPECTION_STATUSES.includes(session.status)) {
        throw new BadRequestException("Inspection has already been completed.");
      }

      const claimedSession = await tx.inspectionSession.updateMany({
        where: { id, status: { in: MUTABLE_INSPECTION_STATUSES } },
        data: {
          status: InspectionStatus.completed,
          completedAt: new Date(),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });
      if (claimedSession.count !== 1) throw new ConflictException("Inspection has already been completed.");

      const currentAsset = await tx.garmentAsset.findUnique({ where: { id: session.garmentAssetId } });
      if (!currentAsset) throw new NotFoundException("Garment asset not found.");
      if (currentAsset.status !== AssetStatus.inspection_pending) {
        throw new BadRequestException(`Asset is no longer awaiting inspection (current: ${currentAsset.status}).`);
      }

      const claimedAsset = await tx.garmentAsset.updateMany({
        where: { id: session.garmentAssetId, status: AssetStatus.inspection_pending },
        data: { status: finalAssetStatus },
      });
      if (claimedAsset.count !== 1) throw new ConflictException("Asset status changed while completing inspection.");

      if (finalAssetStatus === AssetStatus.laundry) {
        await tx.laundryTicket.create({
          data: { garmentAssetId: session.garmentAssetId, bookingId: session.bookingId, status: MaintenanceStatus.open, note: dto.note ?? `Tạo từ inspection ${id}` },
        });
      }
      if (finalAssetStatus === AssetStatus.maintenance) {
        await tx.maintenanceJob.create({
          data: { garmentAssetId: session.garmentAssetId, status: MaintenanceStatus.open, note: dto.note ?? `Tạo từ inspection ${id}` },
        });
      }

      const penaltyAggregate = await tx.inspectionFinding.aggregate({
        where: { inspectionSessionId: id },
        _sum: { penaltyAmount: true },
      });
      const totalPenalty = Number(penaltyAggregate._sum.penaltyAmount ?? 0);

      const bookingAfterPenalty = await tx.booking.update({
        where: { id: session.bookingId },
        data: { penaltyTotal: { increment: totalPenalty } },
        select: { id: true, status: true, depositTotal: true, penaltyTotal: true },
      });

      if (totalPenalty > 0) {
        const createdPenalty = await tx.penalty.create({
          data: {
            bookingId: session.bookingId,
            reason: dto.note ?? `Inspection findings for session ${id}`,
            amount: totalPenalty,
            createdBy: staffId,
          },
        });
        await tx.financialTransaction.create({
          data: {
            bookingId: session.bookingId,
            penaltyId: createdPenalty.id,
            transactionType: "penalty",
            amount: totalPenalty,
            note: dto.note ?? `Khấu trừ hư hỏng sau kiểm tra.`,
          },
        });
      }

      if (await this.isBookingFullyInspected(tx, session.bookingId)) {
        await this.finalizeBookingInspection(tx, {
          bookingId: session.bookingId,
          bookingStatus: bookingAfterPenalty.status,
          depositTotal: Number(bookingAfterPenalty.depositTotal),
          penaltyTotal: Number(bookingAfterPenalty.penaltyTotal),
          staffId,
        });
      }

      return tx.inspectionSession.findUniqueOrThrow({
        where: { id },
        include: this.sessionInclude(),
      });
    });

    this.realtime.inspectionChanged({
      id: updated.id,
      bookingId: updated.bookingId,
      assetId: updated.garmentAssetId,
      status: updated.status,
    });
    this.realtime.assetChanged({
      id: updated.garmentAssetId,
      assetId: updated.garmentAssetId,
      bookingId: updated.bookingId,
      status: updated.garmentAsset.status,
    });
    this.realtime.bookingChanged({
      id: updated.bookingId,
      bookingId: updated.bookingId,
      status: updated.booking.status,
    });
    this.realtime.bookingChangedForCustomer(updated.booking.customerId, {
      id: updated.bookingId,
      bookingId: updated.bookingId,
      status: updated.booking.status,
    });
    if (dto.finalAssetStatus === AssetStatus.laundry) {
      this.realtime.laundryChanged({ assetId: updated.garmentAssetId, bookingId: updated.bookingId });
    }
    if (dto.finalAssetStatus === AssetStatus.maintenance) {
      this.realtime.maintenanceChanged({ assetId: updated.garmentAssetId, bookingId: updated.bookingId });
    }

    return ok(this.serialize(updated));
  }

  async markAssetReady(assetId: string, staffId: string) {
    void staffId;
    const asset = await this.prisma.garmentAsset.findUnique({
      where: { id: assetId },
      include: { laundryTickets: { where: { status: "open" }, take: 1 }, maintenanceJobs: { where: { status: "open" }, take: 1 } },
    });
    if (!asset) throw new NotFoundException("Garment asset not found.");
    if (asset.status !== AssetStatus.laundry && asset.status !== AssetStatus.maintenance)
      throw new BadRequestException(`Asset is not in laundry/maintenance status (current: ${asset.status}).`);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (asset.status === AssetStatus.laundry && asset.laundryTickets[0]) {
        await tx.laundryTicket.update({ where: { id: asset.laundryTickets[0].id }, data: { status: "completed", completedAt: new Date() } });
      }
      if (asset.status === AssetStatus.maintenance && asset.maintenanceJobs[0]) {
        await tx.maintenanceJob.update({ where: { id: asset.maintenanceJobs[0].id }, data: { status: "completed", completedAt: new Date() } });
      }
      const claimed = await tx.garmentAsset.updateMany({
        where: { id: assetId, status: asset.status },
        data: { status: AssetStatus.cleaned, conditionNote: null },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException("Asset status changed while processing.");
      }
      return tx.garmentAsset.findUniqueOrThrow({ where: { id: assetId } });
    });

    this.realtime.assetChanged({ id: updated.id, assetId: updated.id, status: updated.status });
    if (asset.status === AssetStatus.laundry) {
      this.realtime.laundryChanged({ assetId: updated.id });
    }
    if (asset.status === AssetStatus.maintenance) {
      this.realtime.maintenanceChanged({ assetId: updated.id });
    }

    return ok({ id: updated.id, assetCode: updated.assetCode, status: updated.status, conditionNote: updated.conditionNote });
  }

  async findAssetsNeedingProcessing() {
    const assets = await this.prisma.garmentAsset.findMany({
      where: { status: { in: [AssetStatus.laundry, AssetStatus.maintenance] } },
      include: {
        garment_sizes: { include: { garments: { select: { id: true, name: true } } } },
        laundryTickets: { where: { status: "open" }, take: 1 },
        maintenanceJobs: { where: { status: "open" }, take: 1 },
      },
      orderBy: { updatedAt: "asc" },
    });
    return ok(assets.map((a) => ({
      id: a.id, assetCode: a.assetCode, status: a.status, conditionNote: a.conditionNote,
      garment: { id: a.garment_sizes?.garments?.id ?? "", name: a.garment_sizes?.garments?.name ?? "", sizeLabel: a.garment_sizes?.size_label ?? null },
      hasOpenTicket: a.laundryTickets.length > 0 || a.maintenanceJobs.length > 0,
    })));
  }

  // ── Inspection log ─────────────────────────────────────────────────────────

  async findAllLog() {
    const sessions = await this.prisma.inspectionSession.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        findings: { select: { id: true, penaltyAmount: true } },
        garmentAsset: {
          select: { assetCode: true, garment: { select: { name: true } } },
        },
        inspector: {
          select: { profile: { select: { fullName: true } }, email: true },
        },
      },
    });

    return ok(
      sessions.map((s) => ({
        id: s.id,
        bookingId: s.bookingId,
        assetCode: s.garmentAsset.assetCode,
        garmentName: s.garmentAsset.garment.name,
        status: s.status,
        inspectorName:
          s.inspector?.profile?.fullName ?? s.inspector?.email ?? null,
        findingsCount: s.findings.length,
        totalPenalty: s.findings.reduce(
          (sum, f) => sum + Number(f.penaltyAmount),
          0,
        ),
        createdAt: s.createdAt.toISOString(),
        completedAt: s.completedAt?.toISOString() ?? null,
      })),
    );
  }

  // ── Laundry queue ──────────────────────────────────────────────────────────

  async findAllLaundry() {
    const tickets = await this.prisma.laundryTicket.findMany({
      where: { status: { notIn: ["completed", "cannot_repair"] } },
      orderBy: { createdAt: "asc" },
      include: {
        garmentAsset: {
          select: { assetCode: true, garment: { select: { name: true } } },
        },
      },
    });

    return ok(
      tickets.map((t) => ({
        id: t.id,
        garmentAssetId: t.garmentAssetId,
        assetCode: t.garmentAsset.assetCode,
        garmentName: t.garmentAsset.garment.name,
        bookingId: t.bookingId,
        bookingCode: null,
        status: t.status,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
    );
  }

  async completeLaundry(ticketId: string, dto: CompleteLaundryDto) {
    const ticket = await this.prisma.laundryTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException("Laundry ticket not found.");
    if (ticket.status === "completed") {
      throw new BadRequestException("Laundry ticket already completed.");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.laundryTicket.update({
        where: { id: ticketId },
        data: {
          status: "completed",
          completedAt: new Date(),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });

      const claimed = await tx.garmentAsset.updateMany({
        where: { id: ticket.garmentAssetId, status: AssetStatus.laundry },
        data: { status: AssetStatus.cleaned },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException("Asset is no longer in laundry status.");
      }

      return done;
    });

    this.realtime.laundryChanged({
      id: updated.id,
      assetId: updated.garmentAssetId,
      status: updated.status,
    });
    this.realtime.assetChanged({
      id: updated.garmentAssetId,
      assetId: updated.garmentAssetId,
      status: AssetStatus.cleaned,
    });

    return ok({
      id: updated.id,
      garmentAssetId: updated.garmentAssetId,
      status: updated.status,
      note: updated.note,
      completedAt: updated.completedAt?.toISOString() ?? null,
    });
  }

  // ── Maintenance queue ──────────────────────────────────────────────────────

  async findAllMaintenance() {
    const jobs = await this.prisma.maintenanceJob.findMany({
      where: { status: { in: ACTIVE_MAINTENANCE_STATUSES } },
      orderBy: { createdAt: "asc" },
      include: {
        garmentAsset: {
          select: { assetCode: true, garment: { select: { name: true } } },
        },
      },
    });

    return ok(
      jobs.map((j) => ({
        id: j.id,
        garmentAssetId: j.garmentAssetId,
        assetCode: j.garmentAsset.assetCode,
        garmentName: j.garmentAsset.garment.name,
        status: j.status,
        note: j.note,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      })),
    );
  }

  async completeMaintenance(jobId: string, dto: CompleteMaintenanceDto) {
    const targetStatus = dto.status as MaintenanceStatus;
    if (targetStatus !== MaintenanceStatus.completed && targetStatus !== MaintenanceStatus.cannot_repair) {
      throw new BadRequestException("Maintenance can only be completed or marked cannot_repair.");
    }

    const updated = await this.prisma.runSerializable(async (tx) => {
      const job = await tx.maintenanceJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException("Maintenance job not found.");
      if (!ACTIVE_MAINTENANCE_STATUSES.includes(job.status)) {
        throw new BadRequestException("Maintenance job already completed.");
      }

      const claimedJob = await tx.maintenanceJob.updateMany({
        where: { id: jobId, status: { in: ACTIVE_MAINTENANCE_STATUSES } },
        data: {
          status: targetStatus,
          completedAt: new Date(),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });
      if (claimedJob.count !== 1) throw new ConflictException("Maintenance job was already processed.");

      const nextAssetStatus = targetStatus === MaintenanceStatus.completed
        ? AssetStatus.cleaned
        : AssetStatus.damaged;
      const claimedAsset = await tx.garmentAsset.updateMany({
        where: { id: job.garmentAssetId, status: AssetStatus.maintenance },
        data: {
          status: nextAssetStatus,
          ...(nextAssetStatus === AssetStatus.cleaned ? { conditionNote: null } : {}),
        },
      });
      if (claimedAsset.count !== 1) {
        throw new BadRequestException("Asset is no longer in maintenance status.");
      }

      return tx.maintenanceJob.findUniqueOrThrow({ where: { id: jobId } });
    });

    this.realtime.maintenanceChanged({
      id: updated.id,
      assetId: updated.garmentAssetId,
      status: updated.status,
    });
    this.realtime.assetChanged({
      id: updated.garmentAssetId,
      assetId: updated.garmentAssetId,
      status: targetStatus === MaintenanceStatus.completed ? AssetStatus.cleaned : AssetStatus.damaged,
    });

    return ok({
      id: updated.id,
      garmentAssetId: updated.garmentAssetId,
      status: updated.status,
      note: updated.note,
      completedAt: updated.completedAt?.toISOString() ?? null,
    });
  }

  private sessionInclude() {
    return {
      findings: true,
      photos: true,
      booking: { include: { items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } } } },
      garmentAsset: { include: { garment_sizes: { include: { garments: true } } } },
      inspector: { include: { profile: true } },
    } satisfies Prisma.InspectionSessionInclude;
  }

  private async isBookingFullyInspected(tx: Prisma.TransactionClient, bookingId: string) {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { items: true },
    });
    if (!booking || booking.items.length === 0) return false;

    const assetIds = booking.items
      .map((item) => item.garmentAssetId)
      .filter((assetId): assetId is string => Boolean(assetId));
    const distinctAssetIds = new Set(assetIds);
    if (assetIds.length !== booking.items.length || distinctAssetIds.size !== booking.items.length) {
      return false;
    }

    const completedSessions = await tx.inspectionSession.findMany({
      where: {
        bookingId,
        status: InspectionStatus.completed,
        garmentAssetId: { in: [...distinctAssetIds] },
      },
      select: { garmentAssetId: true },
    });
    const inspectedAssetIds = new Set(completedSessions.map((session) => session.garmentAssetId));
    return inspectedAssetIds.size === distinctAssetIds.size;
  }

  private async finalizeBookingInspection(
    tx: Prisma.TransactionClient,
    input: {
      bookingId: string;
      bookingStatus: BookingStatus;
      depositTotal: number;
      penaltyTotal: number;
      staffId: string;
    },
  ) {
    const refundAmount = Math.max(0, input.depositTotal - input.penaltyTotal);
    const existingRefund = await tx.refund.findFirst({
      where: { bookingId: input.bookingId, status: { in: ACTIVE_REFUND_STATUSES } },
      orderBy: { createdAt: "desc" },
    });

    let hasRefundToApprove =
      existingRefund?.status === PaymentStatus.pending || existingRefund?.status === PaymentStatus.refunding;
    const hasCompletedRefund =
      existingRefund?.status === PaymentStatus.refunded || existingRefund?.status === PaymentStatus.partially_refunded;

    if (refundAmount > 0 && !existingRefund) {
      const payment = await this.findAuthoritativePaidPayment(tx, input.bookingId);
      if (!payment) {
        throw new BadRequestException("Không tìm thấy payment đã thanh toán để xác định phương thức hoàn cọc.");
      }
      const refundMethod = this.refundMethodForPayment(payment);
      if (!refundMethod) {
        throw new BadRequestException(`Không hỗ trợ phương thức thanh toán '${payment.paymentMethod ?? payment.provider}' để tự động hoàn cọc.`);
      }

      const createdRefund = await tx.refund.create({
        data: {
          bookingId: input.bookingId,
          paymentId: payment.id,
          amount: refundAmount,
          status: PaymentStatus.pending,
          refund_method: refundMethod,
          reason: "Tự động tạo sau khi kiểm tra toàn bộ trang phục",
          processed_by: input.staffId,
        },
      });
      await tx.financialTransaction.create({
        data: {
          bookingId: input.bookingId,
          refundId: createdRefund.id,
          transactionType: refundMethod === "cash" ? "refund_cash_pending" : "refund_bank_transfer_pending",
          amount: refundAmount,
          note: `Tạo yêu cầu hoàn cọc tự động sau kiểm tra. Số tiền: ${refundAmount.toLocaleString("vi-VN")}đ`,
        },
      });
      hasRefundToApprove = true;
    }

    const nextStatus = hasCompletedRefund || (!hasRefundToApprove && refundAmount <= 0)
      ? BookingStatus.completed
      : BookingStatus.refund_pending;

    if (input.bookingStatus !== nextStatus) {
      const claimed = await tx.booking.updateMany({
        where: { id: input.bookingId, status: input.bookingStatus },
        data: { status: nextStatus },
      });
      if (claimed.count !== 1) throw new ConflictException("Booking status changed while completing inspection.");
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: input.bookingId,
          fromStatus: input.bookingStatus,
          toStatus: nextStatus,
          changedBy: input.staffId,
          note: nextStatus === BookingStatus.refund_pending
            ? "Kiểm tra xong — đã tạo yêu cầu hoàn cọc, chờ quản lý duyệt"
            : "All items inspected",
        },
      });
    }
  }

  private async findAuthoritativePaidPayment(tx: Prisma.TransactionClient, bookingId: string) {
    return tx.payment.findFirst({
      where: { bookingId, status: PaymentStatus.paid },
      orderBy: [
        { depositAmount: "desc" },
        { paidAt: "desc" },
        { createdAt: "desc" },
      ],
      select: { id: true, paymentMethod: true, provider: true },
    });
  }

  private refundMethodForPayment(payment: { paymentMethod: string | null; provider: string }) {
    const method = payment.paymentMethod?.toLowerCase() ?? "";
    const provider = payment.provider?.toLowerCase() ?? "";
    if (method === "cash") return "cash";
    if (["bank_transfer", "online", "qr", "qr_code", "payos"].includes(method)) return "bank_transfer";
    if (["online", "payos"].includes(provider)) return "bank_transfer";
    return null;
  }

  // ── Serialization helpers ──────────────────────────────────────────────────

  private serialize(session: any) {
    return {
      id: session.id, bookingId: session.bookingId, garmentAssetId: session.garmentAssetId,
      status: session.status, note: session.note,
      createdAt: session.createdAt.toISOString(), completedAt: session.completedAt?.toISOString() ?? null,
      inspector: session.inspector ? { id: session.inspector.id, fullName: session.inspector.profile?.fullName ?? session.inspector.email } : null,
      asset: {
        id: session.garmentAsset.id, assetCode: session.garmentAsset.assetCode, status: session.garmentAsset.status, conditionNote: session.garmentAsset.conditionNote,
        garment: {
          id: session.garmentAsset.garment_sizes?.garments?.id,
          name: session.garmentAsset.garment_sizes?.garments?.name,
          sizeLabel: session.garmentAsset.garment_sizes?.size_label,
        },
      },
      booking: {
        id: session.booking.id,
        status: session.booking.status,
        customerName: null,
        rentalStartDate: session.booking.rentalStartDate.toISOString().slice(0, 10),
        rentalEndDate: session.booking.rentalEndDate.toISOString().slice(0, 10),
        items: session.booking.items.map((item: any) => ({
          id: item.id, garmentSizeId: item.garment_size_id, garmentId: item.garmentId,
          garmentName: item.garment_sizes?.garments?.name ?? null,
          sizeLabel: item.garment_sizes?.size_label ?? null,
          assetCode: item.garmentAsset?.assetCode ?? null,
        })),
      },
      findings: session.findings.map((f: any) => ({ id: f.id, findingType: f.findingType, severity: f.severity, description: f.description, penaltyAmount: Number(f.penaltyAmount), createdAt: f.createdAt.toISOString() })),
      photos: session.photos.map((p: any) => ({ id: p.id, imageUrl: p.imageUrl, note: p.note, createdAt: p.createdAt.toISOString() })),
    };
  }
}
