import { IsNotEmpty, Matches } from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";

export class AssignAccessoryAssetDto {
  @IsNotEmpty()
  @Matches(CANONICAL_UUID_REGEX, { message: "accessoryAssetId must be a UUID" })
  accessoryAssetId!: string;
}
