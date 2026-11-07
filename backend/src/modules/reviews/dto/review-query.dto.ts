import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  FitFeedbackType,
  REVIEW_LIMITS,
  ReviewSortBy,
  VALID_FIT_FEEDBACKS,
} from '../utils/review-constants';

export class ReviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(REVIEW_LIMITS.MIN_RATING)
  @Max(REVIEW_LIMITS.MAX_RATING)
  rating?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    return undefined;
  })
  @IsBoolean()
  hasMedia?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(VALID_FIT_FEEDBACKS)
  fit?: FitFeedbackType;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ReviewSortBy)
  sortBy?: ReviewSortBy = ReviewSortBy.NEWEST;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = REVIEW_LIMITS.DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REVIEW_LIMITS.MAX_PAGE_LIMIT)
  limit?: number = REVIEW_LIMITS.DEFAULT_LIMIT;
}

