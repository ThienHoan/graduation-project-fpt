import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString({ message: "Mật khẩu hiện tại không hợp lệ." })
  @IsNotEmpty({ message: "Vui lòng nhập mật khẩu hiện tại." })
  currentPassword!: string;

  @IsString({ message: "Mật khẩu mới không hợp lệ." })
  @IsNotEmpty({ message: "Vui lòng nhập mật khẩu mới." })
  @MinLength(8, { message: "Mật khẩu mới phải có tối thiểu 8 ký tự." })
  newPassword!: string;
}

