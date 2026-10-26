import { describe, expect, it } from "vitest";
import { buildQueryScope } from "./query-scope";

describe("QueryScope", () => {
  it("removes the excluded category and keeps the query broad", () => {
    const scope = buildQueryScope("Ngoài áo dài shop còn có trang phục gì?");

    expect(scope.filters.category).toBeUndefined();
    expect(scope.filters.keyword).toBeUndefined();
    expect(scope.browse).toBe(true);
    expect(scope.isExclusionQuestion).toBe(true);
    expect(scope.exclusions).toEqual([
      expect.objectContaining({
        kind: "category",
        categories: expect.arrayContaining(["Áo dài truyền thống", "Áo dài cách tân"]),
      }),
    ]);
  });

  it("recognizes a product listing excluding cổ phục", () => {
    const scope = buildQueryScope("Sản phẩm ngoài cổ phục");

    expect(scope.filters).toEqual({});
    expect(scope.browse).toBe(true);
    expect(scope.exclusions[0]).toMatchObject({
      kind: "category",
      categories: ["Cổ phục"],
    });
  });

  it("keeps áo dài and excludes only the red color", () => {
    const scope = buildQueryScope("Áo dài khác ngoài áo dài đỏ");

    expect(scope.filters.category).toEqual(["Áo dài truyền thống", "Áo dài cách tân"]);
    expect(scope.exclusions[0]).toMatchObject({
      kind: "attribute",
      colors: ["đỏ"],
    });
    expect(scope.exclusions[0].categories).toEqual(
      expect.arrayContaining(["Áo dài truyền thống", "Áo dài cách tân"]),
    );
  });

  it("keeps only the remaining áo dài subcategory when excluding one", () => {
    const scope = buildQueryScope("Áo dài khác ngoài áo dài cách tân");

    expect(scope.filters.category).toEqual(["Áo dài truyền thống"]);
    expect(scope.exclusions[0]).toMatchObject({
      kind: "category",
      categories: ["Áo dài cách tân"],
    });
  });

  it("keeps áo dài and excludes the product shown above", () => {
    const scope = buildQueryScope("Áo dài khác ngoài áo dài trên");

    expect(scope.filters.category).toEqual(["Áo dài truyền thống", "Áo dài cách tân"]);
    expect(scope.exclusions[0]).toMatchObject({
      kind: "product",
      refersToLastProduct: true,
    });
  });

  it("keeps áo dài and captures a product name to exclude", () => {
    const scope = buildQueryScope("Áo dài khác ngoài áo dài A");

    expect(scope.filters.category).toEqual(["Áo dài truyền thống", "Áo dài cách tân"]);
    expect(scope.exclusions[0]).toMatchObject({
      kind: "product",
      nameTokens: ["a"],
    });
  });

  it("captures a distinctive product name", () => {
    const scope = buildQueryScope("Áo dài khác ngoài áo dài đỏ thêu sen");

    expect(scope.exclusions[0]).toMatchObject({
      kind: "product",
      nameTokens: expect.arrayContaining(["theu", "sen"]),
    });
  });

  it("understands 'còn mẫu nào khác' within the current category", () => {
    const scope = buildQueryScope("Cổ phục còn mẫu nào khác");

    expect(scope.filters.category).toEqual(["Cổ phục"]);
    expect(scope.browse).toBe(true);
    expect(scope.exclusions[0]).toMatchObject({
      kind: "product",
      refersToLastProduct: true,
    });
  });

  it("keeps the requested category and excludes another category", () => {
    const scope = buildQueryScope("Không cần áo dài, xem váy");

    expect(scope.filters.category).toEqual(["Váy cưới"]);
    expect(scope.exclusions[0]).toMatchObject({
      kind: "category",
      categories: expect.arrayContaining(["Áo dài truyền thống", "Áo dài cách tân"]),
    });
  });

  it("supports multiple excluded categories", () => {
    const scope = buildQueryScope("Ngoài áo dài và vest");

    expect(scope.filters.category).toBeUndefined();
    expect(scope.exclusions[0].categories).toEqual(
      expect.arrayContaining(["Áo dài truyền thống", "Áo dài cách tân", "Vest & Suit"]),
    );
  });

  it("detects a broad catalog question without exclusions", () => {
    const scope = buildQueryScope("Shop có những loại nào?");

    expect(scope.filters).toEqual({});
    expect(scope.browse).toBe(true);
    expect(scope.isExclusionQuestion).toBe(false);
  });

  it("does not treat the discourse marker 'ngoài ra' as an exclusion", () => {
    const scope = buildQueryScope("Ngoài ra shop còn gì?");

    expect(scope.filters).toEqual({});
    expect(scope.browse).toBe(true);
    expect(scope.exclusions).toEqual([]);
  });

  it("does not treat a normal product search as an exclusion", () => {
    const scope = buildQueryScope("Áo dài đỏ chụp kỷ yếu");

    expect(scope.filters.category).toEqual(["Áo dài truyền thống", "Áo dài cách tân"]);
    expect(scope.filters.color).toEqual(expect.arrayContaining(["đỏ"]));
    expect(scope.filters.occasion).toEqual(["Kỷ yếu"]);
    expect(scope.browse).toBe(false);
    expect(scope.isExclusionQuestion).toBe(false);
    expect(scope.exclusions).toEqual([]);
  });
});
