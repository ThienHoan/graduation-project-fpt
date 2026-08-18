import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";

export class CreatePriceCalendarDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  occasionType!: string;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;

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