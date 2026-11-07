import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewItemCard } from "./review-item-card";
import { ReviewResponse } from "@/lib/api";

describe("ReviewItemCard", () => {
  const mockReview: ReviewResponse = {
    id: "review-1",
    customerId: "cust-1",
    garmentId: "garment-1",
    bookingId: "booking-1",
    rating: 5,
    comment: "Áo dài Nhật Bình rất lộng lẫy và tinh tế.",
    fitFeedback: "true_to_size",
    status: "public",
    images: ["https://cdn.example.com/img1.jpg"],
    video: null,
    staffReply: "Cảm ơn bạn đã lựa chọn Cổ Phục!",
    staffReplyAt: "2026-03-02T10:00:00Z",
    staffRepliedBy: "staff-1",
    isReported: false,
    reportedReason: null,
    reportedAt: null,
    reportedBy: null,
    editCount: 0,
    isLocked: false,
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-01T10:00:00Z",
    customer: {
      id: "cust-1",
      email: "lan@example.com",
      profile: {
        fullName: "Nguyễn Thị Lan",
      },
    },
  };

  it("renders reviewer details, verified badge, fit tag, and comment", () => {
    render(<ReviewItemCard review={mockReview} />);

    expect(screen.getByText("Nguyễn Thị Lan")).toBeInTheDocument();
    expect(screen.getByText("Đã thuê trang phục")).toBeInTheDocument();
    expect(screen.getByText("Vừa vặn chuẩn size")).toBeInTheDocument();
    expect(screen.getByText("Áo dài Nhật Bình rất lộng lẫy và tinh tế.")).toBeInTheDocument();
    expect(screen.getByText("Phản hồi từ Cổ Phục Store")).toBeInTheDocument();
    expect(screen.getByText("Cảm ơn bạn đã lựa chọn Cổ Phục!")).toBeInTheDocument();
    expect(screen.getByAltText("Ảnh đánh giá 1")).toBeInTheDocument();
  });

  it("renders edit/delete actions menu when user is the review author", () => {
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();

    render(
      <ReviewItemCard
        review={mockReview}
        currentUserId="cust-1"
        onEdit={handleEdit}
        onDelete={handleDelete}
      />,
    );

    const menuButton = screen.getByLabelText("Tùy chọn đánh giá");
    expect(menuButton).toBeInTheDocument();

    fireEvent.click(menuButton);
    expect(screen.getByText("Chỉnh sửa")).toBeInTheDocument();
    expect(screen.getByText("Xóa đánh giá")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Chỉnh sửa"));
    expect(handleEdit).toHaveBeenCalledWith(mockReview);
  });
});

