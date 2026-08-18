-- Thêm trạng thái "deactivated" (vô hiệu hóa) cho price_suggestion.
-- Chủ shop "đổi ý": tắt price period đã tạo, đánh dấu đề xuất là vô hiệu hóa
-- (không quay về pending để tránh xung đột unique (garment_size_id, from_date, to_date)).
ALTER TYPE "price_suggestion_status" ADD VALUE IF NOT EXISTS 'deactivated';
