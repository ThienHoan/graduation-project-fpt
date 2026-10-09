import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class ProductStatsQueryDto {
  /** Mặc định: 90 ngày gần nhất */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Tiêu chí xếp hạng HOT */
  @IsOptional()
  @IsIn(["revenue", "bookings"])
  sortBy?: "revenue" | "bookings";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  hotLimit?: number;

  /** Sản phẩm có số lượt thuê <= ngưỡng này trong kỳ được xem là ít được thuê */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowDemandMaxRentals?: number;

  /** Bỏ qua sản phẩm mới tạo chưa đủ số ngày này (chưa đủ dữ liệu để đánh giá) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAgeDays?: number;

  @IsOptional()
  @IsUUID("all")
  categoryId?: string;
}

export class TrackViewDto {
  @IsUUID("all")
  garmentId!: string;

  /** ID ẩn danh do trình duyệt sinh và lưu localStorage */
  @IsString()
  visitorKey!: string;
}
