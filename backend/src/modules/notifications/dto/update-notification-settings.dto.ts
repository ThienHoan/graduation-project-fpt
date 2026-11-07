import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsIn(["mock", "smtp", "resend", "brevo"])
  provider?: "mock" | "smtp" | "resend" | "brevo";

  @IsOptional()
  @IsString()
  smtpService?: string;

  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @IsString()
  smtpUser?: string;

  @IsOptional()
  @IsString()
  smtpPassword?: string;

  @IsOptional()
  @IsEmail()
  fromEmail?: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsOptional()
  @IsString()
  replyTo?: string;

  @IsOptional()
  @IsString()
  resendApiKey?: string;

  @IsOptional()
  @IsString()
  brevoApiKey?: string;
}
