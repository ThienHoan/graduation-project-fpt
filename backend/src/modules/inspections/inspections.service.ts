import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { AssetStatus, BookingStatus, InspectionStatus, MaintenanceStatus, PaymentStatus, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { AiService } from "../ai/ai.service";
import type { CompleteInspectionDto } from "./dto/complete-inspection.dto";
import type { CreateFindingDto } from "./dto/create-finding.dto";
import type { CreateInspectionDto } from "./dto/create-inspection.dto";
import type { CreatePhotoDto } from "./dto/create-photo.dto";
import type { CompleteLaundryDto } from "./dto/laundry.dto";
import type { CompleteMaintenanceDto } from "./dto/maintenance.dto";
import type { OverridePenaltyDto } from "./dto/override-penalty.dto";
import type { ManagerApproveDto, ManagerRejectDto } from "./dto/manager-review.dto";

/** Ngưỡng phạt/cọc để tự động chuyển sang chờ duyệt manager */
const MANAGER_APPROVAL_THRESHOLD = 0.3;
/** Ngưỡng phạt/giá trị trang phục (>= 70% giá trị đồ) để tự động chuyển sang chờ duyệt manager */
const MANAGER_APPROVAL_GARMENT_THRESHOLD = 0.7;

const ACTIVE_REFUND_STATUSES: PaymentStatus[] = [
  PaymentStatus.pending,
  PaymentStatus.refunding,
  PaymentStatus.refunded,
  PaymentStatus.partially_refunded,
];

const ACTIVE_INSPECTION_STATUSES: InspectionStatus[] = [
  InspectionStatus.pending,
  InspectionStatus.in_progress,
  InspectionStatus.pending_manager_approval,
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
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Optional() private readonly aiService?: AiService,
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

      // Món đã có phiên hoàn tất thì không tạo phiên mới (tránh staff tưởng chưa kiểm tra).
      const completedSession = await tx.inspectionSession.findFirst({
        where: { bookingId: dto.bookingId, garmentAssetId: dto.garmentAssetId, status: InspectionStatus.completed },
        select: { id: true, completedAt: true },
      });
      if (completedSession) {
        const when = completedSession.completedAt
          ? new Date(completedSession.completedAt).toLocaleString("vi-VN")
          : "trước đó";
        throw new BadRequestException(
          `Món này đã kiểm tra xong (hoàn tất lúc ${when}). Không cần tạo phiên mới.` +
          ` Nếu đơn vẫn ở hàng chờ, hãy kiểm tra nốt các món/phụ kiện còn lại rồi dùng "Hoàn tất kiểm tra đơn".`,
        );
      }

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

  async findByCustomerBooking(customerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true },
    });
    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.customerId !== customerId) {
      throw new ForbiddenException("Bạn không có quyền xem biên bản kiểm tra của đơn hàng này.");
    }
    return this.findByBooking(bookingId);
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

  async deleteFinding(sessionId: string, findingId: string) {
    const session = await this.prisma.inspectionSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException("Inspection session not found.");
    if (!MUTABLE_INSPECTION_STATUSES.includes(session.status)) {
      throw new BadRequestException("Không thể xoá ghi nhận lỗi trên phiên kiểm tra đã hoàn thành.");
    }

    const finding = await this.prisma.inspectionFinding.findFirst({
      where: { id: findingId, inspectionSessionId: sessionId },
    });
    if (!finding) {
      throw new NotFoundException("Không tìm thấy ghi nhận lỗi này trong phiên kiểm tra.");
    }

    await this.prisma.inspectionFinding.delete({
      where: { id: findingId },
    });

    return ok({ message: "Đã xoá ghi nhận lỗi thành công", findingId });
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

  async deletePhoto(sessionId: string, photoId: string) {
    const session = await this.prisma.inspectionSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException("Inspection session not found.");
    if (!MUTABLE_INSPECTION_STATUSES.includes(session.status)) {
      throw new BadRequestException("Không thể xoá ảnh trên phiên kiểm tra đã hoàn thành.");
    }

    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id: photoId, inspectionSessionId: sessionId },
    });
    if (!photo) {
      throw new NotFoundException("Không tìm thấy ảnh này trong phiên kiểm tra.");
    }

    await this.prisma.inspectionPhoto.delete({
      where: { id: photoId },
    });

    return ok({ message: "Đã xoá ảnh thành công", photoId });
  }

  async runAiComparison(sessionId: string, dto?: { afterImageUrls?: string[] }, staffId?: string) {
    const session = await this.prisma.inspectionSession.findUnique({
      where: { id: sessionId },
      include: this.sessionInclude(),
    });
    if (!session) throw new NotFoundException("Inspection session not found.");
    if (!MUTABLE_INSPECTION_STATUSES.includes(session.status)) {
      throw new BadRequestException("Không thể so sánh AI trên phiên kiểm tra đã hoàn thành.");
    }

    // Nếu staff truyền thêm các ảnh mới chụp sau khi thuê, thêm vào session photos
    if (dto?.afterImageUrls && dto.afterImageUrls.length > 0) {
      for (const url of dto.afterImageUrls) {
        if (!session.photos.some((p) => p.imageUrl === url)) {
          const photo = await this.prisma.inspectionPhoto.create({
            data: {
              inspectionSessionId: sessionId,
              imageUrl: url,
              photoType: "after",
            },
          });
          session.photos.push(photo as any);
        }
      }
    }

    // Lấy ảnh trước thuê (Handover condition images từ object { images: [...] } hoặc array)
    const beforeImages = [
      ...new Set([
        ...this.extractHandoverImages((session.booking as any)?.conditionImages),
        ...session.photos.filter((p: any) => p.photoType === "before").map((p) => p.imageUrl),
      ]),
    ];

    // Lấy ảnh sau khi thuê (Trả đồ)
    const afterImages = session.photos
      .filter((p: any) => p.photoType !== "before")
      .map((p) => p.imageUrl);

    if (afterImages.length === 0) {
      throw new BadRequestException("Cần có ít nhất một ảnh sau khi nhận lại đồ để AI kiểm tra.");
    }

    const matchedItem = (session.booking as any)?.items?.find(
      (i: any) => i.garmentAssetId === session.garmentAssetId,
    );

    const garmentName =
      (session.garmentAsset as any)?.garment_sizes?.garments?.name ??
      matchedItem?.garment_sizes?.garments?.name ??
      "Trang phục";

    const purchaseCost = Number(session.garmentAsset?.purchaseCost ?? 0);
    const depositAmount = Number(
      matchedItem?.depositAmount ??
      (session.garmentAsset as any)?.garment_sizes?.deposit_amount ??
      0,
    );
    const dailyPrice = Number(matchedItem?.dailyPrice ?? matchedItem?.basePrice ?? 0);

    const garmentValue =
      purchaseCost > 0
        ? purchaseCost
        : depositAmount > 0
        ? depositAmount
        : dailyPrice > 0
        ? dailyPrice * 4
        : 400000;

    if (!this.aiService) {
      throw new BadRequestException("AI service is not configured.");
    }

    const aiResult = await this.aiService.compareInspectionPhotos({
      productTitle: garmentName,
      conditionBeforeRental: (session.booking as any)?.conditionBeforeRental ?? null,
      beforeImages,
      afterImages,
      notes: session.note,
      garmentValue,
      depositAmount,
      rentalPrice: dailyPrice,
    });

    // Cập nhật kết quả vào database
    const updated = await this.prisma.inspectionSession.update({
      where: { id: sessionId },
      data: {
        aiComparisonResult: {
          ...aiResult,
          garmentValue,
        } as any,
        aiComparedAt: new Date(),
      },
      include: this.sessionInclude(),
    });

    this.realtime.inspectionChanged({ id: sessionId });

    return ok({
      aiComparisonResult: aiResult,
      session: this.serialize(updated),
    });
  }

  async applyAiFindings(sessionId: string) {
    const session = await this.prisma.inspectionSession.findUnique({
      where: { id: sessionId },
      include: {
        garmentAsset: { include: { garment: true, garment_sizes: true } },
        booking: { include: { items: true } },
      },
    });
    if (!session) throw new NotFoundException("Inspection session not found.");
    if (!MUTABLE_INSPECTION_STATUSES.includes(session.status)) {
      throw new BadRequestException("Không thể áp dụng lỗi AI trên phiên kiểm tra đã hoàn thành.");
    }

    const aiResult = session.aiComparisonResult as any;
    if (!aiResult || !Array.isArray(aiResult.detectedIssues) || aiResult.detectedIssues.length === 0) {
      throw new BadRequestException("Không có lỗi nào từ kết quả AI để áp dụng.");
    }

    // ── Tính giá trị định giá của trang phục để bảo vệ trần tối đa ──
    const purchaseCost = Number(session.garmentAsset?.purchaseCost ?? 0);
    const matchedItem = session.booking?.items?.find((it: any) => it.garmentAssetId === session.garmentAssetId);
    const depositAmount = Number(
      matchedItem?.depositAmount ??
      (session.garmentAsset as any)?.garment_sizes?.deposit_amount ??
      0,
    );
    const dailyPrice = Number(matchedItem?.dailyPrice ?? (session.garmentAsset as any)?.garment?.rentalPrice ?? 0);
    const garmentValue =
      purchaseCost > 0
        ? purchaseCost
        : depositAmount > 0
        ? depositAmount
        : dailyPrice > 0
        ? dailyPrice * 4
        : 400000;

    const rawIssues = aiResult.detectedIssues.map((issue: any) => ({
      findingType: String(issue.findingType || "Lỗi kiểm tra"),
      severity: issue.severity ?? "low",
      description: String(issue.description || ""),
      suggestedPenalty: Math.max(0, Math.round(Number(issue.suggestedPenalty) || 0)),
    }));

    const rawSum = rawIssues.reduce((sum: number, it: any) => sum + it.suggestedPenalty, 0);
    let issuesToApply = rawIssues;

    if (rawSum > garmentValue && rawIssues.length > 0) {
      const allSevere = rawIssues.every(
        (it: any) => it.suggestedPenalty >= garmentValue * 0.7 || it.severity === "severe",
      );
      if (allSevere && rawIssues.length > 1) {
        const combinedDesc = rawIssues
          .map((it: any, i: number) => `[Ảnh ${i + 1} - ${it.findingType}]: ${it.description}`)
          .join("\n\n");
        issuesToApply = [
          {
            findingType: "Hư hỏng toàn diện không thể phục hồi",
            severity: "severe",
            description: combinedDesc,
            suggestedPenalty: garmentValue,
          },
        ];
      } else {
        let runningSum = 0;
        issuesToApply = rawIssues.map((issue: any, idx: number) => {
          if (idx === rawIssues.length - 1) {
            const remaining = Math.max(0, garmentValue - runningSum);
            return { ...issue, suggestedPenalty: remaining };
          }
          const scaled = Math.round(((issue.suggestedPenalty / rawSum) * garmentValue) / 1000) * 1000;
          runningSum += scaled;
          return { ...issue, suggestedPenalty: scaled };
        });
      }
    }

    const createdFindings = await this.prisma.runSerializable(async (tx) => {
      const results = [];
      for (const issue of issuesToApply) {
        const finding = await tx.inspectionFinding.create({
          data: {
            inspectionSessionId: sessionId,
            findingType: issue.findingType,
            severity: issue.severity ?? "low",
            description: issue.description,
            penaltyAmount: issue.suggestedPenalty ?? 0,
          },
        });
        results.push(finding);
      }
      return results;
    });

    const refreshed = await this.prisma.inspectionSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: this.sessionInclude(),
    });

    this.realtime.inspectionChanged({ id: sessionId });

    return ok({
      appliedCount: createdFindings.length,
      session: this.serialize(refreshed),
    });
  }

  async complete(id: string, dto: CompleteInspectionDto, staffId: string) {
    try {
      await this.prisma.runSerializable(async (tx) => {
        const finalAssetStatus = dto.finalAssetStatus as AssetStatus;
        if (!FINAL_ASSET_STATUSES.includes(finalAssetStatus)) {
          throw new BadRequestException("Inspection must send the asset to laundry, maintenance, or damaged.");
        }

        const session = await tx.inspectionSession.findUnique({
          where: { id },
          include: {
            booking: { include: { items: true } },
            garmentAsset: { include: { garment: true, garment_sizes: true } },
          },
        });
        if (!session) throw new NotFoundException("Inspection session not found.");
        if (!MUTABLE_INSPECTION_STATUSES.includes(session.status)) {
          // Idempotent guard: Phiên đã hoàn tất, trả về id để query lại ngoài tx
          return id;
        }

        // ── Tính tổng phạt và kiểm tra ngưỡng ──
        const penaltyAggregate = await tx.inspectionFinding.aggregate({
          where: { inspectionSessionId: id },
          _sum: { penaltyAmount: true },
        });
        const rawPenalty = Number(penaltyAggregate._sum.penaltyAmount ?? 0);

        // Bảo vệ trần phạt: không vượt quá giá trị trang phục
        const purchaseCost = Number(session.garmentAsset?.purchaseCost ?? 0);
        const matchedItem = session.booking?.items?.find((it: any) => it.garmentAssetId === session.garmentAssetId);
        const depositAmount = Number(
          matchedItem?.depositAmount ??
          (session.garmentAsset as any)?.garment_sizes?.deposit_amount ??
          0,
        );
        const dailyPrice = Number(matchedItem?.dailyPrice ?? matchedItem?.basePrice ?? (session.garmentAsset as any)?.garment?.rentalPrice ?? 0);
        const garmentValue =
          purchaseCost > 0 ? purchaseCost
          : depositAmount > 0 ? depositAmount
          : dailyPrice > 0 ? dailyPrice * 4
          : 0;
        const cappedPenalty = garmentValue > 0 ? Math.min(garmentValue, rawPenalty) : rawPenalty;

        // ── Kiểm tra điều kiện cần Quản lý duyệt ──
        // 1. Phạt > 30% tiền cọc (hoặc cọc = 0 mà có phạt)
        // 2. Phạt >= 70% giá trị thực của món đồ (hỏng nặng hoặc đền đứt món đồ)
        // 3. Có lỗi hư hỏng nghiêm trọng (severe) do AI hoặc nhân viên ghi nhận
        const findings = await tx.inspectionFinding.findMany({
          where: { inspectionSessionId: id },
          select: { severity: true },
        });
        const hasSevereIssue = findings.some((f) => f.severity === "severe");
        const penaltyToDepositRatio = depositAmount > 0 ? cappedPenalty / depositAmount : (cappedPenalty > 0 ? 1 : 0);
        const penaltyToGarmentRatio = garmentValue > 0 ? cappedPenalty / garmentValue : 0;

        const needsManagerApproval =
          cappedPenalty > 0 &&
          (
            penaltyToDepositRatio > MANAGER_APPROVAL_THRESHOLD ||
            penaltyToGarmentRatio >= MANAGER_APPROVAL_GARMENT_THRESHOLD ||
            hasSevereIssue
          );

        if (needsManagerApproval) {
          // Chuyển sang trạng thái chờ duyệt — CHƯA trừ tiền / ghi nợ
          // Lưu finalAssetStatus vào note để manager biết khi approve
          const noteWithAction = `[PENDING_APPROVAL|finalAssetStatus=${finalAssetStatus}] ${dto.note ?? ""}`.trim();
          await tx.inspectionSession.update({
            where: { id },
            data: {
              status: InspectionStatus.pending_manager_approval,
              note: noteWithAction,
            },
          });
          // Asset vẫn ở inspection_pending — manager approve mới chuyển
          return id;
        }

        // ── Không vượt ngưỡng: complete bình thường ──
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
            data: {
              garmentAssetId: session.garmentAssetId,
              bookingId: session.bookingId,
              status: MaintenanceStatus.open,
              note: dto.note ?? `Giặt sấy sau khi trả đơn #${session.bookingId.slice(0, 8).toUpperCase()}`,
            },
          });
        }
        if (finalAssetStatus === AssetStatus.maintenance) {
          await tx.maintenanceJob.create({
            data: {
              garmentAssetId: session.garmentAssetId,
              status: MaintenanceStatus.open,
              note: dto.note ?? `Bảo trì sau khi trả đơn #${session.bookingId.slice(0, 8).toUpperCase()}`,
            },
          });
        }

        if (cappedPenalty > 0) {
          const sessionFindings = await tx.inspectionFinding.findMany({ where: { inspectionSessionId: id } });
          const findingsList = sessionFindings
            .map((f) => `${f.findingType}${Number(f.penaltyAmount) > 0 ? ` (-${Number(f.penaltyAmount).toLocaleString("vi-VN")}đ)` : ""}`)
            .join(", ");
          const detailedReason = dto.note?.trim()
            ? `${dto.note.trim()} [Khấu trừ: ${findingsList}]`
            : `Khấu trừ hư tổn trang phục: ${findingsList}`;

          const createdPenalty = await tx.penalty.create({
            data: { bookingId: session.bookingId, reason: detailedReason, amount: cappedPenalty, createdBy: staffId },
          });
          await tx.financialTransaction.create({
            data: {
              bookingId: session.bookingId, penaltyId: createdPenalty.id,
              transactionType: "penalty", amount: cappedPenalty, note: detailedReason,
            },
          });
        }

        const bookingAfterPenalty = await tx.booking.update({
          where: { id: session.bookingId },
          data: { penaltyTotal: { increment: cappedPenalty } },
          select: { id: true, status: true, depositTotal: true, penaltyTotal: true },
        });

        // Ghi khoản đền bù nếu phạt vượt cọc
        const depositTotal = Number(bookingAfterPenalty.depositTotal);
        const excessAmount = cappedPenalty > depositTotal ? cappedPenalty - depositTotal : 0;
        if (excessAmount > 0) {
          await tx.financialTransaction.create({
            data: {
              bookingId: session.bookingId, transactionType: "debt_collect_pending", amount: excessAmount,
              note: `Đền bù hư hại vượt tiền cọc: Phạt ${cappedPenalty.toLocaleString("vi-VN")}đ — Cọc ${depositTotal.toLocaleString("vi-VN")}đ — Cần thu thêm ${excessAmount.toLocaleString("vi-VN")}đ.`,
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

        return id;
      });
    } catch (error) {
      this.logger.error(`[complete] inspectionId=${id} — ${(error as any)?.message ?? error}`, (error as any)?.stack);

      const recheck = await this.prisma.inspectionSession?.findUnique({
        where: { id },
        include: this.sessionInclude(),
      });
      if (recheck?.status === InspectionStatus.completed || recheck?.status === InspectionStatus.pending_manager_approval) {
        return ok(this.serialize(recheck));
      }

      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      const prismaCode = (error as any)?.code;
      if (prismaCode === "P2034" || (error as any)?.message?.includes("could not serialize")) {
        throw new ConflictException("Dữ liệu đang được cập nhật đồng thời, vui lòng thử lại sau vài giây.");
      }
      throw new ConflictException("Hệ thống đang xử lý đơn hàng, vui lòng thử lại sau vài giây.");
    }

    const updated = await this.prisma.inspectionSession.findUniqueOrThrow({
      where: { id },
      include: this.sessionInclude(),
    });

    this.realtime.inspectionChanged({
      id: updated.id, bookingId: updated.bookingId, assetId: updated.garmentAssetId, status: updated.status,
    });
    this.realtime.assetChanged({
      id: updated.garmentAssetId, assetId: updated.garmentAssetId, bookingId: updated.bookingId, status: updated.garmentAsset.status,
    });
    this.realtime.bookingChanged({ id: updated.bookingId, bookingId: updated.bookingId, status: updated.booking.status });
    this.realtime.bookingChangedForCustomer(updated.booking.customerId, { id: updated.bookingId, bookingId: updated.bookingId, status: updated.booking.status });
    // Emit realtime cho manager dashboard
    this.realtime.inspectionChanged({ id: updated.id, bookingId: updated.bookingId, status: updated.status });

    if (updated.status === InspectionStatus.completed) {
      if (dto.finalAssetStatus === AssetStatus.laundry) {
        this.realtime.laundryChanged({ assetId: updated.garmentAssetId, bookingId: updated.bookingId });
      }
      if (dto.finalAssetStatus === AssetStatus.maintenance) {
        this.realtime.maintenanceChanged({ assetId: updated.garmentAssetId, bookingId: updated.bookingId });
      }
    }

    return ok(this.serialize(updated));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Manager: Xem danh sách biên bản chờ duyệt phạt
  // ─────────────────────────────────────────────────────────────────────────

  async findPendingManagerApproval() {
    const sessions = await this.prisma.inspectionSession.findMany({
      where: { status: InspectionStatus.pending_manager_approval },
      orderBy: { createdAt: "asc" },
      include: this.sessionInclude(),
    });

    return ok(
      sessions.map((s) => {
        const matchedItem = s.booking?.items?.find((it: any) => it.garmentAssetId === s.garmentAssetId);
        const depositAmount = Number(
          matchedItem?.depositAmount ??
          (s.garmentAsset as any)?.garment_sizes?.deposit_amount ??
          s.booking?.depositTotal ??
          0,
        );
        const purchaseCost = Number(s.garmentAsset?.purchaseCost ?? 0);
        const dailyPrice = Number(matchedItem?.dailyPrice ?? (s.garmentAsset as any)?.garment_sizes?.daily_price ?? 0);
        const garmentValue = purchaseCost > 0 ? purchaseCost : depositAmount > 0 ? depositAmount : dailyPrice > 0 ? dailyPrice * 4 : 0;
        const totalPenalty = s.findings.reduce((sum, f) => sum + Number(f.penaltyAmount), 0);
        const penaltyRatio = depositAmount > 0 ? totalPenalty / depositAmount : (totalPenalty > 0 ? 1 : 0);

        // Parse finalAssetStatus từ note
        const noteMatch = s.note?.match(/\[PENDING_APPROVAL\|finalAssetStatus=(\w+)\]/);
        const finalAssetStatus = noteMatch?.[1] ?? "laundry";
        const cleanNote = s.note?.replace(/\[PENDING_APPROVAL\|finalAssetStatus=\w+\]\s*/, "").trim() || null;

        return {
          ...this.serialize({ ...s, note: cleanNote }),
          depositAmount,
          totalPenalty,
          penaltyRatio,
          garmentValue,
          finalAssetStatus,
          customerName: s.booking?.customer?.profile?.fullName ?? (s.booking?.customer as any)?.email ?? null,
        };
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Manager: Duyệt phạt (có thể điều chỉnh mức)
  // ─────────────────────────────────────────────────────────────────────────

  async managerApprove(id: string, dto: ManagerApproveDto, managerId: string) {
    await this.prisma.runSerializable(async (tx) => {
      const session = await tx.inspectionSession.findUnique({
        where: { id },
        include: {
          booking: { include: { items: true } },
          garmentAsset: { include: { garment: true, garment_sizes: true } },
          findings: true,
        },
      });
      if (!session) throw new NotFoundException("Inspection session not found.");
      if (session.status !== InspectionStatus.pending_manager_approval) {
        throw new BadRequestException(`Phiên này không ở trạng thái chờ duyệt (hiện: ${session.status}).`);
      }

      // Parse finalAssetStatus từ note
      const noteMatch = session.note?.match(/\[PENDING_APPROVAL\|finalAssetStatus=(\w+)\]/);
      const finalAssetStatus = (noteMatch?.[1] ?? "laundry") as AssetStatus;
      const cleanNote = session.note?.replace(/\[PENDING_APPROVAL\|finalAssetStatus=\w+\]\s*/, "").trim() || null;

      // 1. Phê duyệt & lưu thêm ghi nhận hư hỏng của Manager
      const oldTotalRaw = session.findings.reduce((sum, f) => sum + Number(f.penaltyAmount), 0);

      if (dto.findings && dto.findings.length > 0) {
        for (const f of dto.findings) {
          const matched = session.findings.find((item) => item.id === f.id);
          if (matched) {
            const cleanType = this.cleanFindingTypeName(matched.findingType);

            // Giữ nguyên mức đề xuất ban đầu và mô tả chi tiết của Staff ("như rứa")
            await tx.inspectionFinding.update({
              where: { id: f.id },
              data: {
                findingType: `[Staff thẩm định] ${cleanType}`,
              },
            });

            // Lưu THÊM ghi nhận hư hỏng & phê duyệt chính thức của Manager
            await tx.inspectionFinding.create({
              data: {
                inspectionSessionId: id,
                findingType: `[Quản lý phê duyệt] ${cleanType}`,
                severity: matched.severity,
                description: dto.note || `Quản lý phê duyệt mức phạt: ${Number(f.penaltyAmount).toLocaleString("vi-VN")}đ`,
                penaltyAmount: Number(f.penaltyAmount),
              },
            });
          }
        }
      } else if (dto.totalPenaltyOverride !== undefined && dto.totalPenaltyOverride !== null) {
        // Nếu Quản lý ghi đè tổng mức phạt
        for (const finding of session.findings) {
          const cleanType = this.cleanFindingTypeName(finding.findingType);
          await tx.inspectionFinding.update({
            where: { id: finding.id },
            data: {
              findingType: `[Staff thẩm định] ${cleanType}`,
            },
          });
        }
        await tx.inspectionFinding.create({
          data: {
            inspectionSessionId: id,
            findingType: `[Quản lý phê duyệt] Hư hỏng toàn diện`,
            severity: "severe",
            description: dto.note || `Quản lý phê duyệt mức phạt toàn bộ: ${dto.totalPenaltyOverride.toLocaleString("vi-VN")}đ`,
            penaltyAmount: dto.totalPenaltyOverride,
          },
        });
      }

      // 2. Tính penalty cuối cùng được duyệt
      const matchedItem = session.booking?.items?.find((it: any) => it.garmentAssetId === session.garmentAssetId);
      const depositAmount = Number(
        matchedItem?.depositAmount ??
        (session.garmentAsset as any)?.garment_sizes?.deposit_amount ??
        session.booking?.depositTotal ??
        0,
      );
      const purchaseCost = Number(session.garmentAsset?.purchaseCost ?? 0);
      const dailyPrice = Number(matchedItem?.dailyPrice ?? (session.garmentAsset as any)?.garment_sizes?.daily_price ?? 0);
      const garmentValue = purchaseCost > 0 ? purchaseCost : depositAmount > 0 ? depositAmount : dailyPrice > 0 ? dailyPrice * 4 : 0;

      let approvedPenalty: number;
      if (dto.totalPenaltyOverride !== undefined && dto.totalPenaltyOverride !== null) {
        approvedPenalty = dto.totalPenaltyOverride;
      } else if (dto.findings && dto.findings.length > 0) {
        const rawPenalty = dto.findings.reduce((sum, f) => sum + Number(f.penaltyAmount), 0);
        approvedPenalty = garmentValue > 0 ? Math.min(garmentValue, rawPenalty) : rawPenalty;
      } else {
        const freshManagerFindings = await tx.inspectionFinding.findMany({
          where: { inspectionSessionId: id, findingType: { startsWith: "[Quản lý" } },
        });
        const rawPenalty = freshManagerFindings.reduce((sum, f) => sum + Number(f.penaltyAmount), 0);
        approvedPenalty = garmentValue > 0 ? Math.min(garmentValue, rawPenalty) : rawPenalty;
      }

      // 3. Hoàn tất session
      await tx.inspectionSession.update({
        where: { id },
        data: {
          status: InspectionStatus.completed,
          completedAt: new Date(),
          note: `[Duyệt bởi Manager] ${dto.note} (Điều chỉnh mức phạt: ${oldTotalRaw.toLocaleString("vi-VN")}đ ➔ ${approvedPenalty.toLocaleString("vi-VN")}đ)${cleanNote ? ` | Ghi chú staff: ${cleanNote}` : ""}`,
        },
      });

      // 4. Chuyển asset sang finalAssetStatus
      const currentAsset = await tx.garmentAsset.findUnique({ where: { id: session.garmentAssetId } });
      if (!currentAsset) throw new NotFoundException("Garment asset not found.");
      if (currentAsset.status !== AssetStatus.inspection_pending) {
        throw new BadRequestException(`Asset không còn ở inspection_pending (hiện: ${currentAsset.status}).`);
      }
      await tx.garmentAsset.update({ where: { id: session.garmentAssetId }, data: { status: finalAssetStatus } });

      if (finalAssetStatus === AssetStatus.laundry) {
        await tx.laundryTicket.create({
          data: { garmentAssetId: session.garmentAssetId, bookingId: session.bookingId, status: MaintenanceStatus.open, note: `[Manager duyệt] ${dto.note}` },
        });
      }
      if (finalAssetStatus === AssetStatus.maintenance) {
        await tx.maintenanceJob.create({
          data: { garmentAssetId: session.garmentAssetId, status: MaintenanceStatus.open, note: `[Manager duyệt] ${dto.note}` },
        });
      }

      // 5. Ghi penalty record + financial transaction
      if (approvedPenalty > 0) {
        const managerFindings = await tx.inspectionFinding.findMany({
          where: { inspectionSessionId: id, findingType: { startsWith: "[Quản lý" } },
        });
        const findingsList = managerFindings
          .map((f) => `${this.cleanFindingTypeName(f.findingType)} (-${Number(f.penaltyAmount).toLocaleString("vi-VN")}đ)`)
          .join(", ");
        const penaltyReason = `[Manager đã duyệt] ${dto.note} | Chi tiết: ${findingsList || `Phạt ${approvedPenalty.toLocaleString("vi-VN")}đ`}`;

        const createdPenalty = await tx.penalty.create({
          data: { bookingId: session.bookingId, reason: penaltyReason, amount: approvedPenalty, createdBy: managerId },
        });
        await tx.financialTransaction.create({
          data: { bookingId: session.bookingId, penaltyId: createdPenalty.id, transactionType: "penalty", amount: approvedPenalty, note: penaltyReason },
        });
      }

      // 6. Cập nhật booking.penaltyTotal
      const bookingAfterPenalty = await tx.booking.update({
        where: { id: session.bookingId },
        data: { penaltyTotal: { increment: approvedPenalty } },
        select: { id: true, status: true, depositTotal: true, penaltyTotal: true },
      });

      // Ghi khoản đền bù nếu tổng phạt toàn đơn vượt cọc
      const totalDeposit = Number(bookingAfterPenalty.depositTotal);
      const totalPenaltyOverall = Number(bookingAfterPenalty.penaltyTotal);
      const excessAmount = totalPenaltyOverall > totalDeposit ? totalPenaltyOverall - totalDeposit : 0;
      if (excessAmount > 0) {
        const existingDebtTx = await tx.financialTransaction.findFirst({
          where: { bookingId: session.bookingId, transactionType: "debt_collect_pending" },
        });
        const debtNote = `Đền bù vượt cọc (Manager đã duyệt): Tổng phạt ${totalPenaltyOverall.toLocaleString("vi-VN")}đ — Cọc ${totalDeposit.toLocaleString("vi-VN")}đ — Cần thu thêm ${excessAmount.toLocaleString("vi-VN")}đ.`;
        if (existingDebtTx) {
          await tx.financialTransaction.update({ where: { id: existingDebtTx.id }, data: { amount: excessAmount, note: debtNote } });
        } else {
          await tx.financialTransaction.create({ data: { bookingId: session.bookingId, transactionType: "debt_collect_pending", amount: excessAmount, note: debtNote } });
        }
      } else {
        // Nếu tổng phạt không vượt cọc, xóa debt_collect_pending cũ nếu có
        await tx.financialTransaction.deleteMany({
          where: { bookingId: session.bookingId, transactionType: "debt_collect_pending" },
        });
      }

      // 7. Finalize booking nếu tất cả sessions đã xong
      if (await this.isBookingFullyInspected(tx, session.bookingId)) {
        await this.finalizeBookingInspection(tx, {
          bookingId: session.bookingId,
          bookingStatus: bookingAfterPenalty.status,
          depositTotal: Number(bookingAfterPenalty.depositTotal),
          penaltyTotal: Number(bookingAfterPenalty.penaltyTotal),
          staffId: managerId,
        });
      }

      return id;
    });

    const updated = await this.prisma.inspectionSession.findUniqueOrThrow({
      where: { id },
      include: this.sessionInclude(),
    });

    this.realtime.inspectionChanged({ id: updated.id, bookingId: updated.bookingId, status: updated.status });
    this.realtime.assetChanged({ id: updated.garmentAssetId, assetId: updated.garmentAssetId, status: updated.garmentAsset.status });
    this.realtime.bookingChanged({ id: updated.bookingId, bookingId: updated.bookingId, status: updated.booking.status });
    this.realtime.bookingChangedForCustomer(updated.booking.customerId, { id: updated.bookingId, bookingId: updated.bookingId, status: updated.booking.status });
    this.realtime.refundChanged({ bookingId: updated.bookingId });

    return ok(this.serialize(updated));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Manager: Từ chối phạt — xóa toàn bộ findings penalty, complete không phạt
  // ─────────────────────────────────────────────────────────────────────────

  async managerReject(id: string, dto: ManagerRejectDto, managerId: string) {
    await this.prisma.runSerializable(async (tx) => {
      const session = await tx.inspectionSession.findUnique({
        where: { id },
        include: { booking: { include: { items: true } }, garmentAsset: true, findings: true },
      });
      if (!session) throw new NotFoundException("Inspection session not found.");
      if (session.status !== InspectionStatus.pending_manager_approval) {
        throw new BadRequestException(`Phiên này không ở trạng thái chờ duyệt (hiện: ${session.status}).`);
      }

      const noteMatch = session.note?.match(/\[PENDING_APPROVAL\|finalAssetStatus=(\w+)\]/);
      const finalAssetStatus = (noteMatch?.[1] ?? "laundry") as AssetStatus;
      const cleanNote = session.note?.replace(/\[PENDING_APPROVAL\|finalAssetStatus=\w+\]\s*/, "").trim() || null;

      // Giữ nguyên mức đề xuất ban đầu và mô tả chi tiết của Staff, gắn nhãn [Staff thẩm định]
      for (const finding of session.findings) {
        const cleanType = this.cleanFindingTypeName(finding.findingType);
        await tx.inspectionFinding.update({
          where: { id: finding.id },
          data: {
            findingType: `[Staff thẩm định] ${cleanType}`,
          },
        });
      }

      // Lưu THÊM ghi nhận từ chối phạt của Manager (0đ)
      await tx.inspectionFinding.create({
        data: {
          inspectionSessionId: id,
          findingType: `[Quản lý từ chối phạt] Không áp dụng phạt`,
          severity: "low",
          description: dto.reason || `Quản lý từ chối phạt. Toàn bộ tiền cọc được giữ nguyên để hoàn tất/hoàn cọc.`,
          penaltyAmount: 0,
        },
      });

      // Complete session với phạt = 0
      await tx.inspectionSession.update({
        where: { id },
        data: {
          status: InspectionStatus.completed,
          completedAt: new Date(),
          note: `[Từ chối phạt bởi Manager] ${dto.reason}${cleanNote ? ` | Ghi chú staff: ${cleanNote}` : ""}`,
        },
      });

      // Chuyển asset
      const currentAsset = await tx.garmentAsset.findUnique({ where: { id: session.garmentAssetId } });
      if (currentAsset?.status === AssetStatus.inspection_pending) {
        await tx.garmentAsset.update({ where: { id: session.garmentAssetId }, data: { status: finalAssetStatus } });
      }

      if (finalAssetStatus === AssetStatus.laundry) {
        await tx.laundryTicket.create({
          data: { garmentAssetId: session.garmentAssetId, bookingId: session.bookingId, status: MaintenanceStatus.open, note: `[Manager từ chối phạt] ${dto.reason}` },
        });
      }
      if (finalAssetStatus === AssetStatus.maintenance) {
        await tx.maintenanceJob.create({
          data: { garmentAssetId: session.garmentAssetId, status: MaintenanceStatus.open, note: `[Manager từ chối phạt] ${dto.reason}` },
        });
      }

      // Finalize booking nếu tất cả sessions xong (penalty = 0 cho phiên này)
      const bookingCurrent = await tx.booking.findUniqueOrThrow({
        where: { id: session.bookingId },
        select: { id: true, status: true, depositTotal: true, penaltyTotal: true },
      });

      const totalDeposit = Number(bookingCurrent.depositTotal);
      const totalPenaltyOverall = Number(bookingCurrent.penaltyTotal);
      if (totalPenaltyOverall <= totalDeposit) {
        await tx.financialTransaction.deleteMany({
          where: { bookingId: session.bookingId, transactionType: "debt_collect_pending" },
        });
      }

      if (await this.isBookingFullyInspected(tx, session.bookingId)) {
        await this.finalizeBookingInspection(tx, {
          bookingId: session.bookingId,
          bookingStatus: bookingCurrent.status,
          depositTotal: Number(bookingCurrent.depositTotal),
          penaltyTotal: Number(bookingCurrent.penaltyTotal),
          staffId: managerId,
        });
      }

      return id;
    });

    const updated = await this.prisma.inspectionSession.findUniqueOrThrow({
      where: { id },
      include: this.sessionInclude(),
    });

    this.realtime.inspectionChanged({ id: updated.id, bookingId: updated.bookingId, status: updated.status });
    this.realtime.assetChanged({ id: updated.garmentAssetId, assetId: updated.garmentAssetId, status: updated.garmentAsset.status });
    this.realtime.bookingChanged({ id: updated.bookingId, bookingId: updated.bookingId, status: updated.booking.status });
    this.realtime.bookingChangedForCustomer(updated.booking.customerId, { id: updated.bookingId, bookingId: updated.bookingId, status: updated.booking.status });
    this.realtime.refundChanged({ bookingId: updated.bookingId });

    return ok(this.serialize(updated));
  }

  /**
   * Quản lý xem xét và điều chỉnh/ghi đè tiền phạt của biên bản kiểm tra.
   * Đồng bộ lại tổng phạt trên booking, số tiền hoàn cọc (nếu đang chờ duyệt),
   * và khoản đền bù vượt cọc cần thu thêm.
   */
  async overridePenalty(id: string, dto: OverridePenaltyDto, managerId: string) {
    await this.prisma.runSerializable(async (tx) => {
      const session = await tx.inspectionSession.findUnique({
        where: { id },
        include: {
          booking: { include: { items: true } },
          garmentAsset: { include: { garment: true, garment_sizes: true } },
          findings: true,
        },
      });
      if (!session) throw new NotFoundException("Inspection session not found.");

      // 1. Cập nhật các finding cụ thể nếu có
      if (dto.findings && dto.findings.length > 0) {
        for (const f of dto.findings) {
          const matched = session.findings.find((item) => item.id === f.id);
          if (matched) {
            await tx.inspectionFinding.update({
              where: { id: f.id },
              data: {
                penaltyAmount: f.penaltyAmount,
                ...(f.description ? { description: f.description } : {}),
              },
            });
          }
        }
      }

      // 2. Tính lại tiền phạt cho phiên này (có bảo vệ trần không vượt quá giá trị trang phục)
      const purchaseCost = Number(session.garmentAsset?.purchaseCost ?? 0);
      const matchedItem = session.booking?.items?.find((it: any) => it.garmentAssetId === session.garmentAssetId);
      const depositAmount = Number(
        matchedItem?.depositAmount ??
        (session.garmentAsset as any)?.garment_sizes?.deposit_amount ??
        0,
      );
      const dailyPrice = Number(matchedItem?.dailyPrice ?? matchedItem?.basePrice ?? (session.garmentAsset as any)?.garment?.rentalPrice ?? 0);
      const garmentValue =
        purchaseCost > 0
          ? purchaseCost
          : depositAmount > 0
          ? depositAmount
          : dailyPrice > 0
          ? dailyPrice * 4
          : 0;

      let sessionPenalty: number;
      if (dto.totalPenaltyOverride !== undefined) {
        sessionPenalty = dto.totalPenaltyOverride;
      } else {
        const currentFindings = await tx.inspectionFinding.findMany({
          where: { inspectionSessionId: id },
        });
        const rawPenalty = currentFindings.reduce((sum, f) => sum + Number(f.penaltyAmount), 0);
        sessionPenalty = garmentValue > 0 ? Math.min(garmentValue, rawPenalty) : rawPenalty;
      }

      // 3. Tính lại tổng phạt cho toàn bộ booking từ tất cả các session và phụ kiện
      const allSessions = await tx.inspectionSession.findMany({
        where: { bookingId: session.bookingId },
        include: {
          garmentAsset: { include: { garment: true, garment_sizes: true } },
          findings: true,
        },
      });

      let totalGarmentsPenalty = 0;
      for (const s of allSessions) {
        if (s.id === id) {
          totalGarmentsPenalty += sessionPenalty;
        } else {
          const sPurchaseCost = Number(s.garmentAsset?.purchaseCost ?? 0);
          const sMatchedItem = session.booking?.items?.find((it: any) => it.garmentAssetId === s.garmentAssetId);
          const sDeposit = Number(sMatchedItem?.depositAmount ?? (s.garmentAsset as any)?.garment_sizes?.deposit_amount ?? 0);
          const sDaily = Number(sMatchedItem?.dailyPrice ?? (s.garmentAsset as any)?.garment?.rentalPrice ?? 0);
          const sVal = sPurchaseCost > 0 ? sPurchaseCost : sDeposit > 0 ? sDeposit : sDaily > 0 ? sDaily * 4 : 0;
          const sRaw = this.computeEffectiveSessionPenalty(s.findings);
          totalGarmentsPenalty += sVal > 0 ? Math.min(sVal, sRaw) : sRaw;
        }
      }

      const accAgg = await tx.bookingAccessoryItem.aggregate({
        where: { bookingId: session.bookingId },
        _sum: { penaltyAmount: true },
      });
      const totalAccPenalty = Number(accAgg._sum.penaltyAmount ?? 0);
      const newBookingPenaltyTotal = totalGarmentsPenalty + totalAccPenalty;

      // Cập nhật booking.penaltyTotal
      await tx.booking.update({
        where: { id: session.bookingId },
        data: { penaltyTotal: newBookingPenaltyTotal },
      });

      // Ghi nhận financial transaction cho việc quản lý điều chỉnh phạt
      await tx.financialTransaction.create({
        data: {
          bookingId: session.bookingId,
          transactionType: "penalty_adjustment",
          amount: sessionPenalty,
          note: `Quản lý điều chỉnh mức phạt: ${dto.reason.trim()} — Tổng phạt mới của đơn: ${newBookingPenaltyTotal.toLocaleString("vi-VN")}đ`,
        },
      });

      // 4. Đồng bộ hoàn cọc (Refund) nếu có
      const depositTotal = Number(session.booking.depositTotal);
      const newRefundAmount = Math.max(0, depositTotal - newBookingPenaltyTotal);

      const pendingRefund = await tx.refund.findFirst({
        where: { bookingId: session.bookingId, status: { in: [PaymentStatus.pending, PaymentStatus.refunding] } },
      });

      if (pendingRefund) {
        await tx.refund.update({
          where: { id: pendingRefund.id },
          data: {
            amount: newRefundAmount,
            reason: `Cập nhật sau khi Quản lý điều chỉnh phạt (Cọc: ${depositTotal.toLocaleString("vi-VN")}đ - Phạt mới: ${newBookingPenaltyTotal.toLocaleString("vi-VN")}đ ➔ Hoàn: ${newRefundAmount.toLocaleString("vi-VN")}đ)`,
            updated_at: new Date(),
          },
        });

        await tx.financialTransaction.updateMany({
          where: {
            bookingId: session.bookingId,
            refundId: pendingRefund.id,
            transactionType: { in: ["refund_cash_pending", "refund_bank_transfer_pending"] },
          },
          data: {
            amount: newRefundAmount,
            note: `Cập nhật số tiền hoàn sau khi Quản lý điều chỉnh phạt: ${newRefundAmount.toLocaleString("vi-VN")}đ`,
          },
        });
      }

      // 5. Cập nhật khoản nợ phát sinh nếu phạt vượt cọc (debt_collect_pending)
      const newExcessAmount = newBookingPenaltyTotal > depositTotal ? newBookingPenaltyTotal - depositTotal : 0;
      const existingDebtTx = await tx.financialTransaction.findFirst({
        where: { bookingId: session.bookingId, transactionType: "debt_collect_pending" },
      });

      if (newExcessAmount > 0) {
        const debtReason = `Đền bù hư hại vượt tiền cọc: Phí phạt thực tế ${newBookingPenaltyTotal.toLocaleString("vi-VN")}đ — Tiền cọc ${depositTotal.toLocaleString("vi-VN")}đ — Cần thu thêm ${newExcessAmount.toLocaleString("vi-VN")}đ từ khách hàng.`;
        if (existingDebtTx) {
          await tx.financialTransaction.update({
            where: { id: existingDebtTx.id },
            data: { amount: newExcessAmount, note: debtReason },
          });
        } else {
          await tx.financialTransaction.create({
            data: {
              bookingId: session.bookingId,
              transactionType: "debt_collect_pending",
              amount: newExcessAmount,
              note: debtReason,
            },
          });
        }
      } else if (existingDebtTx) {
        await tx.financialTransaction.delete({
          where: { id: existingDebtTx.id },
        });
      }

      return id;
    });

    const refreshed = await this.prisma.inspectionSession.findUniqueOrThrow({
      where: { id },
      include: this.sessionInclude(),
    });

    this.realtime.inspectionChanged({ id, bookingId: refreshed.bookingId });
    this.realtime.bookingChanged({ id: refreshed.bookingId, bookingId: refreshed.bookingId });
    this.realtime.refundChanged({ bookingId: refreshed.bookingId });
    this.realtime.bookingChangedForCustomer(refreshed.booking.customerId, {
      id: refreshed.bookingId,
      bookingId: refreshed.bookingId,
    });

    return ok(this.serialize(refreshed));
  }

  /**
   * Đóng đơn kiểm tra khi mọi thứ đã xong (trang phục + phụ kiện).
   * Dùng khi không còn hành động hoàn tất nào để bấm (vd. phiên trang phục
   * xong trước, phụ kiện xong sau) hoặc để gỡ kẹt đơn tồn hàng chờ.
   * Chạy transaction riêng — gọi SAU khi transaction gọi nó đã commit.
   */
  async tryFinalizeBookingInspection(bookingId: string, staffId: string) {
    const result = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (booking.status !== BookingStatus.returned && booking.status !== BookingStatus.inspection_pending) {
        return { finalized: false as const, status: booking.status, customerId: booking.customerId };
      }
      if (!(await this.isBookingFullyInspected(tx, bookingId))) {
        return { finalized: false as const, status: booking.status, customerId: booking.customerId };
      }
      await this.finalizeBookingInspection(tx, {
        bookingId,
        bookingStatus: booking.status,
        depositTotal: Number(booking.depositTotal),
        penaltyTotal: Number(booking.penaltyTotal),
        staffId,
      });
      const done = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
      return { finalized: true as const, status: done.status, customerId: done.customerId };
    });

    if (result.finalized) {
      this.realtime.bookingChanged({ id: bookingId, bookingId, status: result.status });
      this.realtime.bookingChangedForCustomer(result.customerId, { id: bookingId, bookingId, status: result.status });
    }
    return ok(result);
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
      // Giặt/sửa xong là sẵn sàng cho thuê lại ngay: về available thẳng thay vì
      // dừng ở cleaned (cleaned không được tính vào tồn kho khả dụng).
      const claimed = await tx.garmentAsset.updateMany({
        where: { id: assetId, status: asset.status },
        data: { status: AssetStatus.available, conditionNote: null },
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
        findings: { select: { id: true, penaltyAmount: true, findingType: true } },
        photos: { select: { id: true } },
        booking: { select: { id: true, depositTotal: true, penaltyTotal: true } },
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
        photosCount: s.photos.length,
        hasAi: Boolean(s.aiComparisonResult),
        totalPenalty: this.computeEffectiveSessionPenalty(s.findings),
        createdAt: s.createdAt.toISOString(),
        completedAt: s.completedAt?.toISOString() ?? null,
      })),
    );
  }

  // ── Accessory inspection log ───────────────────────────────────────────

  /**
   * Nhật ký kiểm tra phụ kiện (ghi nhận lúc trả đồ): mỗi dòng đã có kết quả
   * là 1 entry — ai kiểm tra, kết quả, ghi chú, phạt, đơn nào.
   */
  async findAccessoryLog() {
    const rows = await this.prisma.bookingAccessoryItem.findMany({
      where: { conditionStatus: { not: null } },
      orderBy: { inspectedAt: "desc" },
      take: 200,
      include: {
        accessory: { select: { name: true } },
        accessoryAsset: { select: { asset_code: true } },
        booking: { select: { id: true } },
      },
    });
    const inspectorIds = [...new Set(rows.map((r) => r.inspectedBy).filter((v): v is string => Boolean(v)))];
    const inspectors = inspectorIds.length > 0
      ? await this.prisma.userAccount.findMany({
        where: { id: { in: inspectorIds } },
        select: { id: true, email: true, profile: { select: { fullName: true } } },
      })
      : [];
    const inspectorById = new Map(inspectors.map((u) => [u.id, u]));

    return ok(
      rows.map((r) => {
        const inspector = r.inspectedBy ? inspectorById.get(r.inspectedBy) ?? null : null;
        return {
          id: r.id,
          bookingId: r.bookingId,
          assetCode: r.accessoryAsset?.asset_code ?? null,
          accessoryName: r.accessory.name,
          quantity: r.quantity,
          conditionStatus: r.conditionStatus,
          conditionNote: r.conditionNote,
          penaltyAmount: Number(r.penaltyAmount ?? 0),
          inspectorName: inspector?.profile?.fullName ?? inspector?.email ?? null,
          inspectedAt: r.inspectedAt?.toISOString() ?? null,
          imageUrls: r.conditionImages ?? [],
        };
      }),
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

    const updated = await this.prisma.runSerializable(async (tx) => {
      // Re-read bên trong transaction để tránh race condition
      const freshTicket = await tx.laundryTicket.findUnique({ where: { id: ticketId } });
      if (!freshTicket) throw new NotFoundException("Laundry ticket not found.");
      if (freshTicket.status === "completed") {
        throw new BadRequestException("Laundry ticket already completed.");
      }

      // Kiểm tra asset vẫn đang ở trạng thái laundry
      const asset = await tx.garmentAsset.findUnique({ where: { id: freshTicket.garmentAssetId } });
      if (!asset) throw new NotFoundException("Garment asset not found.");
      if (asset.status !== AssetStatus.laundry) {
        throw new BadRequestException(
          `Trang phục không còn ở trạng thái giặt sấy (hiện tại: ${asset.status}). Vui lòng kiểm tra lại.`,
        );
      }

      const done = await tx.laundryTicket.update({
        where: { id: ticketId },
        data: {
          status: "completed",
          completedAt: new Date(),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });

      await tx.garmentAsset.update({
        where: { id: freshTicket.garmentAssetId },
        data: { status: AssetStatus.available, conditionNote: null },
      });

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
      status: AssetStatus.available,
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
        ? AssetStatus.available
        : AssetStatus.damaged;
      const claimedAsset = await tx.garmentAsset.updateMany({
        where: { id: job.garmentAssetId, status: AssetStatus.maintenance },
        data: {
          status: nextAssetStatus,
          ...(nextAssetStatus === AssetStatus.available ? { conditionNote: null } : {}),
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
      status: targetStatus === MaintenanceStatus.completed ? AssetStatus.available : AssetStatus.damaged,
    });

    return ok({
      id: updated.id,
      garmentAssetId: updated.garmentAssetId,
      status: updated.status,
      note: updated.note,
      completedAt: updated.completedAt?.toISOString() ?? null,
    });
  }

  private cleanFindingTypeName(findingType: string): string {
    return findingType.replace(/^\[(Staff thẩm định|Staff đề xuất|Quản lý phê duyệt|Quản lý từ chối phạt)\]\s*/i, "").trim();
  }

  private computeEffectiveSessionPenalty(findings: Array<{ findingType: string; penaltyAmount: any }>): number {
    const managerFindings = findings.filter((f) => f.findingType.startsWith("[Quản lý"));
    if (managerFindings.length > 0) {
      return managerFindings.reduce((sum, f) => sum + Number(f.penaltyAmount), 0);
    }
    const nonStaffProposal = findings.filter((f) => !f.findingType.startsWith("[Staff"));
    return (nonStaffProposal.length > 0 ? nonStaffProposal : findings).reduce((sum, f) => sum + Number(f.penaltyAmount), 0);
  }

  private sessionInclude() {
    return {
      findings: true,
      photos: true,
      booking: {
        include: {
          customer: { include: { profile: true } },
          items: { include: { garment_sizes: { include: { garments: true } }, garmentAsset: true } },
        },
      },
      garmentAsset: {
        include: {
          garment: true,
          garment_sizes: { include: { garments: true } },
        },
      },
      inspector: { include: { profile: true } },
    } satisfies Prisma.InspectionSessionInclude;
  }

  private async isBookingFullyInspected(tx: Prisma.TransactionClient, bookingId: string) {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { items: true },
    });
    if (!booking || booking.items.length === 0) return false;

    // Chỉ xét các item đã được gán garmentAsset — item chưa gán không thể kiểm tra
    const assetIds = booking.items
      .map((item) => item.garmentAssetId)
      .filter((assetId): assetId is string => Boolean(assetId));
    const distinctAssetIds = new Set(assetIds);

    // Phải có ít nhất 1 item đã gán asset
    if (distinctAssetIds.size === 0) return false;

    // Tất cả các asset đã gán phải có session với status completed hoặc pending_manager_approval
    // (pending_manager_approval = đã kiểm xong vật lý, chờ manager duyệt giá phạt)
    const doneSessions = await tx.inspectionSession.findMany({
      where: {
        bookingId,
        status: { in: [InspectionStatus.completed, "pending_manager_approval" as InspectionStatus] },
        garmentAssetId: { in: [...distinctAssetIds] },
      },
      select: { garmentAssetId: true },
    });
    const inspectedAssetIds = new Set(doneSessions.map((session) => session.garmentAssetId));
    if (inspectedAssetIds.size !== distinctAssetIds.size) return false;

    // Phụ kiện: chỉ xét các row đã được gán accessoryAsset — row chưa gán bỏ qua
    const accessoryRows = await tx.bookingAccessoryItem.findMany({
      where: { bookingId, accessoryAssetId: { not: null } },
      select: { accessoryAssetId: true, conditionStatus: true },
    });
    // Nếu không có phụ kiện nào đã gán, không cần kiểm
    if (accessoryRows.length === 0) return true;
    return accessoryRows.every((row) => Boolean(row.conditionStatus));
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

    const refundReason = input.penaltyTotal > 0
      ? `Hoàn cọc sau kiểm tra (Cọc ban đầu: ${input.depositTotal.toLocaleString("vi-VN")}đ - Khấu trừ hư tổn: ${input.penaltyTotal.toLocaleString("vi-VN")}đ ➔ Thực hoàn: ${refundAmount.toLocaleString("vi-VN")}đ)`
      : `Hoàn 100% tiền cọc sau kiểm tra (Không phát sinh hư hại): ${refundAmount.toLocaleString("vi-VN")}đ`;

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
          reason: refundReason,
          processed_by: input.staffId,
        },
      });
      await tx.financialTransaction.create({
        data: {
          bookingId: input.bookingId,
          refundId: createdRefund.id,
          transactionType: refundMethod === "cash" ? "refund_cash_pending" : "refund_bank_transfer_pending",
          amount: refundAmount,
          note: refundReason,
        },
      });
      hasRefundToApprove = true;
    }

    if (refundAmount <= 0 && input.depositTotal > 0 && input.penaltyTotal > 0) {
      const forfeitReason = `Khấu trừ toàn bộ 100% tiền cọc (${input.depositTotal.toLocaleString("vi-VN")}đ) do tiền phạt hư hại (${input.penaltyTotal.toLocaleString("vi-VN")}đ) bằng hoặc vượt tiền cọc.`;
      await tx.financialTransaction.create({
        data: {
          bookingId: input.bookingId,
          transactionType: "deposit_forfeited",
          amount: input.depositTotal,
          note: forfeitReason,
        },
      });
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
            ? `Kiểm tra xong — Đã tạo yêu cầu hoàn cọc: ${refundAmount.toLocaleString("vi-VN")}đ (Khấu trừ phạt: ${input.penaltyTotal.toLocaleString("vi-VN")}đ). Chờ quản lý duyệt.`
            : `Kiểm tra xong toàn bộ đồ. ${input.penaltyTotal > 0 ? `Khấu trừ toàn bộ cọc (${input.depositTotal.toLocaleString("vi-VN")}đ) do hư hại.` : "Hoàn tất đơn hàng."}`,
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

  private extractHandoverImages(raw: any): string[] {
    if (!raw) return [];
    const isUrl = (val: string) => val.startsWith("http://") || val.startsWith("https://") || val.startsWith("/");
    if (Array.isArray(raw)) {
      return raw.filter((x): x is string => typeof x === "string" && isUrl(x));
    }
    if (typeof raw === "object") {
      if (Array.isArray(raw.images)) {
        return raw.images.filter((x: any): x is string => typeof x === "string" && isUrl(x));
      }
    }
    return [];
  }

  private serialize(session: any) {
    const handoverImages = this.extractHandoverImages(session.booking?.conditionImages);
    const garmentName =
      session.garmentAsset?.garment?.name ??
      session.garmentAsset?.garment_sizes?.garments?.name ??
      "Trang phục";
    const customerFullName =
      session.booking?.customer?.profile?.fullName ??
      session.booking?.customer?.email ??
      null;

    return {
      id: session.id,
      bookingId: session.bookingId,
      garmentAssetId: session.garmentAssetId,
      status: session.status,
      note: session.note,
      aiComparisonResult: session.aiComparisonResult ?? null,
      aiComparedAt: session.aiComparedAt ? session.aiComparedAt.toISOString() : null,
      handoverImages,
      conditionBeforeRental: session.booking?.conditionBeforeRental ?? null,
      createdAt: session.createdAt?.toISOString() ?? new Date().toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
      inspector: session.inspector
        ? {
            id: session.inspector.id,
            fullName: session.inspector.profile?.fullName ?? session.inspector.email,
          }
        : null,
      asset: {
        id: session.garmentAsset?.id,
        assetCode: session.garmentAsset?.assetCode,
        status: session.garmentAsset?.status,
        conditionNote: session.garmentAsset?.conditionNote,
        purchaseCost: session.garmentAsset?.purchaseCost ? Number(session.garmentAsset.purchaseCost) : null,
        garment: {
          id: session.garmentAsset?.garment?.id ?? session.garmentAsset?.garment_sizes?.garments?.id,
          name: garmentName,
          sizeLabel: session.garmentAsset?.garment_sizes?.size_label ?? null,
        },
      },
      booking: {
        id: session.booking?.id,
        status: session.booking?.status,
        customerName: customerFullName,
        rentalStartDate: session.booking?.rentalStartDate ? session.booking.rentalStartDate.toISOString().slice(0, 10) : null,
        rentalEndDate: session.booking?.rentalEndDate ? session.booking.rentalEndDate.toISOString().slice(0, 10) : null,
        items: session.booking?.items?.map((item: any) => ({
          id: item.id,
          garmentSizeId: item.garment_size_id,
          garmentId: item.garmentId,
          garmentName: item.garment_sizes?.garments?.name ?? null,
          sizeLabel: item.garment_sizes?.size_label ?? null,
          assetCode: item.garmentAsset?.assetCode ?? null,
        })) ?? [],
      },
      findings: session.findings?.map((f: any) => ({
        id: f.id,
        findingType: f.findingType,
        severity: f.severity,
        description: f.description,
        penaltyAmount: Number(f.penaltyAmount),
        createdAt: f.createdAt?.toISOString() ?? new Date().toISOString(),
      })) ?? [],
      photos: session.photos?.map((p: any) => ({
        id: p.id,
        imageUrl: p.imageUrl,
        photoType: p.photoType ?? "after",
        note: p.note,
        aiAnalysis: p.aiAnalysis ?? null,
        createdAt: p.createdAt?.toISOString() ?? new Date().toISOString(),
      })) ?? [],
    };
  }
}
