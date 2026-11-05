import { Type } from "class-transformer";
import { IsInt, IsUUID, Max, Min } from "class-validator";

export class CreateExtensionLinkDto {
  @IsUUID()
  bookingId!: string;

  /** Số ngày muốn gia hạn thêm (1–7). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  days!: number;
}
