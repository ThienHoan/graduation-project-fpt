# Loyalty Points System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Xây dựng hệ thống tích điểm & hạng thành viên (Đồng/Bạc/Vàng) tích hợp với vouchers module sẵn có, tự động tích điểm khi booking hoàn thành và cho phép đổi điểm lấy voucher giảm giá.

**Architecture:**
- **Database layer**: 3 bảng mới (`loyalty_points`, `loyalty_tiers`, `loyalty_redemptions`) + cột `loyalty_tier` trên `user_accounts` qua Supabase migration.
- **Backend layer**: NestJS module `loyalty` độc lập, hook vào `refunds.service.ts` (nơi booking → `completed`) để award points. Đổi điểm → tạo voucher 1-time qua `VouchersService.create()`.
- **Frontend layer**: Tab "Điểm thưởng" trong Customer Dashboard (`/dashboard/customer`).

**Tech Stack:** NestJS 10, Prisma ORM, PostgreSQL (Supabase), Next.js 15 App Router, TypeScript, Tailwind CSS.

---

## Task 1: Supabase Migration — Tạo Schema Loyalty

**Files:**
- Create: `supabase/migrations/020_loyalty_points.sql`

**Step 1: Viết migration SQL**

```sql
-- supabase/migrations/020_loyalty_points.sql
-- ============================================================================
-- Loyalty Points & Member Tiers
-- ============================================================================

-- Enum hạng thành viên
DO $$ BEGIN
  CREATE TYPE "loyalty_tier" AS ENUM ('bronze', 'silver', 'gold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Thêm cột tier + tổng điểm vào user_accounts
ALTER TABLE "user_accounts"
  ADD COLUMN IF NOT EXISTS "loyalty_tier"      "loyalty_tier" NOT NULL DEFAULT 'bronze',
  ADD COLUMN IF NOT EXISTS "loyalty_points"    INTEGER NOT NULL DEFAULT 0 CHECK ("loyalty_points" >= 0),
  ADD COLUMN IF NOT EXISTS "loyalty_points_lifetime" INTEGER NOT NULL DEFAULT 0 CHECK ("loyalty_points_lifetime" >= 0);

-- Bảng lịch sử điểm (immutable ledger)
CREATE TABLE IF NOT EXISTS "loyalty_point_logs" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id"   UUID NOT NULL REFERENCES "user_accounts"("id") ON DELETE CASCADE,
  "booking_id"    UUID REFERENCES "bookings"("id") ON DELETE SET NULL,
  "delta"         INTEGER NOT NULL,                -- dương: tích, âm: đổi
  "reason"        TEXT NOT NULL,                   -- e.g. 'earn_rental', 'redeem_voucher'
  "meta"          JSONB NOT NULL DEFAULT '{}',     -- { voucherId?, bookingCode? }
  "balance_after" INTEGER NOT NULL CHECK ("balance_after" >= 0),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "loyalty_point_logs_customer_id_idx"
  ON "loyalty_point_logs" ("customer_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "loyalty_point_logs_booking_id_idx"
  ON "loyalty_point_logs" ("booking_id");

-- Bảng quy tắc đổi điểm (admin có thể cấu hình)
CREATE TABLE IF NOT EXISTS "loyalty_redemption_rules" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "points_required"    INTEGER NOT NULL CHECK ("points_required" > 0),
  "voucher_name"       TEXT NOT NULL,
  "discount_type"      "voucher_discount_type" NOT NULL,   -- reuse enum từ migration 010
  "discount_value"     DECIMAL(12,2) NOT NULL,
  "max_discount_amount" DECIMAL(12,2),
  "min_order_value"    DECIMAL(12,2) NOT NULL DEFAULT 0,
  "voucher_validity_days" INTEGER NOT NULL DEFAULT 30,
  "is_active"          BOOLEAN NOT NULL DEFAULT true,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Seed: 3 rule mẫu
INSERT INTO "loyalty_redemption_rules"
  ("points_required","voucher_name","discount_type","discount_value","max_discount_amount","min_order_value","voucher_validity_days")
VALUES
  (500,  'Giảm 50.000đ (đổi 500 điểm)',  'fixed',      50000,  NULL,   100000, 30),
  (1000, 'Giảm 120.000đ (đổi 1000 điểm)','fixed',      120000, NULL,   200000, 45),
  (200,  'Giảm 5% (đổi 200 điểm)',        'percentage', 5,      50000,  0,      30)
ON CONFLICT DO NOTHING;

-- Index: tìm nhanh tier của customer
CREATE INDEX IF NOT EXISTS "user_accounts_loyalty_tier_idx"
  ON "user_accounts" ("loyalty_tier");
```

**Step 2: Kiểm tra file tồn tại**

```bash
ls supabase/migrations/020_loyalty_points.sql
```

Expected: file hiện ra.

**Step 3: Commit**

```bash
git add supabase/migrations/020_loyalty_points.sql
git commit -m "feat(db): add loyalty_point_logs, loyalty_redemption_rules schema + user_accounts tier columns"
```

---

## Task 2: Prisma Schema — Sync Models

**Files:**
- Modify: `backend/prisma/schema.prisma` — thêm models & update `user_accounts`

**Step 1: Tìm model `user_accounts` trong schema**

```bash
grep -n "model user_accounts\|loyalty" backend/prisma/schema.prisma | head -20
```

**Step 2: Thêm fields vào model `user_accounts`**

Tìm block `model user_accounts` và thêm vào cuối (trước dấu `}`):

```prisma
  loyalty_tier             loyalty_tier              @default(bronze)
  loyalty_points           Int                       @default(0)
  loyalty_points_lifetime  Int                       @default(0)
  point_logs               loyalty_point_logs[]
```

**Step 3: Thêm model mới sau model `voucher_usages`**

```prisma
enum loyalty_tier {
  bronze
  silver
  gold
}

model loyalty_point_logs {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  customer_id   String    @db.Uuid
  booking_id    String?   @db.Uuid
  delta         Int
  reason        String
  meta          Json      @default("{}")
  balance_after Int
  created_at    DateTime  @default(now()) @db.Timestamptz(6)

  customer      user_accounts @relation(fields: [customer_id], references: [id], onDelete: Cascade)
  booking       booking?      @relation(fields: [booking_id], references: [id], onDelete: SetNull)

  @@index([customer_id, created_at(sort: Desc)])
  @@index([booking_id])
}

model loyalty_redemption_rules {
  id                   String                  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  points_required      Int
  voucher_name         String
  discount_type        voucher_discount_type
  discount_value       Decimal                 @db.Decimal(12, 2)
  max_discount_amount  Decimal?                @db.Decimal(12, 2)
  min_order_value      Decimal                 @default(0) @db.Decimal(12, 2)
  voucher_validity_days Int                   @default(30)
  is_active            Boolean                 @default(true)
  created_at           DateTime                @default(now()) @db.Timestamptz(6)
  updated_at           DateTime                @default(now()) @db.Timestamptz(6)
}
```

**Step 4: Thêm backref vào model `booking`** — tìm model `booking` và thêm:

```prisma
  point_logs  loyalty_point_logs[]
```

**Step 5: Regenerate Prisma client**

```bash
cd backend && npx prisma generate
```

Expected: `✔ Generated Prisma Client` — không có error.

**Step 6: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(prisma): add loyalty_point_logs, loyalty_redemption_rules models + user_accounts tier fields"
```

---

## Task 3: Backend — LoyaltyService (Core Logic)

**Files:**
- Create: `backend/src/modules/loyalty/loyalty.service.ts`
- Create: `backend/src/modules/loyalty/loyalty.module.ts`
- Create: `backend/src/modules/loyalty/dto/redeem.dto.ts`

### 3A — Constants & Business Rules

**Step 1: Tạo file service**

```typescript
// backend/src/modules/loyalty/loyalty.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { VouchersService } from "../vouchers/vouchers.service";

/** 1.000đ thanh toán thực = 1 điểm */
const POINTS_PER_VND = 1 / 1000;

/** Ngưỡng tier (điểm TÍCH LŨY TOÀN THỜI GIAN) */
const TIER_THRESHOLDS = {
  bronze: 0,
  silver: 2000,   // 2.000 điểm lifetime ≈ chi 2.000.000đ
  gold:   6000,   // 6.000 điểm lifetime ≈ chi 6.000.000đ
} as const;

function calcTier(lifetimePoints: number): "bronze" | "silver" | "gold" {
  if (lifetimePoints >= TIER_THRESHOLDS.gold)   return "gold";
  if (lifetimePoints >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vouchers: VouchersService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Tích điểm sau khi booking hoàn thành (gọi từ refunds.service.ts)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Tích điểm cho customer khi booking chuyển sang completed.
   * Tính điểm trên rental_total (sau khi trừ voucher).
   * Gọi TRONG transaction của refunds.service.
   */
  async awardPointsForBooking(
    tx: Prisma.TransactionClient,
    bookingId: string,
    customerId: string,
    rentalTotal: number, // số tiền thực tế khách trả (rental_total - discount_total)
  ): Promise<void> {
    const delta = Math.floor(rentalTotal * POINTS_PER_VND);
    if (delta <= 0) return; // đơn quá nhỏ → không tích điểm

    // Cộng điểm atomic — dùng $executeRaw để tránh race condition
    await tx.$executeRaw`
      UPDATE "user_accounts"
      SET
        "loyalty_points"          = "loyalty_points" + ${delta},
        "loyalty_points_lifetime" = "loyalty_points_lifetime" + ${delta},
        "loyalty_tier"            = CASE
          WHEN "loyalty_points_lifetime" + ${delta} >= ${TIER_THRESHOLDS.gold}   THEN 'gold'::loyalty_tier
          WHEN "loyalty_points_lifetime" + ${delta} >= ${TIER_THRESHOLDS.silver} THEN 'silver'::loyalty_tier
          ELSE 'bronze'::loyalty_tier
        END,
        "updated_at"              = now()
      WHERE "id" = ${customerId}::uuid
    `;

    // Lấy balance sau khi update để lưu vào log
    const user = await tx.user_accounts.findUnique({
      where: { id: customerId },
      select: { loyalty_points: true },
    });

    await tx.loyalty_point_logs.create({
      data: {
        customer_id:   customerId,
        booking_id:    bookingId,
        delta,
        reason:        "earn_rental",
        meta:          { rentalTotal, pointsPerVnd: POINTS_PER_VND },
        balance_after: user?.loyalty_points ?? delta,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Đổi điểm → Voucher
  // ─────────────────────────────────────────────────────────────────────────

  async redeemPoints(customerId: string, ruleId: string) {
    const rule = await this.prisma.loyalty_redemption_rules.findUnique({ where: { id: ruleId } });
    if (!rule || !rule.is_active) throw new BadRequestException("Quy tắc đổi điểm không tồn tại hoặc đã tắt.");

    const result = await this.prisma.runSerializable(async (tx) => {
      // Kiểm tra & trừ điểm atomic
      const updated = await tx.$executeRaw`
        UPDATE "user_accounts"
        SET
          "loyalty_points" = "loyalty_points" - ${rule.points_required},
          "updated_at"     = now()
        WHERE "id" = ${customerId}::uuid
          AND "loyalty_points" >= ${rule.points_required}
      `;
      if (updated === 0) throw new BadRequestException("Không đủ điểm để đổi.");

      const user = await tx.user_accounts.findUnique({
        where:  { id: customerId },
        select: { loyalty_points: true },
      });

      // Tạo voucher 1-time cá nhân
      const expiresAt = new Date(Date.now() + rule.voucher_validity_days * 24 * 60 * 60 * 1000);
      const code = `LYL-${customerId.slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

      const voucher = await tx.vouchers.create({
        data: {
          code,
          name:                rule.voucher_name,
          description:         `Đổi ${rule.points_required} điểm tích lũy`,
          discount_type:       rule.discount_type,
          discount_value:      rule.discount_value,
          max_discount_amount: rule.max_discount_amount,
          min_order_value:     rule.min_order_value,
          usage_limit:         1,
          per_user_limit:      1,
          start_at:            new Date(),
          end_at:              expiresAt,
          category_ids:        [],
          garment_ids:         [],
          is_active:           true,
        },
      });

      // Ghi log
      await tx.loyalty_point_logs.create({
        data: {
          customer_id:   customerId,
          delta:         -rule.points_required,
          reason:        "redeem_voucher",
          meta:          { ruleId, voucherId: voucher.id, voucherCode: code },
          balance_after: user?.loyalty_points ?? 0,
        },
      });

      return { voucher, balanceAfter: user?.loyalty_points ?? 0 };
    });

    return ok({
      voucherCode:  result.voucher.code,
      voucherName:  result.voucher.name,
      discountType: result.voucher.discount_type,
      discountValue: Number(result.voucher.discount_value),
      expiresAt:    result.voucher.end_at,
      balanceAfter: result.balanceAfter,
    }, "Đổi điểm thành công! Mã voucher đã được tạo.");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Query APIs
  // ─────────────────────────────────────────────────────────────────────────

  async getMyLoyalty(customerId: string) {
    const user = await this.prisma.user_accounts.findUnique({
      where:  { id: customerId },
      select: { loyalty_points: true, loyalty_points_lifetime: true, loyalty_tier: true },
    });
    if (!user) throw new BadRequestException("Không tìm thấy tài khoản.");

    const nextTier = this.nextTierInfo(user.loyalty_points_lifetime);

    return ok({
      points:          user.loyalty_points,
      lifetimePoints:  user.loyalty_points_lifetime,
      tier:            user.loyalty_tier,
      nextTier,
      tierBenefits:    TIER_BENEFITS[user.loyalty_tier],
    });
  }

  async getMyHistory(customerId: string, cursor?: string) {
    const logs = await this.prisma.loyalty_point_logs.findMany({
      where:   { customer_id: customerId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { created_at: "desc" },
      take:    20,
    });
    return ok(logs.map((l) => ({
      id:           l.id,
      delta:        l.delta,
      reason:       l.reason,
      meta:         l.meta,
      balanceAfter: l.balance_after,
      createdAt:    l.created_at,
    })));
  }

  async listRedemptionRules() {
    const rules = await this.prisma.loyalty_redemption_rules.findMany({
      where:   { is_active: true },
      orderBy: { points_required: "asc" },
    });
    return ok(rules.map((r) => ({
      id:                  r.id,
      pointsRequired:      r.points_required,
      voucherName:         r.voucher_name,
      discountType:        r.discount_type,
      discountValue:       Number(r.discount_value),
      maxDiscountAmount:   r.max_discount_amount ? Number(r.max_discount_amount) : null,
      minOrderValue:       Number(r.min_order_value),
      voucherValidityDays: r.voucher_validity_days,
    })));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: cập nhật rules
  // ─────────────────────────────────────────────────────────────────────────

  async listAllRules() {
    const rules = await this.prisma.loyalty_redemption_rules.findMany({ orderBy: { points_required: "asc" } });
    return ok(rules);
  }

  async updateRule(ruleId: string, data: { isActive?: boolean; pointsRequired?: number; voucherValidityDays?: number }) {
    const updated = await this.prisma.loyalty_redemption_rules.update({
      where: { id: ruleId },
      data: {
        ...(data.isActive !== undefined        ? { is_active: data.isActive }               : {}),
        ...(data.pointsRequired !== undefined  ? { points_required: data.pointsRequired }   : {}),
        ...(data.voucherValidityDays !== undefined ? { voucher_validity_days: data.voucherValidityDays } : {}),
        updated_at: new Date(),
      },
    });
    return ok(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private nextTierInfo(lifetimePoints: number) {
    if (lifetimePoints >= TIER_THRESHOLDS.gold) return null; // đã là vàng
    const target = lifetimePoints >= TIER_THRESHOLDS.silver ? TIER_THRESHOLDS.gold : TIER_THRESHOLDS.silver;
    const name   = lifetimePoints >= TIER_THRESHOLDS.silver ? "gold" : "silver";
    return { tier: name, pointsNeeded: target - lifetimePoints, targetPoints: target };
  }
}

const TIER_BENEFITS: Record<"bronze" | "silver" | "gold", string[]> = {
  bronze: ["Tích 1 điểm / 1.000đ thuê", "Đổi điểm lấy voucher giảm giá"],
  silver: ["Tích 1 điểm / 1.000đ thuê", "Đổi điểm lấy voucher giảm giá", "Ưu tiên đặt size hot", "Giảm 5% tiền cọc"],
  gold:   ["Tích 1 điểm / 1.000đ thuê", "Đổi điểm lấy voucher giảm giá", "Ưu tiên đặt size hot", "Miễn cọc phụ kiện (≤ 200k)", "Giảm 10% tiền cọc"],
};
```

**Step 2: Tạo DTO**

```typescript
// backend/src/modules/loyalty/dto/redeem.dto.ts
import { IsUUID } from "class-validator";

export class RedeemPointsDto {
  @IsUUID()
  ruleId: string;
}
```

**Step 3: Tạo module**

```typescript
// backend/src/modules/loyalty/loyalty.module.ts
import { Module } from "@nestjs/common";
import { LoyaltyService } from "./loyalty.service";
import { LoyaltyController } from "./loyalty.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { VouchersModule } from "../vouchers/vouchers.module";

@Module({
  imports:   [PrismaModule, VouchersModule],
  providers: [LoyaltyService],
  controllers: [LoyaltyController],
  exports:   [LoyaltyService],   // ← export để refunds.service inject
})
export class LoyaltyModule {}
```

**Step 4: Commit**

```bash
git add backend/src/modules/loyalty/
git commit -m "feat(loyalty): add LoyaltyService core — earn points, redeem voucher, query APIs"
```

---

## Task 4: Backend — LoyaltyController (REST API)

**Files:**
- Create: `backend/src/modules/loyalty/loyalty.controller.ts`

**Step 1: Tạo controller**

```typescript
// backend/src/modules/loyalty/loyalty.controller.ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser }   from "../auth/decorators/current-user.decorator";
import { Roles }         from "../auth/decorators/roles.decorator";
import { JwtAuthGuard }  from "../auth/guards/jwt-auth.guard";
import { RolesGuard }    from "../auth/guards/roles.guard";
import type { AuthenticatedUser } from "../auth/auth-user";
import { LoyaltyService } from "./loyalty.service";
import { RedeemPointsDto } from "./dto/redeem.dto";

@Controller("loyalty")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  // ── Customer endpoints ──────────────────────────────────────────────────

  /** GET /loyalty/me — số điểm, tier, lợi ích */
  @Get("me")
  getMyLoyalty(@CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.getMyLoyalty(user.id);
  }

  /** GET /loyalty/me/history — lịch sử giao dịch điểm */
  @Get("me/history")
  getMyHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query("cursor") cursor?: string,
  ) {
    return this.loyalty.getMyHistory(user.id, cursor);
  }

  /** GET /loyalty/rules — danh sách rule đổi điểm (chỉ active) */
  @Get("rules")
  listRules() {
    return this.loyalty.listRedemptionRules();
  }

  /** POST /loyalty/redeem — đổi điểm lấy voucher */
  @Post("redeem")
  @Roles("customer")
  redeem(@CurrentUser() user: AuthenticatedUser, @Body() dto: RedeemPointsDto) {
    return this.loyalty.redeemPoints(user.id, dto.ruleId);
  }

  // ── Manager/Admin endpoints ─────────────────────────────────────────────

  /** GET /loyalty/admin/rules — tất cả rules (kể cả inactive) */
  @Get("admin/rules")
  @Roles("manager_owner", "admin")
  listAllRules() {
    return this.loyalty.listAllRules();
  }

  /** PATCH /loyalty/admin/rules/:id — bật/tắt rule */
  @Patch("admin/rules/:id")
  @Roles("manager_owner", "admin")
  updateRule(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { isActive?: boolean; pointsRequired?: number; voucherValidityDays?: number },
  ) {
    return this.loyalty.updateRule(id, body);
  }
}
```

**Step 2: Đăng ký LoyaltyModule vào AppModule**

Mở `backend/src/app.module.ts`, thêm:

```typescript
import { LoyaltyModule } from "./modules/loyalty/loyalty.module";
// ... trong imports array:
LoyaltyModule,
```

**Step 3: Build check**

```bash
cd backend && npx tsc --noEmit
```

Expected: không có error.

**Step 4: Commit**

```bash
git add backend/src/modules/loyalty/loyalty.controller.ts backend/src/app.module.ts
git commit -m "feat(loyalty): add LoyaltyController + register LoyaltyModule in AppModule"
```

---

## Task 5: Hook vào Booking Completion — Tích Điểm Tự Động

**Files:**
- Modify: `backend/src/modules/refunds/refunds.service.ts` — inject LoyaltyService, gọi `awardPointsForBooking` tại 3 nơi booking → `completed`

**Step 1: Tìm tất cả các nơi chuyển sang `completed`**

```bash
grep -n "status: BookingStatus.completed\|toStatus: BookingStatus.completed" backend/src/modules/refunds/refunds.service.ts
```

Expected: khoảng 4–5 dòng (line ~171, ~179, ~196, ~201, ~338, ~345, ~389, ~405).

**Step 2: Thêm import và inject LoyaltyService vào RefundsService**

Mở `backend/src/modules/refunds/refunds.service.ts`, tìm phần constructor và thêm:

```typescript
// Thêm vào top imports:
import { LoyaltyService } from "../loyalty/loyalty.service";

// Trong constructor:
private readonly loyaltyService: LoyaltyService,
```

**Step 3: Thêm import LoyaltyModule vào RefundsModule**

Mở `backend/src/modules/refunds/refunds.module.ts`:

```typescript
import { LoyaltyModule } from "../loyalty/loyalty.module";
// trong imports array:
LoyaltyModule,
```

**Step 4: Hook tích điểm vào hàm `closeNoRefund` (booking.penalty >= deposit)**

Tìm đoạn (khoảng line 170–181):
```typescript
const claimed = await tx.booking.updateMany({
  where: { id: bookingId, status: BookingStatus.refund_pending },
  data:  { status: BookingStatus.completed },
});
```

Thêm SAU khi `claimed.count === 1` được xác nhận:
```typescript
// Tích điểm — lấy rental_total từ booking đã load ở trên
const earnableTotal = Number(booking.rentalTotal) - Number(booking.discountTotal ?? 0);
void this.loyaltyService.awardPointsForBooking(tx, bookingId, booking.customerId, earnableTotal).catch(() => {});
```

**Step 5: Hook tích điểm vào `approveRefund` (booking có hoàn cọc → completed)**

Tìm đoạn (khoảng line 337–345):
```typescript
await tx.booking.updateMany({
  where: { id: refund.bookingId, status: BookingStatus.refund_pending },
  data:  { status: BookingStatus.completed },
});
```

Thêm tương tự:
```typescript
const earnableTotal = Number(refund.booking.rentalTotal) - Number(refund.booking.discountTotal ?? 0);
void this.loyaltyService.awardPointsForBooking(tx, refund.bookingId, refund.booking.customerId, earnableTotal).catch(() => {});
```

**Step 6: Hook tích điểm vào `completeNoDeposit` (booking không có cọc)**

Tìm đoạn nơi `status: BookingStatus.completed` được set mà không qua `refund_pending` (khoảng line 389–405):
```typescript
// Thêm sau khi booking được update thành completed:
void this.loyaltyService.awardPointsForBooking(tx, bookingId, booking.customerId, earnableTotal).catch(() => {});
```

**Step 7: Build check**

```bash
cd backend && npx tsc --noEmit
```

Expected: không có error.

**Step 8: Commit**

```bash
git add backend/src/modules/refunds/refunds.service.ts backend/src/modules/refunds/refunds.module.ts
git commit -m "feat(loyalty): hook awardPointsForBooking into booking completion flow (refunds.service)"
```

---

## Task 6: Unit Test — LoyaltyService

**Files:**
- Create: `backend/src/modules/loyalty/loyalty.service.spec.ts`

**Step 1: Viết test**

```typescript
// backend/src/modules/loyalty/loyalty.service.spec.ts
import { Test } from "@nestjs/testing";
import { LoyaltyService } from "./loyalty.service";
import { PrismaService } from "../../prisma/prisma.service";
import { VouchersService } from "../vouchers/vouchers.service";
import { BadRequestException } from "@nestjs/common";

describe("LoyaltyService", () => {
  let service: LoyaltyService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LoyaltyService,
        {
          provide:  PrismaService,
          useValue: {
            user_accounts: {
              findUnique: jest.fn(),
            },
            loyalty_redemption_rules: {
              findUnique: jest.fn(),
              findMany:   jest.fn(),
            },
            loyalty_point_logs: {
              findMany: jest.fn(),
            },
            runSerializable: jest.fn(),
          },
        },
        {
          provide:  VouchersService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get(LoyaltyService);
    prisma  = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  describe("getMyLoyalty", () => {
    it("returns tier, points and next tier info", async () => {
      (prisma.user_accounts.findUnique as jest.Mock).mockResolvedValueOnce({
        loyalty_points:          500,
        loyalty_points_lifetime: 500,
        loyalty_tier:            "bronze",
      });

      const res = await service.getMyLoyalty("user-1");
      expect(res.data.tier).toBe("bronze");
      expect(res.data.points).toBe(500);
      expect(res.data.nextTier).not.toBeNull();
      expect(res.data.nextTier?.tier).toBe("silver");
      expect(res.data.nextTier?.pointsNeeded).toBe(1500); // 2000 - 500
    });

    it("returns null nextTier for gold member", async () => {
      (prisma.user_accounts.findUnique as jest.Mock).mockResolvedValueOnce({
        loyalty_points:          9000,
        loyalty_points_lifetime: 9000,
        loyalty_tier:            "gold",
      });

      const res = await service.getMyLoyalty("user-gold");
      expect(res.data.nextTier).toBeNull();
    });

    it("throws if user not found", async () => {
      (prisma.user_accounts.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(service.getMyLoyalty("bad-id")).rejects.toThrow(BadRequestException);
    });
  });

  describe("redeemPoints", () => {
    it("throws when rule not found", async () => {
      (prisma.loyalty_redemption_rules.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(service.redeemPoints("cust-1", "bad-rule")).rejects.toThrow(BadRequestException);
    });

    it("throws when rule is inactive", async () => {
      (prisma.loyalty_redemption_rules.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "rule-1", is_active: false, points_required: 500,
      });
      await expect(service.redeemPoints("cust-1", "rule-1")).rejects.toThrow(BadRequestException);
    });
  });
});
```

**Step 2: Chạy test**

```bash
cd backend && npx jest loyalty.service.spec.ts --no-coverage
```

Expected: `Tests: 4 passed`.

**Step 3: Commit**

```bash
git add backend/src/modules/loyalty/loyalty.service.spec.ts
git commit -m "test(loyalty): add unit tests for LoyaltyService getMyLoyalty and redeemPoints"
```

---

## Task 7: Frontend — Loyalty Tab trong Customer Dashboard

**Files:**
- Create: `frontend/src/app/dashboard/customer/loyalty/page.tsx`
- Create: `frontend/src/lib/api/loyalty.ts`

**Step 1: Tạo API client helper**

```typescript
// frontend/src/lib/api/loyalty.ts
import { apiFetch } from "@/lib/api/client"; // reuse existing fetch wrapper

export type LoyaltyTier = "bronze" | "silver" | "gold";

export type LoyaltyInfo = {
  points:         number;
  lifetimePoints: number;
  tier:           LoyaltyTier;
  nextTier:       { tier: LoyaltyTier; pointsNeeded: number; targetPoints: number } | null;
  tierBenefits:   string[];
};

export type RedemptionRule = {
  id:                  string;
  pointsRequired:      number;
  voucherName:         string;
  discountType:        "percentage" | "fixed";
  discountValue:       number;
  maxDiscountAmount:   number | null;
  minOrderValue:       number;
  voucherValidityDays: number;
};

export type PointLog = {
  id:           string;
  delta:        number;
  reason:       string;
  meta:         Record<string, unknown>;
  balanceAfter: number;
  createdAt:    string;
};

export async function getMyLoyalty(): Promise<LoyaltyInfo> {
  const res = await apiFetch("/loyalty/me");
  return res.data;
}

export async function getPointHistory(cursor?: string): Promise<PointLog[]> {
  const url = cursor ? `/loyalty/me/history?cursor=${cursor}` : "/loyalty/me/history";
  const res = await apiFetch(url);
  return res.data;
}

export async function getRedemptionRules(): Promise<RedemptionRule[]> {
  const res = await apiFetch("/loyalty/rules");
  return res.data;
}

export async function redeemPoints(ruleId: string): Promise<{ voucherCode: string; balanceAfter: number }> {
  const res = await apiFetch("/loyalty/redeem", { method: "POST", body: JSON.stringify({ ruleId }) });
  return res.data;
}
```

**Step 2: Tạo Loyalty Page component**

```typescript
// frontend/src/app/dashboard/customer/loyalty/page.tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";   // reuse existing toast setup
import {
  getMyLoyalty, getPointHistory, getRedemptionRules, redeemPoints,
  type LoyaltyInfo, type PointLog, type RedemptionRule,
} from "@/lib/api/loyalty";

const TIER_LABEL: Record<string, string>  = { bronze: "🥉 Đồng", silver: "🥈 Bạc", gold: "🥇 Vàng" };
const TIER_COLOR: Record<string, string>  = {
  bronze: "bg-amber-100 text-amber-800 border-amber-300",
  silver: "bg-slate-100 text-slate-700 border-slate-300",
  gold:   "bg-yellow-100 text-yellow-800 border-yellow-400",
};

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-2.5 w-full rounded-full bg-gray-200 overflow-hidden">
      <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 transition-all duration-500"
           style={{ width: `${pct}%` }} />
    </div>
  );
}

function ReasonLabel({ reason, meta }: { reason: string; meta: Record<string, unknown> }) {
  if (reason === "earn_rental") return <span>Tích điểm từ đơn thuê</span>;
  if (reason === "redeem_voucher") return <span>Đổi điểm → <code className="text-xs bg-gray-100 px-1 rounded">{String(meta.voucherCode ?? "")}</code></span>;
  return <span>{reason}</span>;
}

export default function LoyaltyPage() {
  const [info,    setInfo]    = useState<LoyaltyInfo | null>(null);
  const [rules,   setRules]   = useState<RedemptionRule[]>([]);
  const [logs,    setLogs]    = useState<PointLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getMyLoyalty(), getRedemptionRules(), getPointHistory()])
      .then(([i, r, l]) => { setInfo(i); setRules(r); setLogs(l); })
      .catch(() => toast.error("Không thể tải thông tin điểm thưởng"))
      .finally(() => setLoading(false));
  }, []);

  async function handleRedeem(ruleId: string) {
    setRedeeming(ruleId);
    try {
      const result = await redeemPoints(ruleId);
      toast.success(`🎉 Đổi thành công! Mã voucher: ${result.voucherCode}`);
      // Refresh
      const [i, l] = await Promise.all([getMyLoyalty(), getPointHistory()]);
      setInfo(i); setLogs(l);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Đổi điểm thất bại";
      toast.error(msg);
    } finally {
      setRedeeming(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Đang tải...</div>;
  if (!info)   return <div className="p-8 text-center text-red-500">Lỗi tải dữ liệu.</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-4">

      {/* ── Tier Card ── */}
      <div className={`rounded-2xl border-2 p-6 ${TIER_COLOR[info.tier]}`}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">{TIER_LABEL[info.tier]}</h2>
          <span className="text-2xl font-extrabold">{info.points.toLocaleString("vi-VN")} điểm</span>
        </div>
        <p className="text-sm opacity-70 mb-3">Tổng tích lũy: {info.lifetimePoints.toLocaleString("vi-VN")} điểm</p>

        {info.nextTier && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>{TIER_LABEL[info.tier]}</span>
              <span>{TIER_LABEL[info.nextTier.tier]} — còn {info.nextTier.pointsNeeded.toLocaleString("vi-VN")} điểm</span>
            </div>
            <ProgressBar value={info.lifetimePoints} max={info.nextTier.targetPoints} />
          </div>
        )}

        <ul className="mt-4 space-y-1 text-sm">
          {info.tierBenefits.map((b) => <li key={b} className="flex gap-2">✓ {b}</li>)}
        </ul>
      </div>

      {/* ── Đổi điểm ── */}
      <section>
        <h3 className="font-semibold text-lg mb-3">Đổi điểm lấy voucher</h3>
        <div className="space-y-3">
          {rules.map((rule) => {
            const canRedeem = info.points >= rule.pointsRequired;
            return (
              <div key={rule.id} className="flex items-center justify-between rounded-xl border p-4 bg-white shadow-sm">
                <div>
                  <p className="font-medium">{rule.voucherName}</p>
                  <p className="text-xs text-gray-500">
                    HSD {rule.voucherValidityDays} ngày
                    {rule.minOrderValue > 0 && ` · Đơn tối thiểu ${rule.minOrderValue.toLocaleString("vi-VN")}đ`}
                  </p>
                </div>
                <button
                  onClick={() => handleRedeem(rule.id)}
                  disabled={!canRedeem || redeeming !== null}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition
                    ${canRedeem
                      ? "bg-amber-500 text-white hover:bg-amber-600 active:scale-95"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
                >
                  {redeeming === rule.id ? "..." : `${rule.pointsRequired.toLocaleString("vi-VN")} điểm`}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Lịch sử giao dịch ── */}
      <section>
        <h3 className="font-semibold text-lg mb-3">Lịch sử điểm</h3>
        {logs.length === 0
          ? <p className="text-gray-400 text-sm text-center py-4">Chưa có giao dịch điểm nào.</p>
          : (
            <ul className="divide-y border rounded-xl overflow-hidden bg-white">
              {logs.map((log) => (
                <li key={log.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <ReasonLabel reason={log.reason} meta={log.meta as Record<string, unknown>} />
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(log.createdAt).toLocaleDateString("vi-VN")}
                      {" · Số dư: "}{log.balanceAfter.toLocaleString("vi-VN")} đ
                    </p>
                  </div>
                  <span className={`font-bold ${log.delta > 0 ? "text-green-600" : "text-red-500"}`}>
                    {log.delta > 0 ? "+" : ""}{log.delta.toLocaleString("vi-VN")}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </section>
    </div>
  );
}
```

**Step 3: Thêm link "Điểm thưởng" vào Customer Dashboard nav**

Tìm file `frontend/src/app/dashboard/customer/layout.tsx` (hoặc nav component tương đương), thêm link:

```tsx
<Link href="/dashboard/customer/loyalty">
  🎁 Điểm thưởng
</Link>
```

**Step 4: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: không error.

**Step 5: Commit**

```bash
git add frontend/src/app/dashboard/customer/loyalty/ frontend/src/lib/api/loyalty.ts frontend/src/app/dashboard/customer/layout.tsx
git commit -m "feat(frontend): add loyalty dashboard page — tier card, redeem points, point history"
```

---

## Task 8: VouchersModule Export Fix (nếu cần)

> **Chỉ làm nếu Task 3/5 báo lỗi `VouchersService not found`.**

**Files:**
- Modify: `backend/src/modules/vouchers/vouchers.module.ts`

**Step 1: Kiểm tra**

```bash
grep -n "exports" backend/src/modules/vouchers/vouchers.module.ts
```

Expected: dòng `exports: [VouchersService]` đã tồn tại → skip task này.

Nếu không có: thêm `exports: [VouchersService]` vào `@Module({})`.

**Step 2: Commit nếu có thay đổi**

```bash
git add backend/src/modules/vouchers/vouchers.module.ts
git commit -m "fix(vouchers): export VouchersService for use in LoyaltyModule"
```

---

## Task 9: E2E Smoke Test & Verification

**Files:**
- Create: `backend/src/modules/loyalty/loyalty.e2e.spec.ts` (optional — nếu có test infra)

**Step 1: Manual smoke test (development server)**

```bash
cd backend && npm run start:dev
```

```bash
# 1. Lấy token customer
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"customer@test.com","password":"..."}'

# 2. Xem loyalty info
curl http://localhost:3000/loyalty/me -H "Authorization: Bearer <TOKEN>"

# 3. Xem rules đổi điểm
curl http://localhost:3000/loyalty/rules -H "Authorization: Bearer <TOKEN>"

# 4. Đổi điểm (cần đủ điểm)
curl -X POST http://localhost:3000/loyalty/redeem \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"ruleId":"<RULE_ID>"}'
```

Expected tất cả: `{ "success": true, "data": {...} }`.

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat(loyalty): complete loyalty points system — DB schema, backend module, frontend dashboard"
```

---

## Checklist Hoàn Thành

- [ ] **Task 1**: Migration SQL `020_loyalty_points.sql` tạo thành công
- [ ] **Task 2**: Prisma schema regenerate không lỗi
- [ ] **Task 3**: `LoyaltyService` — earn, redeem, query APIs hoạt động
- [ ] **Task 4**: `LoyaltyController` đăng ký đúng routes
- [ ] **Task 5**: `refunds.service.ts` hook tích điểm tại 3 nơi booking → completed
- [ ] **Task 6**: Unit test pass (4 tests)
- [ ] **Task 7**: Frontend page `/dashboard/customer/loyalty` render đúng
- [ ] **Task 8**: (nếu cần) VouchersModule export VouchersService
- [ ] **Task 9**: Smoke test API trả đúng response

---

## Business Logic Summary

| Rule | Value |
|---|---|
| Tích điểm | 1.000đ = 1 điểm (trên `rental_total - discount_total`) |
| Hạng Đồng | 0 – 1.999 điểm lifetime |
| Hạng Bạc | 2.000 – 5.999 điểm lifetime |
| Hạng Vàng | ≥ 6.000 điểm lifetime |
| Tier không downgrade | Tier tính trên `loyalty_points_lifetime` — không tụt hạng |
| Voucher từ đổi điểm | Là voucher thật trong bảng `vouchers`, code `LYL-XXXXXX-YYYYYYY` |
| Đổi điểm atomic | Dùng `$executeRaw` với `WHERE loyalty_points >= required` — race-condition safe |

