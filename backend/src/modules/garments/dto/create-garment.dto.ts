import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Matches,
  IsString,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { normalizeOptionalString } from "../../users/dto/transformers";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";
import { GarmentMeasurementsDto } from "./garment-details.dto";

export class CreateGarmentDto {
  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @Matches(CANONICAL_UUID_REGEX, { message: "categoryId must be a UUID" })
  categoryId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  sizeLabel?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  material?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  occasion?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  careInstructions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  usageConditions?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => GarmentMeasurementsDto)
  measurements?: GarmentMeasurementsDto;

  @IsNumber()
  dailyPrice!: number;

  @IsNumber()
  depositAmount!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
