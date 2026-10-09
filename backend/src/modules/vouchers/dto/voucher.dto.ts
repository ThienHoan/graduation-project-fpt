import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

export const VOUCHER_DISCOUNT_TYPES = ["percentage", "fixed"] as const;

export class CreateVoucherDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,32}$/, { message: "Mã voucher chỉ gồm chữ, số, - hoặc _ (3–32 ký tự)." })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsIn(VOUCHER_DISCOUNT_TYPES as unknown as string[])
  discountType!: "percentage" | "fixed";

  @IsNumber()
  @Min(1)
  discountValue!: number;

  /** Mức giảm tối đa (dùng cho giảm %) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  /** Tổng số lượt dùng, null = không giới hạn */
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  /** Số lần mỗi khách được dùng, null = không giới hạn */
  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number | null;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  garmentIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVoucherDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsIn(VOUCHER_DISCOUNT_TYPES as unknown as string[])
  discountType?: "percentage" | "fixed";

  @IsOptional()
  @IsNumber()
  @Min(1)
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number | null;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  garmentIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ValidateVoucherDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("all", { each: true })
  garmentSizeIds!: string[];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
