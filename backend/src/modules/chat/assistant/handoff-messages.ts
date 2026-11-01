/**
 * Câu thông báo gửi cho khách mỗi khi hội thoại được chuyển cho nhân viên.
 *
 * Mọi tin nhắn rơi vào nhánh STAFF (hoặc không router hiểu được) đều phải có
 * phản hồi cho khách; không im lặng và không phụ thuộc cờ `shouldAck` của
 * HandoffService. Khách cần biết tin của mình đã được ghi nhận.
 */
const GENERAL_HANDOFF_ACK =
  "Dạ em đã ghi nhận và chuyển cho nhân viên hỗ trợ anh/chị ngay ạ.";

const ORDER_HANDOFF_ACK =
  "Dạ em đã ghi nhận đơn của anh/chị và chuyển nhân viên kiểm tra, xử lý ngay ạ.";

export function handoffAckForReason(reason: string | null | undefined): string {
  const value = (reason ?? "").toLowerCase();
  const isOrderRelated =
    value.startsWith("booking_card") ||
    value.includes("order") ||
    value.includes("delivery") ||
    value === "urgent_rental";
  return isOrderRelated ? ORDER_HANDOFF_ACK : GENERAL_HANDOFF_ACK;
}
