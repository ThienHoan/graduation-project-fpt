import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Max, Min } from "class-validator";

export const ADMIN_SECURITY_ACCOUNT_TYPES = ["inactive", "unverified", "privileged"] as const;
export type AdminSecurityAccountType = (typeof ADMIN_SECURITY_ACCOUNT_TYPES)[number];

function toInt(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.trunc(next) : fallback;
}

export class AdminSecurityQueryDto {
  @Transform(({ value }) => toInt(value, 1))
  @IsOptional()
  @Min(1)
  page = 1;

  @Transform(({ value }) => toInt(value, 10))
  @IsOptional()
  @Min(1)
  @Max(100)
  limit = 10;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(ADMIN_SECURITY_ACCOUNT_TYPES)
  type: AdminSecurityAccountType = "inactive";
}
