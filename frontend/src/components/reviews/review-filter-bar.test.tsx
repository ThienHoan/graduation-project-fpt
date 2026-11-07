import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewFilterBar } from "./review-filter-bar";

describe("ReviewFilterBar", () => {
  const defaultProps = {
    ratingCounts: { 5: 10, 4: 2, 3: 1, 2: 0, 1: 0 },
    mediaCount: 5,
    onRatingChange: vi.fn(),
    onMediaChange: vi.fn(),
    onFitChange: vi.fn(),
    onSortChange: vi.fn(),
    onSearchChange: vi.fn(),
    onResetFilters: vi.fn(),
  };

  it("renders search input, sort options, and filter chips", () => {
    render(<ReviewFilterBar {...defaultProps} />);

    expect(
      screen.getByPlaceholderText("Tìm theo nội dung đánh giá hoặc tên người dùng..."),
    ).toBeInTheDocument();
    expect(screen.getByText("Tất cả")).toBeInTheDocument();
    expect(screen.getByText("5 sao")).toBeInTheDocument();
    expect(screen.getByText("Có ảnh / Video")).toBeInTheDocument();
    expect(screen.getByText("Vừa vặn")).toBeInTheDocument();
  });

  it("triggers rating filter on click", () => {
    const handleRatingChange = vi.fn();
    render(<ReviewFilterBar {...defaultProps} onRatingChange={handleRatingChange} />);

    fireEvent.click(screen.getByText("5 sao"));
    expect(handleRatingChange).toHaveBeenCalledWith(5);
  });

  it("triggers media filter on click", () => {
    const handleMediaChange = vi.fn();
    render(<ReviewFilterBar {...defaultProps} onMediaChange={handleMediaChange} />);

    fireEvent.click(screen.getByText("Có ảnh / Video"));
    expect(handleMediaChange).toHaveBeenCalledWith(true);
  });

  it("triggers search and reset filters", () => {
    const handleSearch = vi.fn();
    const handleReset = vi.fn();

    render(
      <ReviewFilterBar
        {...defaultProps}
        search="áo gấm"
        activeRating={5}
        onSearchChange={handleSearch}
        onResetFilters={handleReset}
      />,
    );

    // Reset filters button should appear when filter is active
    const resetBtn = screen.getByText("Xóa bộ lọc");
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
    expect(handleReset).toHaveBeenCalled();
  });
});

