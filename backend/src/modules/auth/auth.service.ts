import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID, webcrypto } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { ok } from "../../common/api-response";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import { toAuthenticatedUser, type UserWithProfile } from "./auth-user";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

type RegisterInput = {
  fullName: string;
  email: string;
  password: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type GoogleLoginInput = {
  idToken: string;
};

type VerifyEmailInput = {
  email: string;
  code: string;
};

type ForgotPasswordInput = {
  email: string;
};

type ResetPasswordInput = {
  email: string;
  otp: string;
  password: string;
};

type GoogleJwtHeader = {
  alg?: string;
  kid?: string;
};

type GoogleTokenPayload = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  exp?: number;
  iat?: number;
};

type GoogleJwk = {
  kid: string;
  [key: string]: unknown;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async register(input: RegisterInput) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingUser = await this.prisma.userAccount.findUnique({ where: { email: normalizedEmail } });

    if (existingUser) {
      // Nếu đã tồn tại nhưng chưa xác thực, cho phép gửi lại OTP
      if (!existingUser.isEmailVerified) {
        await this.sendVerificationCode(existingUser.id, normalizedEmail);
        return ok({ email: normalizedEmail, requiresVerification: true }, "Email đã tồn tại nhưng chưa xác thực. Mã OTP mới đã được gửi.");
      }
      throw new BadRequestException("Email này đã được đăng ký.");
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.userAccount.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: "customer",
        isActive: false,
        isEmailVerified: false,
        profile: {
          create: {
            fullName: input.fullName.trim(),
          },
        },
      },
      include: { profile: true },
    });

    await this.sendVerificationCode(user.id, normalizedEmail);

    return ok(
      { email: user.email, requiresVerification: true },
      "Đăng ký thành công! Vui lòng kiểm tra email (hoặc terminal backend) để lấy mã OTP xác thực.",
    );
  }

  async verifyEmail(input: VerifyEmailInput) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.prisma.userAccount.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      throw new BadRequestException("Email không tồn tại trong hệ thống.");
    }

    if (user.isEmailVerified) {
      throw new BadRequestException("Email này đã được xác thực rồi.");
    }

    const record = await this.prisma.emailVerificationCode.findFirst({
      where: {
        userId: user.id,
        code: input.code.trim(),
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      throw new BadRequestException("Mã OTP không hợp lệ hoặc đã hết hạn.");
    }

    // Đánh dấu OTP đã dùng và kích hoạt tài khoản
    await this.prisma.$transaction([
      this.prisma.emailVerificationCode.update({ where: { id: record.id }, data: { used: true } }),
      this.prisma.userAccount.update({
        where: { id: user.id },
        data: { isEmailVerified: true, isActive: true },
      }),
    ]);

    return ok({ email: user.email }, "Xác thực email thành công! Bạn có thể đăng nhập ngay.");
  }

  async resendVerificationCode(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.userAccount.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      throw new BadRequestException("Email không tồn tại trong hệ thống.");
    }

    if (user.isEmailVerified) {
      throw new BadRequestException("Email này đã được xác thực rồi.");
    }

    await this.sendVerificationCode(user.id, normalizedEmail);
    return ok({ email: normalizedEmail }, "Mã OTP mới đã được gửi. Vui lòng kiểm tra email.");

  }
  async forgotPassword(input: ForgotPasswordInput) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.prisma.userAccount.findUnique({ where: { email: normalizedEmail } });

    if (user) {
      await this.sendPasswordResetOtp(user.id, normalizedEmail);
    }

    return ok(
      { email: normalizedEmail },
      "Nếu email tồn tại trong hệ thống, chúng tôi đã gửi mã OTP đặt lại mật khẩu.",
    );
  }

  async resetPassword(input: ResetPasswordInput) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.prisma.userAccount.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      throw new BadRequestException("Mã OTP không hợp lệ hoặc đã hết hạn.");
    }

    const record = await this.prisma.emailVerificationCode.findFirst({
      where: {
        userId: user.id,
        code: input.otp,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!record) {
      throw new BadRequestException("Mã OTP không hợp lệ hoặc đã hết hạn.");
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id: user.id },
        data: {
          passwordHash,
          updatedAt: new Date(),
        },
      }),
      this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { used: true },
      }),
    ]);

    return ok({ email: user.email }, "Mật khẩu đã được đặt lại thành công. Bạn có thể đăng nhập lại.");
  }

  async login(input: LoginInput) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.prisma.userAccount.findUnique({
      where: { email: normalizedEmail },
      include: { profile: true },
    });

    if (!user) {
      throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException("EMAIL_NOT_VERIFIED");
    }

    if (!user.isActive) {
      throw new UnauthorizedException("Tài khoản đã bị khoá. Vui lòng liên hệ hỗ trợ.");
    }

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
    }

    return ok(await this.buildLoginSession(user));
  }

  async loginWithGoogle(input: GoogleLoginInput) {
    const googleToken = await this.verifyGoogleIdToken(input.idToken);
    const normalizedEmail = googleToken.email!.trim().toLowerCase();
    const { user, isNewUser } = await this.findOrProvisionGoogleUser(googleToken, normalizedEmail);

    return ok({ ...(await this.buildLoginSession(user)), isNewUser });
  }

  async me(userId: string) {
    const user = await this.prisma.userAccount.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("User is inactive or no longer exists.");
    }

    return ok(toAuthenticatedUser(user));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async sendVerificationCode(userId: string, email: string) {
    // V� hi?u ho� t?t c? OTP cu chua d�ng c?a user n�y
    await this.prisma.emailVerificationCode.updateMany({
      where: { userId, used: false },
      data: { used: true },
    });

    // T?o m� OTP 6 s?
    const code = Math.floor(100_000 + Math.random() * 900_000).toString();

    if (process.env.NODE_ENV !== "production") {
      this.logger.log(`DEV OTP for ${email}: ${code}`);
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 ph�t

    await this.prisma.emailVerificationCode.create({
      data: { userId, code, expiresAt },
    });

    const result = await this.notificationsService.sendAuthVerificationEmail({
      email,
      code,
      expiresIn: 10,
    });

    if (result.status === "skipped") {
      this.logger.warn(`SMTP not configured. Skipping email delivery for ${email}. Use the backend terminal OTP above.`);
      return;
    }

    if (result.status === "sent") {
      this.logger.log(`�� g?i OTP qua email d?n: ${email}`);
      return;
    }

    this.logger.error(`L?i khi g?i email d?n ${email}:`, result.reason ?? "unknown error");
  }

  private async sendPasswordResetOtp(userId: string, email: string) {
    await this.prisma.emailVerificationCode.updateMany({
      where: { userId, used: false },
      data: { used: true },
    });

    const code = Math.floor(100_000 + Math.random() * 900_000).toString();

    if (process.env.NODE_ENV !== "production") {
      this.logger.log(`DEV password reset OTP for ${email}: ${code}`);
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.prisma.emailVerificationCode.create({
      data: { userId, code, expiresAt },
    });

    const result = await this.notificationsService.sendPasswordResetEmail({
      email,
      code,
      expiresIn: 10,
    });

    if (result.status === "skipped") {
      this.logger.warn(
        `SMTP not configured. Skipping email delivery for ${email}. Use the backend terminal OTP above.`,
      );
      return;
    }

    if (result.status === "sent") {
      this.logger.log(`Đã gửi email OTP đặt lại mật khẩu đến: ${email}`);
      return;
    }

    this.logger.error(`Lỗi khi gửi email OTP đặt lại mật khẩu đến ${email}:`, result.reason ?? "unknown error");
  }

  private async verifyGoogleIdToken(idToken: string) {
    const [encodedHeader, encodedPayload, encodedSignature] = idToken.trim().split(".");

    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    let header: GoogleJwtHeader;
    try {
      header = this.decodeJwtPart<GoogleJwtHeader>(encodedHeader);
    } catch {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    if (header.alg !== "RS256" || !header.kid) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    const jwks = await this.fetchGoogleJwks();
    const jwk = jwks.find((key): key is GoogleJwk => key.kid === header.kid);

    if (!jwk) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    const subtle = webcrypto.subtle;
    const cryptoKey = await subtle.importKey(
      "jwk",
      jwk as any,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signature = this.base64UrlToUint8Array(encodedSignature);
    const signedBytes = new TextEncoder().encode(encodedHeader + "." + encodedPayload);
    const signatureValid = await subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedBytes);

    if (!signatureValid) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    let payload: GoogleTokenPayload;
    try {
      payload = this.decodeJwtPart<GoogleTokenPayload>(encodedPayload);
    } catch {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim().replace(/^["']|["']$/g, "");
    if (!googleClientId) {
      throw new BadRequestException("Google login chưa được cấu hình.");
    }

    if (!payload.sub || !payload.email || !this.isGoogleEmailVerified(payload.email_verified)) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    if (!this.isGoogleAudienceValid(payload.aud, googleClientId)) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    return payload;
  }

  private async fetchGoogleJwks() {
    const response = await fetch(GOOGLE_JWKS_URL, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    const data = (await response.json().catch(() => null)) as { keys?: GoogleJwk[] } | null;

    if (!data?.keys?.length) {
      throw new UnauthorizedException("Google token không hợp lệ hoặc đã hết hạn.");
    }

    return data.keys;
  }

  private async findOrProvisionGoogleUser(googleToken: GoogleTokenPayload, email: string) {
    const displayName = this.resolveGoogleDisplayName(googleToken, email);
    const existingUser = await this.prisma.userAccount.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (!existingUser) {
      const passwordHash = await bcrypt.hash(randomUUID(), 12);

      const user = await this.prisma.userAccount.create({
        data: {
          email,
          passwordHash,
          role: "customer",
          isActive: true,
          isEmailVerified: true,
          profile: {
            create: {
              fullName: displayName,
            },
          },
        },
        include: { profile: true },
      });
      return { user, isNewUser: true };
    }

    if (!existingUser.isActive) {
      throw new UnauthorizedException("Tài khoản đã bị khoá. Vui lòng liên hệ hỗ trợ.");
    }

    const shouldVerifyEmail = !existingUser.isEmailVerified;
    const existingFullName = existingUser.profile?.fullName?.trim() ?? "";
    const shouldSyncProfile = displayName.length > 0 && !existingFullName;

    if (!shouldVerifyEmail && !shouldSyncProfile) {
      return { user: existingUser, isNewUser: false };
    }

    const updatedUser = await this.prisma.userAccount.update({
      where: { id: existingUser.id },
      data: {
        ...(shouldVerifyEmail
          ? {
              isEmailVerified: true,
              isActive: true,
              updatedAt: new Date(),
            }
          : {}),
        ...(shouldSyncProfile
          ? {
              profile: {
                upsert: {
                  create: {
                    fullName: displayName,
                  },
                  update: {
                    fullName: displayName,
                  },
                },
              },
            }
          : {}),
      },
      include: { profile: true },
    });
    return { user: updatedUser, isNewUser: false };
  }

  private async buildLoginSession(user: UserWithProfile) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenType: "access",
    });

    return {
      accessToken,
      user: this.serializeLoginUser(user),
    };
  }

  private decodeJwtPart<T>(part: string) {
    const normalizedPart = part.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPart = normalizedPart.padEnd(Math.ceil(normalizedPart.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(paddedPart, "base64").toString("utf8")) as T;
  }

  private base64UrlToUint8Array(value: string) {
    const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/");
    const paddedValue = normalizedValue.padEnd(Math.ceil(normalizedValue.length / 4) * 4, "=");
    return Uint8Array.from(Buffer.from(paddedValue, "base64"));
  }

  private isGoogleEmailVerified(value: GoogleTokenPayload["email_verified"]) {
    return value === true || value === "true";
  }

  private isGoogleAudienceValid(aud: GoogleTokenPayload["aud"], clientId: string) {
    return Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
  }

  private resolveGoogleDisplayName(googleToken: GoogleTokenPayload, email: string) {
    const name = googleToken.name?.trim();
    if (name) {
      return name;
    }

    const localPart = email.split("@")[0]?.trim();
    return localPart && localPart.length > 0 ? localPart : "Google User";
  }

  private serializeLoginUser(user: UserWithProfile) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}




