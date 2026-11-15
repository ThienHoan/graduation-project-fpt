-- ============================================================================
-- Backfill: đóng sự cố đổi mẫu còn kẹt "đang mở" trên đơn ĐÃ HỦY.
--
-- Trước bản sửa này, luồng khách tự hủy đơn (`BookingsService.cancel`) gọi
-- `cancelBookingTx` mà KHÔNG dọn `booking_incidents`, nên sự cố ở lại
-- `open`/`awaiting_customer`/`needs_manager` dù đơn đã `cancelled` — hiện sai
-- "Chờ khách xác nhận" trên dashboard manager.
--
-- Giờ `cancelBookingTx` tự đóng sự cố cho MỌI đường hủy. Script này dọn dữ liệu
-- cũ một lần. An toàn khi chạy lại (idempotent: chỉ đụng dòng còn "mở").
-- ============================================================================

UPDATE "booking_incidents" i
SET    "status"      = 'resolved',
       "resolution"  = 'booking_cancelled',
       "resolved_at" = now(),
       "note"        = COALESCE(i."note", 'Backfill: đơn đã hủy')
FROM   "bookings" b
WHERE  i."booking_id" = b."id"
  AND  b."status"     = 'cancelled'
  AND  i."status"     IN ('open', 'awaiting_customer', 'needs_manager');