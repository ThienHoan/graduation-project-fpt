import { IsArray, IsDateString, IsNumber, IsOptional, IsUUID, Matches, Min } from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";

export class CreateSuggestionDto {
  @IsArray()
  @Matches(CANONICAL_UUID_REGEX, { each: true, message: "each value in garmentSizeIds must be a UUID" })
  garmentSizeIds!: string[];

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsNumber()
  @Min(0)
  validPrice!: number;

  @IsOptional()
  @IsUUID("4")
  calendarId?: string;
}
