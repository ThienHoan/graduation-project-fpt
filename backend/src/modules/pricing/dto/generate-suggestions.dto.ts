import { IsArray, IsDateString, IsOptional, IsUUID, Matches } from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";

export class GenerateSuggestionsDto {
  @IsOptional()
  @IsArray()
  @Matches(CANONICAL_UUID_REGEX, { each: true, message: "each value in sizeIds must be a UUID" })
  sizeIds?: string[];

  @IsOptional()
  @IsUUID("4")
  calendarId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}