import { IsArray, IsDateString, IsNumber, IsOptional, IsUUID, Min } from "class-validator";

export class CreateSuggestionDto {
  @IsArray()
  @IsUUID("4", { each: true })
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
