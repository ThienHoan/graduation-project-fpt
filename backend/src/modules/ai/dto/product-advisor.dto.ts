import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from "class-validator";

export class ChatHistoryItemDto {
  @IsIn(["customer", "staff", "ai"])
  role!: "customer" | "staff" | "ai";

  @IsString()
  @MaxLength(1000)
  content!: string;

  @IsString()
  createdAt!: string;
}

export class ProductAdvisorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  message!: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatHistoryItemDto)
  history?: ChatHistoryItemDto[];

  /**
   * Intent do router chat phân loại (`ai.sizing`, `ai.comparison`, ...).
   * Chỉ có tác dụng với auto-reply/gợi ý nội bộ; endpoint công khai vẫn tự
   * `detectIntent` như trước.
   */
  @IsString()
  @IsOptional()
  @MaxLength(64)
  intent?: string;

  /**
   * Khách đang chat (chỉ dùng nội bộ) để lấy số đo đã lưu cho câu hỏi chọn size.
   * Endpoint công khai bỏ qua trường này.
   */
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsDateString()
  @IsOptional()
  rentalStartDate?: string;

  @IsDateString()
  @IsOptional()
  rentalEndDate?: string;
}
