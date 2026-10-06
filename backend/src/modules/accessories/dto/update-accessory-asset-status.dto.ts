import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

const ALLOWED_STATUSES = [
  "available",
  "reserved",
  "rented",
  "inspection_pending",
  "laundry",
  "maintenance",
  "damaged",
  "retired",
  "lost",
] as const;

export class UpdateAccessoryAssetStatusDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(ALLOWED_STATUSES)
  status!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
