import { IsOptional, IsString, IsIn } from "class-validator";

const DATE_PRESETS = ["today", "this_month", "this_year", "custom"] as const;

export class FinancialQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(DATE_PRESETS)
  preset?: (typeof DATE_PRESETS)[number];

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  transactionStatus?: string;

  @IsOptional()
  @IsString()
  method?: string;
}
