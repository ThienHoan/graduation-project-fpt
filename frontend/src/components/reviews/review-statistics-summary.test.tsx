import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewStatisticsSummary } from "./review-statistics-summary";

describe("ReviewStatisticsSummary", () => {
  const sampleStats = {
    averageRating: 4.8,
    total: 25,
    recommendPercentage: 96,
    mediaCount: 12,
    ratingCounts: { 5: 20, 4: 4, 3: 1, 2: 0, 1: 0 },
    ratingPercentages: { 5: 80, 4: 16, 3: 4, 2: 0, 1: 0 },
    fitCounts: { true_to_size: 21, tight: 3, loose: 1 },
    fitPercentages: { true_to_size: 84, tight: 12, loose: 4 },
  };

  it("renders statistics numbers, recommendation and fit breakdown", () => {
    render(<ReviewStatisticsSummary {...sampleStats} />);

    expect(screen.getByTestId("average-rating-display")).toHaveTextContent("4.8");
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("96% khách thuê khuyên dùng")).toBeInTheDocument();
    expect(screen.getByText("12 đánh giá có hình ảnh / video")).toBeInTheDocument();
    expect(screen.getByText("Vừa vặn chuẩn size")).toBeInTheDocument();
    expect(screen.getByText("84%")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();
  });

  it("triggers onSelectRatingFilter when clicking a star row", () => {
    const handleSelectFilter = vi.fn();
    render(
      <ReviewStatisticsSummary
        {...sampleStats}
        onSelectRatingFilter={handleSelectFilter}
      />,
    );

    const button5Stars = screen.getByTitle("Lọc đánh giá 5 sao");
    fireEvent.click(button5Stars);

    expect(handleSelectFilter).toHaveBeenCalledWith(5);
  });
});

