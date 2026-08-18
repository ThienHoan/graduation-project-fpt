import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
} from "class-validator";

export class UpdatePriceCalendarDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  occasionType?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @IsInt()
  adjustmentPercent?: number;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  garmentKeywords?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}