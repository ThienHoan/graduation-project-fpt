import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

/**
 * Body cho PUT /chat/faq/:key. Mọi field đều optional để trang quản trị có
 * thể lưu từng phần, nhưng service sẽ merge với cấu hình hiện tại trước khi
 * validate.
 *
 * `confirm` chỉ dùng cho nhóm ngân hàng/STK: bắt buộc true khi thay đổi nội
 * dung nhạy cảm để tránh lưu nhầm.
 */
export class UpdateFaqItemDto {
  @IsOptional()
  @IsString()
  intent?: string;

  @IsOptional()
  @IsString()
  answerTemplate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredParams?: string[];

  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  notApplicable?: boolean;

  @IsOptional()
  @IsString()
  notApplicableReply?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
