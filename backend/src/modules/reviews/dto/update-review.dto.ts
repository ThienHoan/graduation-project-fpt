import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import {
  FitFeedbackType,
  REVIEW_LIMITS,
  VALID_FIT_FEEDBACKS,
} from '../utils/review-constants';

export class UpdateReviewDto {
  @IsInt()
  @Min(REVIEW_LIMITS.MIN_RATING)
  @Max(REVIEW_LIMITS.MAX_RATING)
  @IsOptional()
  rating?: number;

  @IsString()
  @IsOptional()
  @MaxLength(REVIEW_LIMITS.MAX_COMMENT_LENGTH)
  comment?: string;

  @IsString()
  @IsOptional()
  @IsIn(VALID_FIT_FEEDBACKS)
  fitFeedback?: FitFeedbackType;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(REVIEW_LIMITS.MAX_IMAGES)
  @IsOptional()
  images?: string[];

  @IsString()
  @IsOptional()
  video?: string;
}
