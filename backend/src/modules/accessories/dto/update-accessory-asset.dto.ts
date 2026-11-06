import { IsNumber, IsOptional, Min } from "class-validator";

/**
 * Cập nhật thông tin định giá của một tài sản phụ kiện.
 * Chỉ cho phép khi asset không nằm trong đơn chưa kết thúc (đang giao/thuê/
 * quá hạn/đã trả/chờ kiểm tra/hoàn tiền) — xem service.
 */
export class UpdateAccessoryAssetDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  purchaseCost?: number;
}
