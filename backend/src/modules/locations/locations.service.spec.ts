/**
 * @blast-radius: core, api
 * Behavioral tests for LocationsService & Shipping Regions logistics.
 */
import { describe, expect, it, vi } from "vitest";
import { LocationsService } from "./locations.service";
import { classifyRoute, detectRegion, VIETTEL_POST_FEES } from "./shipping-regions";

describe("Shipping Regions Logic", () => {
  describe("detectRegion", () => {
    it("detects northern region for Hanoi and northern provinces", () => {
      expect(detectRegion("Số 10 Tràng Tiền, Hoàn Kiếm, Hà Nội")).toBe("north");
      expect(detectRegion("Hải Phòng")).toBe("north");
      expect(detectRegion("TP Bắc Ninh")).toBe("north");
    });

    it("detects central region for Da Nang, Hue and central provinces", () => {
      expect(detectRegion("Đà Nẵng")).toBe("central");
      expect(detectRegion("Thừa Thiên Huế")).toBe("central");
      expect(detectRegion("Khánh Hòa")).toBe("central");
      expect(detectRegion("Lâm Đồng")).toBe("central");
    });

    it("detects southern region for HCM, Can Tho and Mekong delta", () => {
      expect(detectRegion("Quận 1, TP. Hồ Chí Minh")).toBe("south");
      expect(detectRegion("Sài Gòn")).toBe("south");
      expect(detectRegion("Bình Dương")).toBe("south");
      expect(detectRegion("Cần Thơ")).toBe("south");
    });

    it("returns null for empty or non-matching string", () => {
      expect(detectRegion("")).toBeNull();
      expect(detectRegion("   ")).toBeNull();
      expect(detectRegion(null)).toBeNull();
      expect(detectRegion(undefined)).toBeNull();
      expect(detectRegion("Tokyo, Japan")).toBeNull();
    });

    it("prioritizes the province placed at the end of the address", () => {
      // Đường Hà Nội tại TP. Hồ Chí Minh -> miền Nam (Hồ Chí Minh xuất hiện sau)
      expect(detectRegion("123 Đường Hà Nội, Quận Thủ Đức, TP. Hồ Chí Minh")).toBe("south");
    });
  });

  describe("classifyRoute", () => {
    it("returns intra-region (nội miền) when sender and receiver are in the same region", () => {
      const northToNorth = classifyRoute("north", "north");
      expect(northToNorth).toEqual(VIETTEL_POST_FEES.intra);
      expect(northToNorth.fee).toBe(24000);

      const centralToCentral = classifyRoute("central", "central");
      expect(centralToCentral.type).toBe("intra");
    });

    it("returns inter-region (liên miền) between North and South", () => {
      const northToSouth = classifyRoute("north", "south");
      expect(northToSouth).toEqual(VIETTEL_POST_FEES.inter);
      expect(northToSouth.fee).toBe(38000);

      const southToNorth = classifyRoute("south", "north");
      expect(southToNorth).toEqual(VIETTEL_POST_FEES.inter);
    });

    it("returns adjacent-region (cận miền) between Central and North or Central and South", () => {
      const centralToSouth = classifyRoute("central", "south");
      expect(centralToSouth).toEqual(VIETTEL_POST_FEES.adjacent);
      expect(centralToSouth.fee).toBe(32000);

      const northToCentral = classifyRoute("north", "central");
      expect(northToCentral).toEqual(VIETTEL_POST_FEES.adjacent);
    });
  });
});

describe("LocationsService", () => {
  function createService(addressData: Record<string, any> = {}, settingData: Record<string, any> = {}) {
    const config = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === "GOGODUK_BASE_URL") return "https://api.gogoduk.com";
        return null;
      }),
    };

    const prisma = {
      address: {
        findUnique: vi.fn().mockResolvedValue({
          id: "addr-1",
          line1: "123 Nguyễn Văn Linh",
          ward: "Nam Dương",
          district: "Hải Châu",
          city: "Đà Nẵng",
          latitude: 16.06,
          longitude: 108.22,
          ...addressData,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      systemSetting: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          const val = settingData[where.key];
          return Promise.resolve(val !== undefined ? { key: where.key, value: val } : null);
        }),
      },
    };

    const service = new LocationsService(config as any, prisma as any);
    return { service, prisma, config };
  }

  describe("estimateShippingFee", () => {
    it("estimates intra-region shipping fee when customer is in the same region as store (central)", async () => {
      const { service } = createService({ city: "Đà Nẵng", latitude: 16.06, longitude: 108.22 });

      const result = await service.estimateShippingFee("addr-1");

      expect(result.routeType).toBe("intra");
      expect(result.estimatedFee).toBe(24000);
      expect(result.customerLat).toBe(16.06);
      expect(result.customerLng).toBe(108.22);
    });

    it("estimates adjacent-region shipping fee when customer is in South and store is in Central", async () => {
      const { service } = createService({ city: "Hồ Chí Minh", latitude: 10.77, longitude: 106.69 });

      const result = await service.estimateShippingFee("addr-1");

      expect(result.routeType).toBe("adjacent");
      expect(result.estimatedFee).toBe(32000);
    });

    it("respects system settings fee override if configured by manager", async () => {
      const { service } = createService(
        { city: "Đà Nẵng", latitude: 16.06, longitude: 108.22 },
        { shipping_fee_intra: 20000 },
      );

      const result = await service.estimateShippingFee("addr-1");

      expect(result.routeType).toBe("intra");
      expect(result.estimatedFee).toBe(20000);
    });

    it("throws 404 NotFoundException if address is not found", async () => {
      const { service, prisma } = createService();
      prisma.address.findUnique.mockResolvedValue(null);

      await expect(service.estimateShippingFee("invalid-id")).rejects.toThrow("Không tìm thấy địa chỉ.");
    });
  });
});
