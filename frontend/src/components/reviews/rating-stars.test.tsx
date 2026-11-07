import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RatingStars } from "./rating-stars";

describe("RatingStars", () => {
  it("renders non-interactive star rating display", () => {
    const { container } = render(<RatingStars value={4} max={5} showScore />);

    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Đánh giá: 4 trên 5 sao",
    );
    expect(screen.getByText("4.0")).toBeInTheDocument();
    // 5 stars svg icons should be rendered
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(5);
  });

  it("renders interactive star rating and triggers onChange on click", () => {
    const handleChange = vi.fn();
    render(
      <RatingStars
        value={3}
        max={5}
        interactive
        showTooltip
        onChange={handleChange}
      />,
    );

    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    const buttons = screen.getAllByRole("radio");
    expect(buttons.length).toBe(5);

    // Click 5th star
    fireEvent.click(buttons[4]);
    expect(handleChange).toHaveBeenCalledWith(5);
  });

  it("shows tooltip text corresponding to hovered or selected star", () => {
    render(
      <RatingStars
        value={5}
        max={5}
        interactive
        showTooltip
      />,
    );

    expect(screen.getByText("Rất hài lòng")).toBeInTheDocument();
  });
});

