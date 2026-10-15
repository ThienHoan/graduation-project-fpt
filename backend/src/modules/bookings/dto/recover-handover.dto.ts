import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from "class-validator";

class ReplacementAssetDto {
  @IsUUID("4")
  itemId!: string;

  @IsUUID("4")
  garmentAssetId!: string;
}

export class RecoverHandoverDto {
  @IsIn(["replace", "cancel"])
  action!: "replace" | "cancel";

  @IsDateString()
  expectedDecidedAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReplacementAssetDto)
  replacements?: ReplacementAssetDto[];
}
