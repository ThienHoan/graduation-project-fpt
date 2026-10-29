import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

/** Điều chỉnh từng finding khi manager approve */
export class FindingOverrideItemDto {
  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsNumber()
  @Min(0)
  penaltyAmount!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

/** Manager duyệt biên bản — có thể điều chỉnh mức phạt từng dòng */
export class ManagerApproveDto {
  /** Nếu truyền vào → override toàn bộ thay vì tính lại từ findings */
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalPenaltyOverride?: number;

  /** Điều chỉnh từng finding cụ thể (optional) */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FindingOverrideItemDto)
  findings?: FindingOverrideItemDto[];

  /** Ghi chú duyệt (bắt buộc) */
  @IsNotEmpty()
  @IsString()
  note!: string;
}

/** Manager từ chối — huỷ toàn bộ phạt cho phiên này */
export class ManagerRejectDto {
  /** Lý do từ chối phạt */
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
