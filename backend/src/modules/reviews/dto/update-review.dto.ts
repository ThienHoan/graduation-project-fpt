import { IsArray, IsInt, IsOptional, IsString, Max, Min, ArrayMaxSize } from 'class-validator';

export class UpdateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  rating?: number;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsString()
  @IsOptional()
  fitFeedback?: "tight" | "true_to_size" | "loose";

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3)
  @IsOptional()
  images?: string[];

  @IsString()
  @IsOptional()
  video?: string;
}
