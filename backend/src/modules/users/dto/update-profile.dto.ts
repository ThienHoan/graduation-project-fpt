import { Transform } from "class-transformer";
import { IsOptional, IsString, Matches, ValidateIf } from "class-validator";
import { normalizeOptionalString } from "./transformers";

export class UpdateProfileDto {
  @Transform(normalizeOptionalString)
  @IsOptional()
  @IsString()
  fullName?: string | null;

  @Transform(normalizeOptionalString)
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined && val !== "")
  @Matches(/^(0|\+84|84)(3|5|7|8|9)[0-9]{8}$/, {
    message: "Số điện thoại phải là định dạng số điện thoại Việt Nam hợp lệ (ví dụ: 0901234567 hoặc +84901234567).",
  })
  phone?: string | null;
}
