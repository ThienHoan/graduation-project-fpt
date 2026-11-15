import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";
import { AddAccessoryDto, ReplaceAccessoryDto, ReplaceGarmentDto } from "./change-request.dto";

/**
 * §13.2 Manager/Admin xử lý sự cố.
 * Chỉ nhận lựa chọn + lý do; KHÔNG nhận amount/price/customerId từ client.
 */
export class ManagerIncidentActionDto {
  @IsIn(["cancel", "remove", "proposal", "preview"])
  action!: "cancel" | "remove" | "proposal" | "preview";

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  /**
   * Tiêu đề email tuỳ chỉnh (nếu quản lý sửa ở bản xem trước). Bỏ trống → server
   * dùng tiêu đề mặc định. Khi gửi KHÔNG nhận `html` từ client (server tự dựng).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  emailSubject?: string;

  /** Lời nhắn mở đầu tuỳ chỉnh trong email gửi khách (bỏ trống → câu mặc định). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  emailMessage?: string;

  /**
   * `proposal` only: replace (cần `replacements`) hoặc remove. Mặc định remove.
   */
  @IsOptional()
  @IsIn(["replace", "remove"])
  type?: "replace" | "remove";

  /**
   * `preview` only: loại email muốn dựng bản xem trước. Bỏ trống → đề xuất đổi
   * mẫu. `remove`/`cancel` dựng đúng email sẽ gửi khi quản lý bấm xác nhận.
   */
  @IsOptional()
  @IsIn(["proposal", "remove", "cancel"])
  previewAction?: "proposal" | "remove" | "cancel";

  /**
   * Sự cố áp dụng. Bỏ trống → chỉ sự cố trong URL (giữ tương thích cũ). Trang
   * `/booking/incidents/[bookingId]` gộp theo ĐƠN nên gửi toàn bộ sự cố đang mở.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(CANONICAL_UUID_REGEX, { each: true })
  incidents?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReplaceGarmentDto)
  replacements?: ReplaceGarmentDto[];

  /** `proposal` only: thay phụ kiện bị sự cố (cùng `accessory_id`). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReplaceAccessoryDto)
  accessoryReplacements?: ReplaceAccessoryDto[];

  /**
   * Checklist phụ kiện của đơn sau khi đổi trang phục (giống trang khách):
   * dòng cần bỏ + dòng cần thêm. Không bắt buộc khi chỉ thay trang phục.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(CANONICAL_UUID_REGEX, { each: true })
  removeAccessoryItemIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AddAccessoryDto)
  addAccessories?: AddAccessoryDto[];
}
