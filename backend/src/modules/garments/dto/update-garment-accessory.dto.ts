import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class UpdateGarmentAccessoryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsBoolean()
  isIncluded?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  extraPrice?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
