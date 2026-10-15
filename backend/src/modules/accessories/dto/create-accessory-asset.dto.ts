import { IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";

export class CreateAccessoryAssetDto {
  @IsNotEmpty()
  @Matches(CANONICAL_UUID_REGEX, { message: "accessoryId must be a UUID" })
  accessoryId!: string;

  @IsNotEmpty()
  @IsString()
  assetCode!: string;

  @IsOptional()
  @IsString()
  conditionNote?: string;
}
