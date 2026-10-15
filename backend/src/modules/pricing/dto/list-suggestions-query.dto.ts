import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";

export class ListSuggestionsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Matches(CANONICAL_UUID_REGEX, { message: "sizeId must be a UUID" })
  sizeId?: string;

  @IsOptional()
  @IsUUID("4")
  calendarId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}