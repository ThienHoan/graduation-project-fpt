import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";

export class CreateAssetDto {
  @IsNotEmpty()
  @Matches(CANONICAL_UUID_REGEX, { message: "garmentId must be a UUID" })
  garmentId!: string;

  @IsNotEmpty()
  @Matches(CANONICAL_UUID_REGEX, { message: "garmentSizeId must be a UUID" })
  garmentSizeId!: string;

  @IsNotEmpty()
  @IsString()
  assetCode!: string;

  @IsOptional()
  @IsString()
  conditionNote?: string;

  @IsOptional()
  @IsNumber()
  purchaseCost?: number;
}
