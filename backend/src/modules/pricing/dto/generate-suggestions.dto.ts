import { IsArray, IsDateString, IsOptional, IsUUID } from "class-validator";

export class GenerateSuggestionsDto {
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
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