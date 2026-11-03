import { IsOptional, Matches } from "class-validator";

export const ADMIN_EXPORT_DATASETS = ["users", "bookings", "audit-logs"] as const;
export type AdminExportDataset = (typeof ADMIN_EXPORT_DATASETS)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class AdminExportQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: "from phải có dạng YYYY-MM-DD." })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: "to phải có dạng YYYY-MM-DD." })
  to?: string;
}
