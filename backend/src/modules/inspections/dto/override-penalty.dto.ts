import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class FindingAdjustmentDto {
  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsNumber()
  @Min(0)
  penaltyAmount!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class OverridePenaltyDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FindingAdjustmentDto)
  findings?: FindingAdjustmentDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalPenaltyOverride?: number;

  @IsNotEmpty()
  @IsString()
  reason!: string;
}
