import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export const ACCESSORY_CONDITION_STATUSES = [
  "good",
  "laundry",
  "maintenance",
  "damaged",
  "lost",
] as const;

export type AccessoryConditionStatus =
  (typeof ACCESSORY_CONDITION_STATUSES)[number];

/**
 * Ghi nhận kiểm tra 1 dòng phụ kiện khi khách trả đồ.
 * - good: tốt, asset sẵn sàng cho đơn sau
 * - laundry / maintenance / damaged: chuyển asset sang trạng thái tương ứng
 * - lost: mất, asset sang 'lost' + phạt = giá trị đền (replacement_value)
 * - penaltyAmount: phiếu phạt khi hư hỏng (không dùng cho mất vì đã có giá đền)
 */
export class InspectBookingAccessoryDto {
  @IsIn(ACCESSORY_CONDITION_STATUSES)
  conditionStatus!: AccessoryConditionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  penaltyAmount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  imageUrls?: string[];
}
