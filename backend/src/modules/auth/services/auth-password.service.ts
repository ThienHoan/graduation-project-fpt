import { BadRequestException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

@Injectable()
export class AuthPasswordService {
  private readonly BCRYPT_SALT_ROUNDS = 12;

  private readonly COMMON_PASSWORDS = new Set([
    "password",
    "password123",
    "12345678",
    "123456789",
    "1234567890",
    "qwertyuiop",
    "admin123",
    "admin@123",
    "iloveyou",
    "cophuc123",
    "rental123",
  ]);

  /**
   * Hashes a plaintext password using bcrypt with 12 salt rounds.
   */
  async hashPassword(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.BCRYPT_SALT_ROUNDS);
  }

  /**
   * Compares a plaintext password against a stored bcrypt hash.
   */
  async comparePassword(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }

  /**
   * Validates password strength against security policy:
   * - Minimum 8 characters
   * - At least one uppercase letter
   * - At least one lowercase letter
   * - At least one numerical digit
   * - At least one special character
   * - Not a commonly used weak password
   * - Does not contain the user's email prefix
   */
  validatePasswordStrength(password: string, email?: string): PasswordValidationResult {
    const errors: string[] = [];

    if (!password || password.length < 8) {
      errors.push("Mật khẩu phải có tối thiểu 8 ký tự.");
    }

    if (password.length > 128) {
      errors.push("Mật khẩu không được vượt quá 128 ký tự.");
    }

    if (!/[A-Z]/.test(password)) {
      errors.push("Mật khẩu phải chứa ít nhất một chữ cái in hoa (A-Z).");
    }

    if (!/[a-z]/.test(password)) {
      errors.push("Mật khẩu phải chứa ít nhất một chữ cái in thường (a-z).");
    }

    if (!/\d/.test(password)) {
      errors.push("Mật khẩu phải chứa ít nhất một chữ số (0-9).");
    }

    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
      errors.push("Mật khẩu phải chứa ít nhất một ký tự đặc biệt (@, #, $, %, ...).");
    }

    if (this.COMMON_PASSWORDS.has(password.toLowerCase().trim())) {
      errors.push("Mật khẩu quá thông dụng và dễ đoán. Vui lòng chọn mật khẩu phức tạp hơn.");
    }

    if (email) {
      const emailPrefix = email.split("@")[0]?.toLowerCase().trim();
      if (emailPrefix && emailPrefix.length >= 4 && password.toLowerCase().includes(emailPrefix)) {
        errors.push("Mật khẩu không được chứa phần tên email của bạn.");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Enforces password validation, throwing a BadRequestException if invalid.
   */
  assertPasswordStrength(password: string, email?: string): void {
    const result = this.validatePasswordStrength(password, email);
    if (!result.isValid) {
      throw new BadRequestException(result.errors[0]);
    }
  }
}

