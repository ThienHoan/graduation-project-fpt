-- ============================================================================
-- Vá phạt các dòng phụ kiện hư/mất đã kiểm tra trước khi có cột penalty_amount:
-- lấy từ bảng penalties (khớp theo đơn + mã asset trong lý do).
-- Chỉ vá dòng khớp được phạt (tránh gán NULL vi phạm NOT NULL).
-- ============================================================================

UPDATE "booking_accessory_items" AS bai
SET "penalty_amount" = (
  SELECT p."amount"
  FROM "penalties" AS p
  JOIN "accessory_assets" AS aa ON aa."id" = bai."accessory_asset_id"
  WHERE p."booking_id" = bai."booking_id"
    AND p."amount" > 0
    AND (
      p."reason" = 'Hư hỏng phụ kiện ' || aa."asset_code"
      OR p."reason" LIKE 'Hư hỏng phụ kiện ' || aa."asset_code" || ':%'
      OR p."reason" = 'Mất phụ kiện ' || aa."asset_code" || ' — đền theo giá trị'
    )
  ORDER BY p."created_at" DESC
  LIMIT 1
)
WHERE bai."condition_status" IN ('damaged', 'lost')
  AND bai."penalty_amount" = 0
  AND EXISTS (
    SELECT 1
    FROM "penalties" AS p2
    JOIN "accessory_assets" AS aa2 ON aa2."id" = bai."accessory_asset_id"
    WHERE p2."booking_id" = bai."booking_id"
      AND p2."amount" > 0
      AND (
        p2."reason" = 'Hư hỏng phụ kiện ' || aa2."asset_code"
        OR p2."reason" LIKE 'Hư hỏng phụ kiện ' || aa2."asset_code" || ':%'
        OR p2."reason" = 'Mất phụ kiện ' || aa2."asset_code" || ' — đền theo giá trị'
      )
  );
