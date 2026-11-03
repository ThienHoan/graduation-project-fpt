import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Max, Min } from "class-validator";

const DEFAULT_LIMIT = 20;

function toNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.trunc(next) : fallback;
}

export class AdminAuditLogQueryDto {
  @Transform(({ value }) => toNumber(value, 1))
  @IsOptional()
  @Min(1)
  page = 1;

  @Transform(({ value }) => toNumber(value, DEFAULT_LIMIT))
  @IsOptional()
  @Min(1)
  @Max(100)
  limit = DEFAULT_LIMIT;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  search?: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  action?: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  entityType?: string;

  /** admin = ADMIN_*, notification = notification.*, other = everything else. */
  @IsOptional()
  @IsIn(["all", "admin", "notification", "other"])
  group?: "all" | "admin" | "notification" | "other";
}
