import { IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import type { DamageFeeEntry } from "../../admin/admin.constants";

export class DamageFeeEntryDto implements DamageFeeEntry {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pct?: number | null;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  tiers?: number[] | null;

  @IsIn(["low", "medium", "high", "severe"])
  severity!: "low" | "medium" | "high" | "severe";
}

export class UpdateDamageFeeTableDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DamageFeeEntryDto)
  entries!: DamageFeeEntryDto[];
}

