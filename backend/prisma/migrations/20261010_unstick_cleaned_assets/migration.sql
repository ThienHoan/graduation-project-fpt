-- ============================================================================
-- Vá asset kẹt ở trạng thái 'cleaned': hoàn tất giặt/sửa/ready giờ đưa asset
-- về 'available' thẳng (xem inspections.service). Các asset đã kẹt trước đó
-- (không còn ticket giặt / job sửa mở) được mở lại cho thuê.
-- ============================================================================

UPDATE "garment_assets" AS ga
SET "status" = 'available',
    "condition_note" = NULL,
    "updated_at" = now()
WHERE ga."status" = 'cleaned'
  AND NOT EXISTS (
    SELECT 1 FROM "laundry_tickets" lt
    WHERE lt."garment_asset_id" = ga."id" AND lt."status" = 'open'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "maintenance_jobs" mj
    WHERE mj."garment_asset_id" = ga."id" AND mj."status" IN ('open', 'in_progress')
  );
