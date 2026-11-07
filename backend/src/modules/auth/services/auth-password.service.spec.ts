import { describe, expect, it } from "vitest";
import { AuthPasswordService } from "./auth-password.service";

describe("AuthPasswordService", () => {
  const service = new AuthPasswordService();

  it("hashes and verifies passwords correctly", async () => {
    const raw = "SecurePass@2026";
    const hash = await service.hashPassword(raw);

    expect(hash).not.toBe(raw);
    expect(await service.comparePassword(raw, hash)).toBe(true);
    expect(await service.comparePassword("WrongPassword123!", hash)).toBe(false);
  });

  it("rejects passwords shorter than 8 characters", () => {
    const res = service.validatePasswordStrength("Short1!");
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain("tối thiểu 8 ký tự");
  });

  it("rejects passwords missing uppercase, lowercase, numbers, or symbols", () => {
    expect(service.validatePasswordStrength("nouppercase123!").isValid).toBe(false);
    expect(service.validatePasswordStrength("NOLOWERCASE123!").isValid).toBe(false);
    expect(service.validatePasswordStrength("NoNumbersHere!@#").isValid).toBe(false);
    expect(service.validatePasswordStrength("NoSymbols123456").isValid).toBe(false);
  });

  it("rejects common weak passwords", () => {
    expect(service.validatePasswordStrength("password123").isValid).toBe(false);
    expect(service.validatePasswordStrength("admin@123").isValid).toBe(false);
  });

  it("rejects passwords containing the user's email username prefix", () => {
    const res = service.validatePasswordStrength("NguyenVanA@2026!", "nguyenvana@gmail.com");
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain("phần tên email");
  });

  it("accepts strong compliant passwords", () => {
    const res = service.validatePasswordStrength("AoDaiVietNam@2026", "customer@gmail.com");
    expect(res.isValid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
});

