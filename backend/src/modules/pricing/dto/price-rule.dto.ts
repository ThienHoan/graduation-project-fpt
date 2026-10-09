import {
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
  Max,
  Min,
} from "class-validator";

export const PRICE_RULE_TYPES = [
  "tet",
  "holiday",
  "double_sale",
  "weekend",
  "peak_season",
  "store_program",
] as const;
export type PriceRuleType = (typeof PRICE_RULE_TYPES)[number];

export class CreatePriceRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(PRICE_RULE_TYPES as unknown as string[])
  ruleType!: PriceRuleType;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  recurringYearly?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  /** Âm = giảm, dương = tăng (vd. -20 = giảm 20%) */
  @IsOptional()
  @IsNumber()
  @Min(-100)
  @Max(500)
  percentage?: number | null;

  @IsOptional()
  @IsNumber()
  fixedAmount?: number | null;

  /** Bỏ trống → dùng độ ưu tiên mặc định theo loại */
  @IsOptional()
  @IsInt()
  priority?: number;

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

  @IsOptional()
  @IsString()
  note?: string | null;
}

export class UpdatePriceRuleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(PRICE_RULE_TYPES as unknown as string[])
  ruleType?: PriceRuleType;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  recurringYearly?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  /** Âm = giảm, dương = tăng (vd. -20 = giảm 20%) */
  @IsOptional()
  @IsNumber()
  @Min(-100)
  @Max(500)
  percentage?: number | null;

  @IsOptional()
  @IsNumber()
  fixedAmount?: number | null;

  /** Bỏ trống → dùng độ ưu tiên mặc định theo loại */
  @IsOptional()
  @IsInt()
  priority?: number;

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

  @IsOptional()
  @IsString()
  note?: string | null;
}


export class PreviewPriceDto {
  @IsArray()
  @IsUUID("all", { each: true })
  garmentSizeIds!: string[];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
