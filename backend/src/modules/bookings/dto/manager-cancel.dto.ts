import { IsString, MaxLength, MinLength } from "class-validator";

/** §8.2 Manager/Admin hủy đơn đã thanh toán — bắt buộc lý do. */
export class ManagerCancelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}