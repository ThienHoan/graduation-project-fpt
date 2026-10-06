import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AssetStatus, BookingStatus, InspectionStatus } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { CompleteInspectionDto } from "./dto/complete-inspection.dto";
import type { CreateFindingDto } from "./dto/create-finding.dto";
import type { CreateInspectionDto } from "./dto/create-inspection.dto";
import type { CreatePhotoDto } from "./dto/create-photo.dto";
import type { CompleteLaundryDto } from "./dto/laundry.dto";
import type { CompleteMaintenanceDto } from "./dto/maintenance.dto";

@Injectable()
export class InspectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrGet(dto: CreateInspectionDto, staffId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } });
    if (!booking) throw new NotFoundException("Booking not found.");

    const asset = await this.prisma.garmentAsset.findUnique({
      where: { id: dto.garmentAssetId },
      include: { garment_sizes: { include: { garments: true } } },
    });
    if (!asset) throw new NotFoundException("Garment asset not found.");
    if (asset.status !== AssetStatus.inspection_pending)
      throw new BadRequestException(`Asset '${asset.assetCode}' is not ready for inspection (current: ${asset.status}).`);

    const assignedToBooking = await this.prisma.bookingItem.findFirst({
      where: { bookingId: dto.bookingId, garmentAssetId: dto.garmentAssetId },
      select: { id: true },
    });
    if (!assignedToBooking) {
      throw new BadRequestException("Asset is not assigned to this booking.");
    }

    const existing = await this.prisma.inspectionSession.findFirst({
      where: { bookingId: dto.bookingId, garmentAssetId: dto.garmentAssetId, status: { not: InspectionStatus.completed } },
      include: {
        findings: true, photos: true,
        booking: { include: { items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } } } },
        garmentAsset: { include: { garment_sizes: { include: { garments: true } } } },
        inspector: { include: { profile: true } },
      },
    });
    if (existing) return ok(this.serialize(existing));


    const session = await this.prisma.$transaction(async (tx) => {
      if (booking.status === BookingStatus.returned) {
        await tx.booking.update({ where: { id: dto.bookingId }, data: { status: BookingStatus.inspection_pending } });
        await tx.bookingStatusHistory.create({
          data: { bookingId: dto.bookingId, fromStatus: BookingStatus.returned, toStatus: BookingStatus.inspection_pending, changedBy: staffId, note: "Bắt đầu kiểm tra" },
        });
      }
      return tx.inspectionSession.create({
        data: { bookingId: dto.bookingId, garmentAssetId: dto.garmentAssetId, status: InspectionStatus.in_progress, inspectedBy: staffId, note: dto.note ?? null },
        include: {
          findings: true, photos: true,
          booking: { include: { items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } } } },
          garmentAsset: { include: { garment_sizes: { include: { garments: true } } } },
          inspector: { include: { profile: true } },
        },
      });
    });
    return ok(this.serialize(session));
  }

  async findByBooking(bookingId: string) {
    const sessions = await this.prisma.inspectionSession.findMany({
      where: { bookingId }, orderBy: { createdAt: "desc" },
      include: {
        findings: true, photos: true,
        booking: { include: { items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } } } },
        garmentAsset: { include: { garment_sizes: { include: { garments: true } } } },
        inspector: { include: { profile: true } },
      },
    });
    return ok(sessions.map((s) => this.serialize(s)));
  }

  async findOne(id: string) {
    const session = await this.prisma.inspectionSession.findUnique({
      where: { id },
      include: {
        findings: true, photos: true,
        booking: { include: { items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } } } },
        garmentAsset: { include: { garment_sizes: { include: { garments: true } } } },
        inspector: { include: { profile: true } },
      },
    });
    if (!session) throw new NotFoundException("Inspection session not found.");
    return ok(this.serialize(session));
  }

  async addFinding(sessionId: string, dto: CreateFindingDto) {
    const session = await this.prisma.inspectionSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException("Inspection session not found.");
    if (session.status === InspectionStatus.completed) throw new BadRequestException("Cannot add finding to a completed inspection.");
    const finding = await this.prisma.inspectionFinding.create({
      data: { inspectionSessionId: sessionId, findingType: dto.findingType, severity: dto.severity ?? "low", description: dto.description ?? null, penaltyAmount: dto.penaltyAmount ?? 0 },
    });
    return ok({ id: finding.id, findingType: finding.findingType, severity: finding.severity, description: finding.description, penaltyAmount: Number(finding.penaltyAmount), createdAt: finding.createdAt.toISOString() });
  }

  async addPhoto(sessionId: string, dto: CreatePhotoDto) {
    const session = await this.prisma.inspectionSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException("Inspection session not found.");
    if (session.status === InspectionStatus.completed) throw new BadRequestException("Cannot add photo to a completed inspection.");
    const photo = await this.prisma.inspectionPhoto.create({ data: { inspectionSessionId: sessionId, imageUrl: dto.imageUrl, note: dto.note ?? null } });
    return ok({ id: photo.id, imageUrl: photo.imageUrl, note: photo.note, createdAt: photo.createdAt.toISOString() });
  }

  async complete(id: string, dto: CompleteInspectionDto, staffId: string) {
    const session = await this.prisma.inspectionSession.findUnique({
      where: { id },
      include: { findings: true, booking: { include: { items: true } } },
    });
    if (!session) throw new NotFoundException("Inspection session not found.");
    if (session.status === InspectionStatus.completed) throw new BadRequestException("Inspection has already been completed.");

    const finalAssetStatus = dto.finalAssetStatus as AssetStatus;
    const { bookingId, garmentAssetId } = session;

    const updated = await this.prisma.$transaction(async (tx) => {
      const currentAsset = await tx.garmentAsset.findUnique({ where: { id: garmentAssetId } });
      if (!currentAsset) throw new NotFoundException("Garment asset not found.");
      if (currentAsset.status !== AssetStatus.inspection_pending) {
        throw new BadRequestException(
          `Asset is no longer awaiting inspection (current: ${currentAsset.status}).`,
        );
      }
      const allowedFinalStatuses: AssetStatus[] = [
        AssetStatus.laundry,
        AssetStatus.maintenance,
        AssetStatus.damaged,
      ];
      if (!allowedFinalStatuses.includes(finalAssetStatus)) {
        throw new BadRequestException("Inspection must send the asset to laundry, maintenance, or damaged.");
      }
      await tx.garmentAsset.updateMany({
        where: { id: garmentAssetId, status: AssetStatus.inspection_pending },
        data: { status: finalAssetStatus },
      });

      if (finalAssetStatus === AssetStatus.laundry) {
        await tx.laundryTicket.create({ data: { garmentAssetId, bookingId, status: "open", note: dto.note ?? `Tạo từ inspection ${id}` } });
      }
      if (finalAssetStatus === AssetStatus.maintenance) {
        await tx.maintenanceJob.create({ data: { garmentAssetId, status: "open", note: dto.note ?? `Tạo từ inspection ${id}` } });
      }

      const totalPenalty = session.findings.reduce(
        (sum, f) => sum + Number(f.penaltyAmount),
        0,
      );
      if (totalPenalty > 0) {
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            penaltyTotal: { increment: totalPenalty },
          },
        });

        await tx.penalty.create({
          data: {
            bookingId,
            reason: dto.note ?? `Inspection findings for session ${id}`,
            amount: totalPenalty,
            createdBy: staffId,
          },
        });
      }

      const completedSession = await tx.inspectionSession.update({
        where: { id },
        data: { status: InspectionStatus.completed, completedAt: new Date(), ...(dto.note ? { note: dto.note } : {}) },
        include: {
          findings: true, photos: true,
          booking: { include: { items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } } } },
          garmentAsset: { include: { garment_sizes: { include: { garments: true } } } },
          inspector: { include: { profile: true } },
        },
      });

      const assignedAssetIds = session.booking.items
        .map((item) => item.garmentAssetId)
        .filter((assetId): assetId is string => Boolean(assetId));

      if (assignedAssetIds.length > 0) {
        const pendingCount = await tx.garmentAsset.count({ where: { id: { in: assignedAssetIds }, status: AssetStatus.inspection_pending } });
        if (pendingCount === 0) {
          const previousStatus = session.booking.status;

          await tx.booking.update({
            where: { id: bookingId },
            data: { status: BookingStatus.completed },
          });

          await tx.bookingStatusHistory.create({
            data: { bookingId, fromStatus: previousStatus, toStatus: BookingStatus.completed, changedBy: staffId, note: "All items inspected" },
          });

          const depositTotal = Number(session.booking.depositTotal);
          // session.booking.penaltyTotal là giá trị TRƯỚC khi increment ở trên,
          // nên phải cộng thêm khoản phạt vừa ghi nhận trong lần kiểm tra này.
          const penaltyTotal = Number(session.booking.penaltyTotal) + totalPenalty;
          const refundAmount = depositTotal - penaltyTotal;

          // Còn cọc phải hoàn → chuyển sang bước "Hoàn cọc": staff chủ động tạo
          // yêu cầu hoàn cọc, owner duyệt xong booking mới completed.
          const nextStatus = refundAmount > 0 ? BookingStatus.refund_pending : BookingStatus.completed;

          await tx.booking.update({
            where: { id: bookingId },
            data: { status: nextStatus },
          });

          await tx.bookingStatusHistory.create({
            data: {
              bookingId, fromStatus: previousStatus, toStatus: nextStatus, changedBy: staffId,
              note: nextStatus === BookingStatus.refund_pending ? "Kiểm tra xong — chờ hoàn cọc" : "All items inspected",
            },
          });
        }
      }
      return completedSession;
    });
    return ok(this.serialize(updated));
  }

  async markAssetReady(assetId: string, staffId: string) {
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
    const job = await this.prisma.maintenanceJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException("Maintenance job not found.");

    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.maintenanceJob.update({
        where: { id: jobId },
        data: {
          status: dto.status as any,
          ...(dto.status === "completed" ? { completedAt: new Date() } : {}),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });

      if (dto.status === "completed") {
        const claimed = await tx.garmentAsset.updateMany({
          where: { id: job.garmentAssetId, status: AssetStatus.maintenance },
          data: { status: AssetStatus.cleaned, conditionNote: null },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException("Asset is no longer in maintenance status.");
        }
      }
      if (dto.status === "cannot_repair") {
        await tx.garmentAsset.updateMany({
          where: { id: job.garmentAssetId, status: AssetStatus.maintenance },
          data: { status: AssetStatus.damaged },
        });
      }

      return done;
    });

    return ok({
      id: updated.id,
      garmentAssetId: updated.garmentAssetId,
      status: updated.status,
      note: updated.note,
      completedAt: updated.completedAt?.toISOString() ?? null,
    });
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
