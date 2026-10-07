import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ArrayMaxSize } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @IsNotEmpty()
  garmentId!: string;

  @IsString()
  @IsOptional()
  bookingId?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsNotEmpty()
  rating!: number;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3)
  @IsOptional()
  images?: string[];

  @IsString()
  @IsOptional()
  video?: string;
}
