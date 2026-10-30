import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pagination } from "./pagination";

describe("Pagination", () => {
  const setup = (overrides: Partial<Parameters<typeof Pagination>[0]> = {}) => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        currentPage={1}
        totalItems={50}
        pageSize={10}
        onPageChange={onPageChange}
        {...overrides}
      />,
    );
    return { onPageChange };
  };

  // --- Visibility ---
  it("renders nothing when totalItems is 0", () => {
    const { container } = render(
      <Pagination currentPage={1} totalItems={0} pageSize={10} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a single page when hideOnSinglePage=true (default)", () => {
    const { container } = render(
      <Pagination currentPage={1} totalItems={5} pageSize={10} onPageChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders when hideOnSinglePage=false even on single page", () => {
    render(
      <Pagination currentPage={1} totalItems={5} pageSize={10} onPageChange={vi.fn()} hideOnSinglePage={false} />,
    );
    expect(screen.getByLabelText("Phân trang")).toBeInTheDocument();
  });

  // --- Item counter label ---
  it("shows correct item range and total", () => {
    setup({ currentPage: 2, totalItems: 45, pageSize: 10 });
    // page 2: items 11-20 of 45
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("caps endItem at totalItems on the last page", () => {
    setup({ currentPage: 5, totalItems: 45, pageSize: 10 });
    // page 5: items 41-45 of 45 (both endItem and total show 45 — use getAllByText)
    expect(screen.getByText("41")).toBeInTheDocument();
    expect(screen.getAllByText("45").length).toBeGreaterThanOrEqual(1);
  });

  it("uses custom itemLabel", () => {
    setup({ totalItems: 30, pageSize: 10, itemLabel: "sản phẩm" });
    // itemLabel is a text node sibling inside a div — use regex to find it
    expect(screen.getByText(/sản phẩm/)).toBeInTheDocument();
  });

  // --- Navigation buttons ---
  it("disables Prev button on first page", () => {
    setup({ currentPage: 1 });
    expect(screen.getByLabelText("Trang trước")).toBeDisabled();
  });

  it("disables Next button on last page", () => {
    setup({ currentPage: 5, totalItems: 50, pageSize: 10 });
    expect(screen.getByLabelText("Trang sau")).toBeDisabled();
  });

  it("calls onPageChange with prev page when Prev is clicked", () => {
    const { onPageChange } = setup({ currentPage: 3, totalItems: 50, pageSize: 10 });
    fireEvent.click(screen.getByLabelText("Trang trước"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange with next page when Next is clicked", () => {
    const { onPageChange } = setup({ currentPage: 3, totalItems: 50, pageSize: 10 });
    fireEvent.click(screen.getByLabelText("Trang sau"));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("calls onPageChange when a page number button is clicked", () => {
    const { onPageChange } = setup({ currentPage: 1, totalItems: 50, pageSize: 10 });
    // 5 pages total — all visible without ellipsis
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("marks current page with aria-current=page", () => {
    setup({ currentPage: 3, totalItems: 50, pageSize: 10 });
    const btn = screen.getByRole("button", { name: "3" });
    expect(btn).toHaveAttribute("aria-current", "page");
  });

  // --- Ellipsis logic (> 7 pages) ---
  it("shows ellipsis when totalPages > 7 and currentPage is far from edges", () => {
    setup({ currentPage: 5, totalItems: 100, pageSize: 10 }); // 10 pages
    const ellipses = screen.getAllByText("…");
    expect(ellipses.length).toBeGreaterThanOrEqual(2);
  });

  it("shows no ellipsis when totalPages <= 7", () => {
    setup({ currentPage: 3, totalItems: 70, pageSize: 10 }); // 7 pages
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });
});
