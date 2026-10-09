import { IsUUID } from "class-validator";

/**
 * Một phụ kiện khách tick chọn thuê kèm theo 1 món trong giỏ.
 * garmentSizeId xác định món (Sản phẩm A/B); accessoryId là phụ kiện của garment đó.
 */
export class BookingAccessorySelectionDto {
  @IsUUID("4")
  garmentSizeId!: string;

  @IsUUID("4")
  accessoryId!: string;
}
