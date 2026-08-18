import { ArrayNotEmpty, IsArray, IsIn, IsString } from "class-validator";

export class BulkSuggestionActionDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];

  @IsIn(["approve", "reject"])
  action!: "approve" | "reject";
}