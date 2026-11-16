-- ============================================================================
-- Mục 4.4 — Đổi mẫu khi có sự cố.
--
-- Thêm 4 bảng mới + cột notifications.link_url. Bảng/cột thuần additive, không
-- đụng dữ liệu đơn hiện có. Chạy thủ công trên Supabase SQL Editor (an toàn khi
-- chạy lại: IF NOT EXISTS).
-- ============================================================================

-- 1) link_url cho thông báo: đường dẫn tương đối do server sinh, không nhận từ client.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "link_url" TEXT;

-- 2) Sự cố trang phục/phụ kiện trước khi bàn giao.
CREATE TABLE IF NOT EXISTS "booking_incidents" (
  "id"                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"                UUID NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "item_kind"                 TEXT NOT NULL CHECK ("item_kind" IN ('garment', 'accessory')),
  "booking_item_id"           UUID REFERENCES "booking_items"("id") ON DELETE SET NULL,
  "booking_accessory_item_id" UUID REFERENCES "booking_accessory_items"("id") ON DELETE SET NULL,
  "dedupe_key"                TEXT NOT NULL,
  "reason"                    TEXT NOT NULL,
  "asset_id"                  UUID,
  "asset_code"                TEXT,
  "snapshot"                  JSONB NOT NULL,
  "status"                    TEXT NOT NULL DEFAULT 'open'
                              CHECK ("status" IN ('open', 'awaiting_customer', 'needs_manager', 'resolved', 'cancelled')),
  "due_at"                    DATE NOT NULL,
  "detected_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "notified_at"               TIMESTAMPTZ(6),
  "change_request_id"         UUID,
  "resolution"                TEXT,
  "resolved_at"               TIMESTAMPTZ(6),
  "resolved_by"               UUID,
  "note"                      TEXT,
  "created_at"                TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"                TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Mỗi món chỉ có tối đa 1 sự cố đang mở.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_incidents_open_dedupe"
  ON "booking_incidents" ("dedupe_key")
  WHERE "status" IN ('open', 'awaiting_customer', 'needs_manager');

CREATE INDEX IF NOT EXISTS "booking_incidents_booking_id_status_idx"
  ON "booking_incidents" ("booking_id", "status");

CREATE INDEX IF NOT EXISTS "booking_incidents_status_due_at_idx"
  ON "booking_incidents" ("status", "due_at");

-- 3) Yêu cầu đổi mẫu / bỏ món.
CREATE TABLE IF NOT EXISTS "booking_change_requests" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"      UUID NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "type"            TEXT NOT NULL CHECK ("type" IN ('replace', 'remove')),
  "source"          TEXT NOT NULL DEFAULT 'customer' CHECK ("source" IN ('customer', 'manager')),
  "status"          TEXT NOT NULL DEFAULT 'quoted'
                    CHECK ("status" IN ('quoted', 'awaiting_payment', 'applied', 'expired', 'cancelled', 'needs_manager')),
  "created_by"      UUID,
  "selection"       JSONB NOT NULL,
  "before_snapshot" JSONB NOT NULL,
  "after_snapshot"  JSONB NOT NULL,
  "rent_before"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  "rent_after"      DECIMAL(12,2) NOT NULL DEFAULT 0,
  "deposit_before"  DECIMAL(12,2) NOT NULL DEFAULT 0,
  "deposit_after"   DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discount_before" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discount_after"  DECIMAL(12,2) NOT NULL DEFAULT 0,
  "charge_amount"   DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK ("charge_amount" >= 0),
  "hold_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "payment_id"      UUID UNIQUE REFERENCES "payments"("id") ON DELETE SET NULL,
  "checkout_url"    TEXT,
  "applied_at"      TIMESTAMPTZ(6),
  "note"            TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Mỗi đơn chỉ có tối đa 1 yêu cầu đổi đang chờ.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_change_requests_one_pending"
  ON "booking_change_requests" ("booking_id")
  WHERE "status" IN ('quoted', 'awaiting_payment');

CREATE INDEX IF NOT EXISTS "booking_change_requests_booking_id_status_idx"
  ON "booking_change_requests" ("booking_id", "status");

-- Cron expireChangeRequests quét theo (status, hold_expires_at).
CREATE INDEX IF NOT EXISTS "booking_change_requests_status_hold_expires_idx"
  ON "booking_change_requests" ("status", "hold_expires_at");

-- 4) Giữ chỗ tạm (30 phút) một asset cụ thể cho yêu cầu đổi.
CREATE TABLE IF NOT EXISTS "booking_change_holds" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "change_request_id"  UUID NOT NULL REFERENCES "booking_change_requests"("id") ON DELETE CASCADE,
  "booking_id"         UUID NOT NULL,
  "kind"               TEXT NOT NULL CHECK ("kind" IN ('garment', 'accessory')),
  "garment_asset_id"   UUID,
  "accessory_asset_id" UUID,
  "start_day"          DATE NOT NULL,
  "end_day"            DATE NOT NULL,
  "expires_at"         TIMESTAMPTZ(6) NOT NULL,
  "consumed_at"        TIMESTAMPTZ(6),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "booking_change_holds_asset_check" CHECK (
    ("kind" = 'garment' AND "garment_asset_id" IS NOT NULL)
    OR ("kind" = 'accessory' AND "accessory_asset_id" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "booking_change_holds_garment_asset_id_expires_idx"
  ON "booking_change_holds" ("garment_asset_id", "expires_at");

CREATE INDEX IF NOT EXISTS "booking_change_holds_accessory_asset_id_expires_idx"
  ON "booking_change_holds" ("accessory_asset_id", "expires_at");

-- 5) Chênh lệch tiền do đổi mẫu / bỏ món (chỉ ghi cho đơn đã thanh toán).
CREATE TABLE IF NOT EXISTS "booking_adjustments" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"        UUID NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "change_request_id" UUID REFERENCES "booking_change_requests"("id") ON DELETE SET NULL,
  "incident_id"       UUID,
  "component"         TEXT NOT NULL CHECK ("component" IN ('rent', 'deposit', 'accessory_rent')),
  "direction"         TEXT NOT NULL CHECK ("direction" IN ('charge', 'credit')),
  "amount"            DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "status"            TEXT NOT NULL DEFAULT 'pending_payment'
                      CHECK ("status" IN ('pending_payment', 'collected', 'accrued', 'settled', 'void')),
  "payment_id"        UUID,
  "refund_id"         UUID,
  "note"              TEXT,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "booking_adjustments_booking_id_status_idx"
  ON "booking_adjustments" ("booking_id", "status");

CREATE INDEX IF NOT EXISTS "booking_adjustments_status_idx"
  ON "booking_adjustments" ("status");

-- 6) RLS: deny-all cho anon/authenticated (backend Prisma dùng role sở hữu bảng
--    nên không bị ảnh hưởng).
ALTER TABLE "booking_incidents"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_change_holds"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_adjustments"     ENABLE ROW LEVEL SECURITY;
