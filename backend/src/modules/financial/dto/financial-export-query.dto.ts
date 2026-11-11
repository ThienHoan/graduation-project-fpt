import { IsIn, IsOptional, Matches } from "class-validator";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const EXPORT_FORMATS = ["pdf", "xlsx"] as const;
export type FinancialExportFormat = (typeof EXPORT_FORMATS)[number];

const DATE_PRESETS = ["today", "this_month", "this_year", "custom"] as const;

export class FinancialExportQueryDto {
  @IsOptional()
  @IsIn(EXPORT_FORMATS, { message: "Định dạng xuất phải là 'pdf' hoặc 'xlsx'." })
  format?: FinancialExportFormat = "pdf";

  @IsOptional()
  @Matches(DATE_REGEX, { message: "from phải có định dạng YYYY-MM-DD." })
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: "to phải có định dạng YYYY-MM-DD." })
  to?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: "startDate phải có định dạng YYYY-MM-DD." })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: "endDate phải có định dạng YYYY-MM-DD." })
  endDate?: string;

  @IsOptional()
  @IsIn(DATE_PRESETS)
  preset?: (typeof DATE_PRESETS)[number];

  getStartDate(): string | undefined {
    return this.from || this.startDate;
  }

  getEndDate(): string | undefined {
    return this.to || this.endDate;
  }
}

