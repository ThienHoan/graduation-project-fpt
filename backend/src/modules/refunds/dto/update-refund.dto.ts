import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

const REFUND_FINAL_STATUSES = ["refunded", "partially_refunded"] as const;
export type RefundFinalStatus = (typeof REFUND_FINAL_STATUSES)[number];

export class UpdateRefundStatusDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(REFUND_FINAL_STATUSES)
  status!: RefundFinalStatus;

  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  proofImageUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
