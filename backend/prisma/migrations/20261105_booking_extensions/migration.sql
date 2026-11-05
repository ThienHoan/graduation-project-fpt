-- ============================================================================
-- 021_booking_extensions.sql
-- Khách tự gia hạn ngày thuê, thanh toán phí gia hạn online qua PayOS.
--
-- Luồng: khách bấm gia hạn → hệ thống kiểm tra lịch trống, GIỮ LỊCH ngay bằng
-- cách dời ngày trả (status 'pending', hết hạn sau 30 phút) → khách trả tiền
-- → 'applied'. Quá hạn chưa trả → trả lại ngày cũ ('expired').
-- Chạy thủ công trên Supabase SQL Editor (an toàn khi chạy lại: IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "booking_extensions" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"        UUID NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "requested_by"      UUID REFERENCES "user_accounts"("id") ON DELETE SET NULL,
  "previous_end_date" DATE NOT NULL,
  "new_end_date"      DATE NOT NULL,
  "extra_days"        INTEGER NOT NULL CHECK ("extra_days" > 0),
  "amount"            DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK ("amount" >= 0),
  -- pending: đang giữ lịch chờ thanh toán · applied: đã trả tiền, gia hạn có hiệu lực
  -- expired: quá hạn thanh toán, đã trả lại ngày cũ · cancelled: khách huỷ
  -- failed: tiền về sau khi lịch đã bị người khác đặt → quản lý hoàn tiền thủ công
  "status"            TEXT NOT NULL DEFAULT 'pending'
                      CHECK ("status" IN ('pending', 'applied', 'expired', 'cancelled', 'failed')),
  "payment_id"        UUID UNIQUE REFERENCES "payments"("id") ON DELETE SET NULL,
  "checkout_url"      TEXT,
  "expires_at"        TIMESTAMPTZ(6) NOT NULL,
  "applied_at"        TIMESTAMPTZ(6),
  "note"              TEXT,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "booking_extensions_dates_check" CHECK ("new_end_date" > "previous_end_date")
);

-- Mỗi đơn chỉ có tối đa 1 yêu cầu gia hạn đang giữ lịch.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_extensions_one_pending_per_booking"
  ON "booking_extensions" ("booking_id")
  WHERE "status" = 'pending';

-- Cron quét các yêu cầu hết hạn giữ lịch.
CREATE INDEX IF NOT EXISTS "booking_extensions_status_expires_idx"
  ON "booking_extensions" ("status", "expires_at");

CREATE INDEX IF NOT EXISTS "booking_extensions_booking_id_idx"
  ON "booking_extensions" ("booking_id", "created_at" DESC);

-- Mặc định chặn mọi truy cập qua Supabase API (anon/authenticated). Backend truy
-- cập qua Prisma bằng role sở hữu bảng nên không bị ảnh hưởng.
ALTER TABLE "booking_extensions" ENABLE ROW LEVEL SECURITY;
