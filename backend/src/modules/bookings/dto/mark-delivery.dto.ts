import { IsOptional, IsString, MaxLength } from "class-validator";

export class MarkDeliveryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
