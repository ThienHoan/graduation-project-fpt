import { IsNumber, Min } from "class-validator";

export class UpdateSuggestionPriceDto {
  @IsNumber()
  @Min(0)
  validPrice!: number;
}
