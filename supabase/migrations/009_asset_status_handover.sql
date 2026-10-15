-- 009_asset_status_handover.sql
-- Mở rộng enum asset_status: thêm trạng thái 'cleaned' (đã vệ sinh/sửa chữa xong, sẵn sàng cho thuê lại)
ALTER TYPE asset_status ADD VALUE IF NOT EXISTS 'cleaned';

-- Thêm field xác nhận tình trạng trước khi nhận hàng (handover) vào bookings
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS handover_status TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ(6);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS confirmed_by UUID;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS condition_before_rental TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS condition_images JSONB;