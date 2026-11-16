import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export const HANDOVER_RECOVERY_ACTIONS = ["cancel"] as const;
export type HandoverRecoveryAction = (typeof HANDOVER_RECOVERY_ACTIONS)[number];

/**
 * Xử lý biên bản bàn giao bị từ chối. Từ chối bàn giao chỉ còn một hướng duy
 * nhất: hủy đơn và hoàn tiền — không còn "thay thế sản phẩm" tại bước này.
 */
export class RecoverHandoverDto {
  /** Giữ lại để tương thích payload cũ; chỉ nhận `cancel` (mặc định cũng là hủy). */
  @IsOptional()
  @IsIn(HANDOVER_RECOVERY_ACTIONS)
  action?: HandoverRecoveryAction;

  @IsDateString()
  expectedDecidedAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}