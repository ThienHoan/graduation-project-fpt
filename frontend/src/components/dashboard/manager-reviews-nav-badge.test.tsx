import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ManagerReviewsNavBadge } from "./manager-reviews-nav-badge";

const mockGetStaffReviews = vi.fn();

vi.mock("@/lib/api", () => ({
  getStaffReviews: (...args: unknown[]) => mockGetStaffReviews(...args),
}));

describe("ManagerReviewsNavBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when count is 0", async () => {
    mockGetStaffReviews.mockResolvedValue({
      success: true,
      data: [],
    });

    const { container } = render(<ManagerReviewsNavBadge />);
    await act(async () => { await Promise.resolve(); });

    expect(container).toBeEmptyDOMElement();
  });

  it("renders badge with correct count of reported+public reviews", async () => {
    mockGetStaffReviews.mockResolvedValue({
      success: true,
      data: [
        { id: "1", isReported: true, status: "public" },
        { id: "2", isReported: true, status: "public" },
        { id: "3", isReported: false, status: "public" }, // not reported
        { id: "4", isReported: true, status: "hidden" }, // not public
      ],
    });

    render(<ManagerReviewsNavBadge />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("displays 99+ when count exceeds 99", async () => {
    const reviews = Array.from({ length: 105 }, (_, i) => ({
      id: String(i),
      isReported: true,
      status: "public",
    }));
    mockGetStaffReviews.mockResolvedValue({ success: true, data: reviews });

    render(<ManagerReviewsNavBadge />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("renders nothing when API call fails", async () => {
    mockGetStaffReviews.mockRejectedValue(new Error("Network error"));

    const { container } = render(<ManagerReviewsNavBadge />);
    await act(async () => { await Promise.resolve(); });

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when API returns success=false", async () => {
    mockGetStaffReviews.mockResolvedValue({ success: false, data: null });

    const { container } = render(<ManagerReviewsNavBadge />);
    await act(async () => { await Promise.resolve(); });

    expect(container).toBeEmptyDOMElement();
  });

  it("polls again after 30 seconds", async () => {
    mockGetStaffReviews.mockResolvedValue({
      success: true,
      data: [{ id: "1", isReported: true, status: "public" }],
    });

    render(<ManagerReviewsNavBadge />);
    await act(async () => { await Promise.resolve(); });

    expect(mockGetStaffReviews).toHaveBeenCalledTimes(1);

    // advance past the 30s poll interval
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(mockGetStaffReviews).toHaveBeenCalledTimes(2);
  });
});
