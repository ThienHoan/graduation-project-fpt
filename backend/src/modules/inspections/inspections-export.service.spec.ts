import { describe, it, expect } from "vitest";
import { InspectionsExportService } from "./inspections-export.service";

describe("InspectionsExportService", () => {
  const service = new InspectionsExportService();

  const baseMock = {
    id: "71263444",
    bookingId: "3C00B0A6",
    status: "completed",
    inspectedAt: new Date("2026-10-15T10:30:00Z"),
    inspectorName: "NhanVienThien",
    customer: {
      fullName: "NgọcSơn",
      phone: null,
      email: "ngocson@example.com",
    },
    garmentAsset: {
      assetCode: "ADT-003-C",
      garmentName: "Áo dài tím hoa cúc",
      sizeLabel: "L",
    },
    booking: {
      rentalStartDate: new Date("2026-10-10T00:00:00Z"),
      rentalEndDate: new Date("2026-10-15T00:00:00Z"),
      depositTotal: 1050000,
      rentalTotal: 500000,
    },
    note: "[Duyệt bởi Manager] Đã kiểm tra bằng chứng hình ảnh và xác nhận mức bồi thường hư hại cho đơn. (Điều chỉnh mức phạt: 1.500.000đ -> 900.000đ) | Ghi chú staff: Bộ trang phục bị hư hỏng nghiêm trọng.",
  };

  it("should generate a valid PDF with manager-approved findings and staff strikethrough", async () => {
    // Mô phỏng sau khi Manager duyệt: staff finding bị gạch ngang, manager finding tính tổng
    const buffer = await service.generateInspectionSlip({
      ...baseMock,
      findings: [
        {
          id: "finding-1",
          findingType: "[Staff thẩm định] Hư hỏng toàn diện",
          severity: "severe",
          description:
            "Tại phần tà áo trước bên phải, có vết ố bẩn lớn loang màu và đường chỉ thêu bị rút sợi nghiêm trọng.",
          penaltyAmount: 1500000,
          isStaffDraft: true, // Hàng gạch ngang — không tính vào tổng
        },
        {
          id: "finding-2",
          findingType: "[Quản lý phê duyệt] Hư hỏng toàn diện",
          severity: "severe",
          description:
            "Đã kiểm tra bằng chứng hình ảnh & xác nhận mức bồi thường hư hại cho đơn hàng. Mức phạt điều chỉnh.",
          penaltyAmount: 900000, // Tổng phạt chốt = 900.000đ
          isStaffDraft: false,
        },
      ],
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should handle 0 findings gracefully (100% deposit refund)", async () => {
    const buffer = await service.generateInspectionSlip({
      ...baseMock,
      findings: [],
      note: null,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should handle findings with no manager override (staff only, no strikethrough)", async () => {
    const buffer = await service.generateInspectionSlip({
      ...baseMock,
      findings: [
        {
          id: "finding-1",
          findingType: "Vết bẩn nhẹ ở tà áo",
          severity: "low",
          description: "Vết ố trà nhẹ ở tay áo bên trái, có thể giặt sạch.",
          penaltyAmount: 50000,
          isStaffDraft: false,
        },
      ],
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should handle multi-page overflow when many findings are present", async () => {
    const manyFindings = Array.from({ length: 8 }, (_, i) => ({
      id: `finding-${i + 1}`,
      findingType: `[Staff thẩm định] Lỗi hư hại nghiêm trọng mục số ${i + 1}`,
      severity: "severe",
      description: `Mô tả chi tiết lỗi phát hiện số ${i + 1}: Vết bẩn loang lổ nhiều vị trí kèm theo rách chỉ viền tà áo, ảnh hưởng nghiêm trọng đến giá trị sử dụng của hiện vật cổ phục truyền thống.`,
      penaltyAmount: 250000,
      isStaffDraft: i % 2 === 0, // Xen kẽ staff draft và manager
    }));

    const buffer = await service.generateInspectionSlip({
      ...baseMock,
      findings: manyFindings,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
