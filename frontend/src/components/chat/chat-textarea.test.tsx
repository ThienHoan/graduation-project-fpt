import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatTextarea } from "./chat-textarea";

function ComposerHarness() {
  const [value, setValue] = useState("");
  return (
    <>
      <ChatTextarea
        aria-label="Tin nhắn"
        value={value}
        onValueChange={setValue}
      />
      <output data-testid="value">{value}</output>
      <button type="button" onClick={() => setValue("")}>
        Xoá
      </button>
    </>
  );
}

describe("ChatTextarea", () => {
  it("keeps Vietnamese IME composition intact and does not duplicate text", () => {
    render(<ComposerHarness />);
    const textarea = screen.getByRole("textbox", { name: "Tin nhắn" });

    fireEvent.compositionStart(textarea);
    fireEvent.input(textarea, { target: { value: "đ" } });
    fireEvent.input(textarea, { target: { value: "đe" } });
    fireEvent.input(textarea, { target: { value: "đẹp" } });
    fireEvent.compositionEnd(textarea, { data: "đẹp" });

    expect(textarea).toHaveValue("đẹp");
    expect(screen.getByTestId("value")).toHaveTextContent("đẹp");
  });

  it("syncs external value changes such as AI insert and clear-after-send", async () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ChatTextarea aria-label="Tin nhắn" value="" onValueChange={onValueChange} />,
    );
    const textarea = screen.getByRole("textbox", { name: "Tin nhắn" });

    await userEvent.type(textarea, "đẹp");
    expect(textarea).toHaveValue("đẹp");
    expect(onValueChange).toHaveBeenLastCalledWith("đẹp");

    // Ví dụ chèn câu trả lời AI: giá trị bên ngoài thay đổi → DOM được đồng bộ.
    rerender(
      <ChatTextarea aria-label="Tin nhắn" value="Gợi ý từ AI" onValueChange={onValueChange} />,
    );
    await waitFor(() => expect(textarea).toHaveValue("Gợi ý từ AI"));

    // Ví dụ gửi xong: state về rỗng → ô nhập cũng được xoá.
    rerender(
      <ChatTextarea aria-label="Tin nhắn" value="" onValueChange={onValueChange} />,
    );
    await waitFor(() => expect(textarea).toHaveValue(""));
  });
});
