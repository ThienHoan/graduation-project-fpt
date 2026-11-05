import { describe, expect, it, vi } from "vitest";
import { InspectionsService } from "./inspections.service";

const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const ASSET_ID = "00000000-0000-4000-8000-000000000003";

function createTestService(customFeeTable: any = null) {
  const tx = {
    inspectionSession: {
      findUnique: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        garmentAssetId: ASSET_ID,
        status: "in_progress",
        booking: {
          items: [{ garmentAssetId: ASSET_ID, depositAmount: 500000, dailyPrice: 100000 }],
        },
        garmentAsset: {
          id: ASSET_ID,
          purchaseCost: 600000,
          garment_sizes: { deposit_amount: 500000 },
        },
      }),
    },
    systemSetting: {
      findUnique: vi.fn().mockResolvedValue(
        customFeeTable ? { key: "damage_fee_table", value: customFeeTable } : null,
      ),
      upsert: vi.fn().mockImplementation(async ({ create, update }: any) => ({
        key: "damage_fee_table",
        value: update?.value ?? create?.value,
      })),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-001" }),
    },
    inspectionFinding: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: "finding-001",
        ...data,
        createdAt: new Date("2026-10-10T10:00:00.000Z"),
      })),
    },
  };

  const prisma = {
    runSerializable: vi.fn().mockImplementation(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx)),
    $transaction: vi.fn().mockImplementation(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx)),
    systemSetting: tx.systemSetting,
  };

  const realtime = {
    inspectionChanged: vi.fn(),
    bookingChanged: vi.fn(),
  };

  const service = new InspectionsService(prisma as never, realtime as never);
  return { service, tx };
}

describe("InspectionsService - Damage Fee Table & Auto-fill", () => {
  describe("getDamageFeeTable", () => {
    it("returns default damage fee table from definitions when DB has no setting", async () => {
      const { service } = createTestService(null);
      const res = await service.getDamageFeeTable();

      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data?.length).toBeGreaterThan(0);
      expect(res.data?.find((e: any) => e.label === "Rách nhỏ / sờn vải nhẹ")?.amount).toBe(50000);
    });

    it("returns custom damage fee table from database when present", async () => {
      const custom = [
        { label: "Bẩn nhẹ", amount: 20000, severity: "low" },
      ];
      const { service } = createTestService(custom);
      const res = await service.getDamageFeeTable();

      expect(res.data).toEqual(custom);
    });
  });

  describe("addFinding with auto-resolved penalty", () => {
    it("auto-populates fixed penaltyAmount and severity from table when omitted by staff", async () => {
      const { service, tx } = createTestService();
      const res = await service.addFinding(SESSION_ID, {
        findingType: "Rách nhỏ / sờn vải nhẹ",
        description: "Khách làm xước nhẹ mép áo",
      });

      expect(res.data?.penaltyAmount).toBe(50000);
      expect(res.data?.severity).toBe("low");
      expect(tx.inspectionFinding.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          findingType: "Rách nhỏ / sờn vải nhẹ",
          penaltyAmount: 50000,
          severity: "low",
        }),
      });
    });

    it("auto-calculates percentage penalty based on garment value (purchaseCost)", async () => {
      const { service, tx } = createTestService();
      // "Rách to / mất phụ kiện đính" có pct: 20
      // purchaseCost = 600,000 → 20% = 120,000
      const res = await service.addFinding(SESSION_ID, {
        findingType: "Rách to / mất phụ kiện đính",
      });

      expect(res.data?.penaltyAmount).toBe(120000);
      expect(res.data?.severity).toBe("medium");
      expect(tx.inspectionFinding.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          penaltyAmount: 120000,
          severity: "medium",
        }),
      });
    });

    it("preserves manual penaltyAmount when staff explicitly inputs it", async () => {
      const { service, tx } = createTestService();
      const res = await service.addFinding(SESSION_ID, {
        findingType: "Rách nhỏ / sờn vải nhẹ",
        penaltyAmount: 75000,
        severity: "medium",
      });

      expect(res.data?.penaltyAmount).toBe(75000);
      expect(res.data?.severity).toBe("medium");
      expect(tx.inspectionFinding.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          penaltyAmount: 75000,
          severity: "medium",
        }),
      });
    });
  });

  describe("updateDamageFeeTable", () => {
    it("successfully saves new damage fee entries and creates an audit log", async () => {
      const { service, tx } = createTestService();
      const newEntries = [
        { label: "Rách ren cao cấp", amount: 150000, severity: "high" as const },
        { label: "Mất trâm cài", pct: 50, severity: "severe" as const },
      ];

      const res = await service.updateDamageFeeTable("user-admin-01", newEntries);
      expect(res.data).toEqual(newEntries);
      expect(tx.systemSetting.upsert).toHaveBeenCalledWith({
        where: { key: "damage_fee_table" },
        create: {
          key: "damage_fee_table",
          value: newEntries,
        },
        update: {
          value: newEntries,
        },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: "user-admin-01",
          action: "UPDATE_DAMAGE_FEE_TABLE",
          entityType: "system_setting",
        }),
      });
    });

    it("rejects non-array or invalid entries", async () => {
      const { service } = createTestService();
      await expect(service.updateDamageFeeTable("user-01", null as any)).rejects.toThrow();
      await expect(
        service.updateDamageFeeTable("user-01", [{ label: "", severity: "low" } as any]),
      ).rejects.toThrow("Mỗi định mức lỗi phải có tên loại lỗi (label).");
      await expect(
        service.updateDamageFeeTable("user-01", [{ label: "Lỗi test", severity: "invalid_sev" as any }]),
      ).rejects.toThrow("Mức độ lỗi phải là: low, medium, high hoặc severe.");
    });
  });
});

