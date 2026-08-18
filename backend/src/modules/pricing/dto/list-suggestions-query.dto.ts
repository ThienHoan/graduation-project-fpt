import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class ListSuggestionsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID("4")
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