import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewDeleteDialog } from "./review-delete-dialog";

describe("ReviewDeleteDialog", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <ReviewDeleteDialog
        isOpen={false}
        isDeleting={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders confirmation modal when isOpen is true and triggers onConfirm", () => {
    const handleConfirm = vi.fn();
    const handleClose = vi.fn();

    render(
      <ReviewDeleteDialog
        isOpen={true}
        isDeleting={false}
        onConfirm={handleConfirm}
        onClose={handleClose}
      />,
    );

    expect(screen.getByText("Xác nhận xóa đánh giá")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Bạn có chắc chắn muốn xóa đánh giá này\? Hành động này sẽ xóa vĩnh viễn/i,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Xác nhận xóa"));
    expect(handleConfirm).toHaveBeenCalled();

    fireEvent.click(screen.getByText("Hủy bỏ"));
    expect(handleClose).toHaveBeenCalled();
  });
});

