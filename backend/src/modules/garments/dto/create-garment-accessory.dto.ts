import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min } from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";

export class CreateGarmentAccessoryDto {
  @IsNotEmpty()
  @Matches(CANONICAL_UUID_REGEX, { message: "accessoryId must be a UUID" })
  accessoryId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsBoolean()
  isIncluded?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  extraPrice?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
