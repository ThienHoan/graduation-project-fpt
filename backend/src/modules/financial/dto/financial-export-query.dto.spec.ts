import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { describe, it, expect } from "vitest";
import { FinancialExportQueryDto } from "./financial-export-query.dto";

describe("FinancialExportQueryDto", () => {
  it("should validate valid query with format pdf and from/to", async () => {
    const dto = plainToInstance(FinancialExportQueryDto, {
      format: "pdf",
      from: "2026-11-01",
      to: "2026-11-10",
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.getStartDate()).toBe("2026-11-01");
    expect(dto.getEndDate()).toBe("2026-11-10");
  });

  it("should validate valid query with format xlsx and startDate/endDate", async () => {
    const dto = plainToInstance(FinancialExportQueryDto, {
      format: "xlsx",
      startDate: "2026-11-01",
      endDate: "2026-11-10",
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.getStartDate()).toBe("2026-11-01");
    expect(dto.getEndDate()).toBe("2026-11-10");
  });

  it("should fail when format is unsupported", async () => {
    const dto = plainToInstance(FinancialExportQueryDto, {
      format: "docx",
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("format");
  });

  it("should fail when from/to date format is not YYYY-MM-DD", async () => {
    const dto = plainToInstance(FinancialExportQueryDto, {
      format: "pdf",
      from: "01-11-2026",
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("from");
  });
});

