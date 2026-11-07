import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import type { AttentionCategory } from "./customer-care.types";

export class AttentionListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(["all", "pickup_tomorrow", "return_today", "pending_extension", "overdue", "renting"])
  category?: AttentionCategory = "all";

  @IsOptional()
  @IsString()
  date?: string;
}

export class EmailPreviewQueryDto {
  @IsString()
  templateKey!: string;

  @IsOptional()
  @IsString()
  variant?: string;
}

export class NotificationHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @IsIn(["all", "accepted", "failed", "unknown"])
  status?: "all" | "accepted" | "failed" | "unknown" = "all";

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  bookingCode?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class CustomerExtensionHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @IsIn(["all", "pending", "applied", "expired", "cancelled", "failed"])
  status?: string = "all";

  @IsOptional()
  @IsString()
  bookingId?: string;
}

export class ManagerExtensionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @IsIn(["all", "pending", "applied", "expired", "cancelled", "failed"])
  status?: string = "all";

  @IsOptional()
  @IsString()
  bookingCode?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}

export class CustomerCareAnalyticsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(["7d", "30d", "90d", "custom"])
  period?: "7d" | "30d" | "90d" | "custom" = "30d";

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}



