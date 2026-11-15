import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";

export class AddAccessoryDto {
  @Matches(CANONICAL_UUID_REGEX, { message: "itemId phải là UUID" })
  itemId!: string;

  @Matches(CANONICAL_UUID_REGEX, { message: "accessoryId phải là UUID" })
  accessoryId!: string;

  @Type(() => Number)
  @IsIn([1], { message: "quantity phải bằng 1 (mỗi dòng = 1 đơn vị)" })
  quantity!: number;
}

export class ReplaceGarmentDto {
  @Matches(CANONICAL_UUID_REGEX, { message: "incidentId phải là UUID" })
  incidentId!: string;

  @Matches(CANONICAL_UUID_REGEX, { message: "sizeId phải là UUID" })
  sizeId!: string;
}

/**
 * Thay phụ kiện bị sự cố bằng một mẫu phụ kiện KHÁC còn hàng và không trùng lịch
 * thuê (mục 4.4). Mẫu mới phải nằm trong `garment_accessories` của trang phục
 * đang chứa món bị sự cố — giá thuê lấy theo liên kết đó.
 *
 * - Bỏ trống `accessoryId` → giữ nguyên mẫu cũ, chỉ đổi chiếc vật lý.
 * - `accessoryAssetId` để trống → server tự chọn chiếc còn trống trong khoảng ngày.
 */
export class ReplaceAccessoryDto {
  @Matches(CANONICAL_UUID_REGEX, { message: "incidentId phải là UUID" })
  incidentId!: string;

  @IsOptional()
  @Matches(CANONICAL_UUID_REGEX, { message: "accessoryId phải là UUID" })
  accessoryId?: string;

  @IsOptional()
  @Matches(CANONICAL_UUID_REGEX, { message: "accessoryAssetId phải là UUID" })
  accessoryAssetId?: string;
}

export class CreateChangeRequestDto {
  @IsIn(["replace", "remove"])
  type!: "replace" | "remove";

  @IsArray()
  @ArrayMaxSize(20)
  @Matches(CANONICAL_UUID_REGEX, { each: true })
  incidents!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(CANONICAL_UUID_REGEX, { each: true })
  keepAccessoryItemIds?: string[];

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReplaceGarmentDto)
  replacements?: ReplaceGarmentDto[];

  /** Thay phụ kiện bị sự cố bằng chiếc cùng `accessory_id` (mục 4.4 / 1.5). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReplaceAccessoryDto)
  accessoryReplacements?: ReplaceAccessoryDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}