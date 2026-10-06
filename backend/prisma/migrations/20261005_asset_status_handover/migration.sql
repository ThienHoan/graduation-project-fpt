-- Mở rộng enum asset_status: thêm trạng thái "cleaned" cho luồng vệ sinh/sửa chữa xong.
ALTER TYPE "asset_status" ADD VALUE IF NOT EXISTS 'cleaned';

-- Thêm field handover confirmation vào model Booking.
-- Các cột này sẽ NULL mặc định cho booking cũ, sau điền dữ liệu qua API.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "handover_status" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMPTZ(6);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "confirmed_by" UUID;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "condition_before_rental" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "condition_images" JSONB;