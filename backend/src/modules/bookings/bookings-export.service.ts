import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import PDFDocument from "pdfkit";

export interface BookingHandoverSlipData {
  id: string;
  status: string;
  pickupMethod: string;
  rentalStartDate: Date | string;
  rentalEndDate: Date | string;
  rentalDays?: number;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  rentalTotal: number;
  depositTotal: number;
  voucherCode?: string | null;
  discountReason?: string | null;
  paymentMethod?: string | null;
  customer: {
    email: string;
    profile?: {
      fullName?: string | null;
      phone?: string | null;
    } | null;
  };
  deliveryAddress?: {
    receiverName?: string | null;
    phone?: string | null;
    streetAddress?: string | null;
    ward?: string | null;
    district?: string | null;
    city?: string | null;
  } | null;
  items: Array<{
    id: string;
    dailyPrice?: number;
    rentalDays?: number;
    rentalPrice: number;
    depositPrice: number;
    garment: {
      name: string;
    };
    size?: {
      sizeLabel?: string | null;
    } | null;
    garmentAsset?: {
      assetCode?: string | null;
    } | null;
  }>;
  accessories?: Array<{
    id: string;
    quantity?: number;
    unitPrice?: number;
    rentalPrice: number;
    depositPrice: number;
    accessory: {
      name: string;
    };
    accessoryAsset?: {
      assetCode?: string | null;
    } | null;
  }>;
  handover?: {
    status: string;
    conditionBeforeRental?: string | null;
    deliveredBy?: string | null;
    deliveryPersonName?: string | null;
    receivedBy?: string | null;
    receiverName?: string | null;
    receiverPhone?: string | null;
    receivedAt?: Date | string | null;
    confirmedAt?: Date | string | null;
    note?: string | null;
  } | null;
}

export type HandoverSlipData = BookingHandoverSlipData;

const CANDIDATE_UNICODE_FONTS = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
];

function findAvailableUnicodeFont(): string | null {
  for (const fontPath of CANDIDATE_UNICODE_FONTS) {
    try {
      if (fs.existsSync(fontPath)) {
        return fontPath;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

@Injectable()
export class BookingsExportService {
  async generateHandoverSlip(data: BookingHandoverSlipData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const isDelivery = data.pickupMethod === "delivery";
      const headerTitle = isDelivery
        ? "PHIẾU ĐÓNG GÓI & VẬN ĐƠN GIAO HÀNG (DELIVERY SLIP)"
        : "PHIẾU BÀN GIAO TRANG PHỤC & XÁC NHẬN CỌC";

      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        info: {
          Title: `${headerTitle} - ${data.id.slice(0, 8)}`,
          Author: "Co Phuc Viet Staff",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      const unicodeFontPath = findAvailableUnicodeFont();
      let hasUnicode = false;
      if (unicodeFontPath) {
        try {
          doc.font(unicodeFontPath);
          hasUnicode = true;
        } catch {
          doc.font("Helvetica");
        }
      } else {
        doc.font("Helvetica");
      }

      const txt = (text: string) => (hasUnicode ? text : removeAccents(text));
      const fmtMoney = (val: number) =>
        new Intl.NumberFormat("vi-VN").format(val) + " đ";
      const fmtDate = (d: Date | string) => {
        const date = typeof d === "string" ? new Date(d) : d;
        return date.toLocaleDateString("vi-VN");
      };

      // ── Header Banner ──
      doc.rect(40, 40, 515, 56).fill("#8B263E"); // Burgundy brand

      doc
        .fillColor("#FFFFFF")
        .fontSize(11.5)
        .text(txt("CỔ PHỤC VIỆT - HỆ THỐNG VẬN HÀNH & CHO THUÊ TRANG PHỤC"), 40, 49, {
          width: 515,
          align: "center",
        });

      doc
        .fontSize(13.5)
        .text(txt(headerTitle), 40, 69, {
          width: 515,
          align: "center",
        });

      // ── Metadata / Order Info ──
      const start = new Date(data.rentalStartDate);
      const end = new Date(data.rentalEndDate);
      const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const rentalDays = data.rentalDays ?? diffDays;

      doc.y = 106;
      doc
        .fillColor("#2B2625")
        .fontSize(9)
        .text(`${txt("Mã đơn:")} #${data.id.slice(0, 8).toUpperCase()}`, 45, 106)
        .text(`${txt("Hình thức:")} ${isDelivery ? txt("GIAO HÀNG TẬN NƠI (DELIVERY)") : txt("NHẬN TẠI QUẦY (STORE PICKUP)")}`, 300, 106)
        .text(`${txt("Thời hạn thuê:")} ${fmtDate(data.rentalStartDate)} → ${fmtDate(data.rentalEndDate)} (${rentalDays} ${txt("ngày")})`, 45, 120)
        .text(`${txt("Ngày in:")} ${new Date().toLocaleDateString("vi-VN")}`, 300, 120);

      // ── Customer / Shipping Info Box ──
      const custName = data.deliveryAddress?.receiverName || data.customer.profile?.fullName || "Khách hàng";
      const custPhone = data.deliveryAddress?.phone || data.customer.profile?.phone || "—";
      let addrText = "";
      let addrH = 0;

      if (isDelivery && data.deliveryAddress) {
        addrText = [
          data.deliveryAddress.streetAddress,
          data.deliveryAddress.ward,
          data.deliveryAddress.district,
          data.deliveryAddress.city,
        ].filter(Boolean).join(", ");
        doc.fontSize(8.5);
        addrH = doc.heightOfString(`${txt("Địa chỉ nhận:")} ${txt(addrText)}`, { width: 495, lineGap: 1.5 });
      }

      const custBoxH = isDelivery ? Math.max(46 + addrH, 54) : 44;
      doc.rect(40, 138, 515, custBoxH).fillAndStroke("#FBF9F5", "#E8E2D8");
      doc
        .fillColor("#8B263E")
        .fontSize(9)
        .text(txt(isDelivery ? "THÔNG TIN GIAO HÀNG CHO SHIPPER:" : "THÔNG TIN KHÁCH HÀNG:"), 50, 144);

      doc
        .fillColor("#333333")
        .fontSize(8.5)
        .text(`${txt("Họ tên:")} ${txt(custName)}`, 50, 158)
        .text(`${txt("Số điện thoại:")} ${custPhone}`, 300, 158);

      if (isDelivery && addrText) {
        doc.text(`${txt("Địa chỉ nhận:")} ${txt(addrText)}`, 50, 172, { width: 495, lineGap: 1.5 });
      }

      // ── Table of Items & Assets ──
      const tableStartY = 138 + custBoxH + 12;
      doc
        .fillColor("#8B263E")
        .fontSize(10.5)
        .text(txt("DANH MỤC HIỆN VẬT BÀN GIAO:"), 40, tableStartY);

      const thY = tableStartY + 16;
      doc.rect(40, thY, 515, 20).fill("#EFEAE2");
      doc
        .fillColor("#2B2625")
        .fontSize(8.5)
        .text(txt("STT"), 40, thY + 5, { width: 25, align: "center" })
        .text(txt("Tên Trang Phục / Hiện Vật"), 65, thY + 5, { width: 165 })
        .text(txt("Size"), 230, thY + 5, { width: 30, align: "center" })
        .text(txt("Mã Hiện Vật"), 260, thY + 5, { width: 75, align: "center" })
        .text(txt("Đơn Giá/Ngày"), 335, thY + 5, { width: 65, align: "right" })
        .text(txt("Thời Gian"), 400, thY + 5, { width: 45, align: "center" })
        .text(txt("Tiền Thuê"), 445, thY + 5, { width: 55, align: "right" })
        .text(txt("Tiền Cọc"), 500, thY + 5, { width: 55, align: "right" });

      let rowY = thY + 20;
      let counter = 1;

      // Garment items
      data.items.forEach((item, idx) => {
        doc.fontSize(8.5);
        const nameH = doc.heightOfString(txt(item.garment.name), { width: 165, lineGap: 1.5 });
        const rowH = Math.max(nameH + 8, 20);

        if (rowY + rowH > 740) {
          doc.addPage();
          rowY = 50;
        }

        if (idx % 2 === 1) doc.rect(40, rowY, 515, rowH).fill("#FDFBF7");
        doc
          .moveTo(40, rowY + rowH)
          .lineTo(555, rowY + rowH)
          .strokeColor("#E8E2D8")
          .lineWidth(0.5)
          .stroke();

        const itemDays = item.rentalDays ?? rentalDays;
        const dailyPrice = item.dailyPrice && item.dailyPrice > 0
          ? item.dailyPrice
          : (itemDays > 0 && item.rentalPrice > 0 ? Math.round(item.rentalPrice / itemDays) : item.rentalPrice);
        const lineTotal = dailyPrice > 0 ? dailyPrice * itemDays : (item.rentalPrice > 0 ? item.rentalPrice : 0);

        doc
          .fillColor("#333333")
          .fontSize(8.5)
          .text(String(counter++), 40, rowY + 4, { width: 25, align: "center" })
          .text(txt(item.garment.name), 65, rowY + 4, { width: 165, lineGap: 1.5 })
          .text(item.size?.sizeLabel ?? "F", 230, rowY + 4, { width: 30, align: "center" })
          .text(item.garmentAsset?.assetCode ?? txt("Chờ gán"), 260, rowY + 4, { width: 75, align: "center" })
          .text(fmtMoney(dailyPrice), 335, rowY + 4, { width: 65, align: "right" })
          .text(`${itemDays} ${txt("ngày")}`, 400, rowY + 4, { width: 45, align: "center" })
          .text(fmtMoney(lineTotal), 445, rowY + 4, { width: 55, align: "right" })
          .text(fmtMoney(Number(item.depositPrice)), 500, rowY + 4, { width: 55, align: "right" });
        rowY += rowH;
      });

      // Accessory items
      if (data.accessories && data.accessories.length > 0) {
        data.accessories.forEach((acc, idx) => {
          doc.fontSize(8.5);
          const accName = `[Phụ kiện] ${acc.accessory.name}`;
          const nameH = doc.heightOfString(txt(accName), { width: 165, lineGap: 1.5 });
          const rowH = Math.max(nameH + 8, 20);

          if (rowY + rowH > 740) {
            doc.addPage();
            rowY = 50;
          }

          if (idx % 2 === 1) doc.rect(40, rowY, 515, rowH).fill("#FDFBF7");
          doc
            .moveTo(40, rowY + rowH)
            .lineTo(555, rowY + rowH)
            .strokeColor("#E8E2D8")
            .lineWidth(0.5)
            .stroke();

          const qty = acc.quantity ?? 1;
          const uPrice = acc.unitPrice && acc.unitPrice > 0 ? acc.unitPrice : 0;
          const uPriceStr = uPrice > 0 ? fmtMoney(uPrice) : (acc.rentalPrice > 0 ? fmtMoney(acc.rentalPrice) : txt("Miễn phí"));

          doc
            .fillColor("#333333")
            .fontSize(8.5)
            .text(String(counter++), 40, rowY + 4, { width: 25, align: "center" })
            .text(txt(accName), 65, rowY + 4, { width: 165, lineGap: 1.5 })
            .text("—", 230, rowY + 4, { width: 30, align: "center" })
            .text(acc.accessoryAsset?.assetCode ?? txt("Kèm theo"), 260, rowY + 4, { width: 75, align: "center" })
            .text(uPriceStr, 335, rowY + 4, { width: 65, align: "right" })
            .text(`SL: ${qty}`, 400, rowY + 4, { width: 45, align: "center" })
            .text(fmtMoney(Number(acc.rentalPrice)), 445, rowY + 4, { width: 55, align: "right" })
            .text(fmtMoney(Number(acc.depositPrice)), 500, rowY + 4, { width: 55, align: "right" });
          rowY += rowH;
        });
      }

      // ── Financial Settlement Box (Quyết toán tiền thuê & cọc) ──
      const rentalTotal = Number(data.rentalTotal ?? 0);
      const shippingFee = Number(data.shippingFee ?? 0);
      const depositTotal = Number(data.depositTotal ?? 0);

      // Tính tổng giá niêm yết từ các dòng sản phẩm và phụ kiện
      const itemsSum = (data.items ?? []).reduce((s, it) => {
        const itemDays = it.rentalDays ?? rentalDays;
        const dPrice = it.dailyPrice && it.dailyPrice > 0
          ? it.dailyPrice
          : (itemDays > 0 && it.rentalPrice > 0 ? Math.round(it.rentalPrice / itemDays) : it.rentalPrice);
        return s + (dPrice > 0 ? dPrice * itemDays : Number(it.rentalPrice ?? 0));
      }, 0);
      const accsSum = (data.accessories ?? []).reduce((s, acc) => s + Number(acc.rentalPrice ?? 0), 0);
      const calculatedItemsTotal = itemsSum + accsSum;

      // Đảm bảo subtotal luôn là giá gốc niêm yết chưa giảm (khớp với bảng chi tiết hiện vật)
      let subtotal = Math.max(Number(data.subtotal ?? 0), calculatedItemsTotal, rentalTotal);
      let discountTotal = Number(data.discountTotal ?? 0);

      // Nếu có chênh lệch giữa giá gốc và giá thực tế mà discountTotal chưa có, tự động tính chiết khấu
      const diffDiscount = Math.max(0, subtotal + shippingFee - rentalTotal);
      if (diffDiscount > discountTotal) {
        discountTotal = diffDiscount;
      }
      if (discountTotal > 0 && subtotal < rentalTotal + discountTotal - shippingFee) {
        subtotal = rentalTotal + discountTotal - shippingFee;
      }
      const grandTotal = rentalTotal + depositTotal;

      const hasDiscount = discountTotal > 0;
      const hasShipping = isDelivery || shippingFee > 0;
      let settleBoxH = 88;
      if (hasDiscount) settleBoxH += 15;
      if (hasShipping) settleBoxH += 15;

      if (rowY + settleBoxH > 740) {
        doc.addPage();
        rowY = 50;
      }

      doc.rect(40, rowY, 515, settleBoxH).fillAndStroke("#FBF9F5", "#D0C8BE");

      // Title
      doc
        .fillColor("#8B263E")
        .fontSize(9.5)
        .text(txt("QUYẾT TOÁN TIỀN THUÊ & ĐẶT CỌC:"), 50, rowY + 6);

      let sY = rowY + 22;
      doc.fillColor("#333333").fontSize(8.5);

      // Line 1: Subtotal
      doc.text(`1. ${txt("Tạm tính tiền thuê")} (${rentalDays} ${txt("ngày")}):`, 50, sY);
      doc.text(fmtMoney(subtotal), 350, sY, { width: 195, align: "right" });
      sY += 15;

      // Line 2: Discount (if any)
      if (hasDiscount) {
        const reasonTag = data.discountReason
          ? ` (${data.discountReason})`
          : data.voucherCode
          ? ` (Mã: ${data.voucherCode})`
          : txt(" (Ưu đãi ngày thuê / Giảm giá)");
        doc.fillColor("#8B263E");
        doc.text(`2. (-) ${txt("Ưu đãi giảm giá")}${txt(reasonTag)}:`, 50, sY);
        doc.text(`- ${fmtMoney(discountTotal)}`, 350, sY, { width: 195, align: "right" });
        sY += 15;
        doc.fillColor("#333333");
      }

      // Line 3: Shipping (if delivery)
      if (hasShipping) {
        const shipNum = hasDiscount ? 3 : 2;
        doc.text(`${shipNum}. (+) ${txt("Phí vận chuyển giao hàng tận nơi")}:`, 50, sY);
        doc.text(shippingFee > 0 ? fmtMoney(shippingFee) : txt("Miễn phí"), 350, sY, { width: 195, align: "right" });
        sY += 15;
      }

      // Line 4: Rental Total
      doc.font(unicodeFontPath ?? "Helvetica");
      doc.fillColor("#1A1A1A").fontSize(9);
      const rentalLineNum = (hasDiscount ? 3 : 2) + (hasShipping ? 1 : 0);
      doc.text(`${rentalLineNum}. (=) ${txt("TỔNG TIỀN THUÊ THỰC TẾ (ĐÃ GIẢM)")}:`, 50, sY);
      doc.text(fmtMoney(rentalTotal), 350, sY, { width: 195, align: "right" });
      sY += 16;

      // Line 5: Deposit Total
      doc.text(`${rentalLineNum + 1}. (+) ${txt("TỔNG TIỀN CỌC ĐẢM BẢO HIỆN VẬT")}:`, 50, sY);
      doc.text(fmtMoney(depositTotal), 350, sY, { width: 195, align: "right" });
      sY += 15;

      // Divider line
      doc.moveTo(50, sY).lineTo(545, sY).strokeColor("#D0C8BE").lineWidth(0.5).stroke();
      sY += 4;

      // Line 6: Grand Total
      doc.fillColor("#8B263E").fontSize(10);
      doc.text(txt("(★) TỔNG THANH TOÁN (TIỀN THUÊ + CỌC):"), 50, sY);
      doc.text(fmtMoney(grandTotal), 350, sY, { width: 195, align: "right" });
      sY += 15;

      // Line 7: Payment method & status info
      const payMethodLabel =
        data.paymentMethod === "payos"
          ? "PayOS (Cổng trực tuyến)"
          : data.paymentMethod === "cash"
          ? "Tiền mặt tại quầy"
          : data.paymentMethod === "bank_transfer"
          ? "Chuyển khoản ngân hàng"
          : data.paymentMethod ?? "Tiền mặt";

      const bookingStatusLabel =
        data.status === "paid" || data.status === "renting" || data.status === "preparing" || data.status === "ready_for_pickup" || data.status === "delivering" || data.status === "completed"
          ? txt("Đã thanh toán đủ (100%)")
          : data.status === "awaiting_payment"
          ? txt("Chờ thanh toán")
          : txt("Đã xác nhận");

      doc.fillColor("#666666").fontSize(8);
      doc.text(`${txt("Hình thức thanh toán:")} ${txt(payMethodLabel)}  |  ${txt("Trạng thái:")} ${bookingStatusLabel}`, 50, sY);

      rowY += settleBoxH + 12;

      // ── Handover Details (if confirmed / recorded) ──
      const handover = data.handover;
      if (handover && handover.status === "CONFIRMED") {
        const condLabel =
          handover.conditionBeforeRental === "GOOD"
            ? "Tốt (Đạt chuẩn 100%, không phát hiện lỗi)"
            : handover.conditionBeforeRental === "MINOR_DAMAGE"
            ? `Có lỗi nhẹ ghi nhận: ${handover.note || "Đã kiểm đếm cùng khách"}`
            : handover.conditionBeforeRental || "Đã kiểm tra & bàn giao";

        const staffName =
          handover.deliveredBy || handover.deliveryPersonName || "Nhân viên Cổ Phục Việt";
        const receiver =
          handover.receivedBy || handover.receiverName || custName;
        const phone = handover.receiverPhone || custPhone;
        const handoverTime = handover.receivedAt || handover.confirmedAt
          ? new Date(handover.receivedAt || handover.confirmedAt!).toLocaleDateString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })
          : new Date().toLocaleDateString("vi-VN");

        doc.fontSize(8.5);
        const condH = doc.heightOfString(`${txt("Tình trạng lúc giao:")} ${txt(condLabel)}`, { width: 495, lineGap: 1.5 });
        const handoverBoxH = Math.max(38 + condH, 50);

        if (rowY + handoverBoxH > 740) {
          doc.addPage();
          rowY = 50;
        }

        doc.rect(40, rowY, 515, handoverBoxH).fillAndStroke("#F3F7F4", "#C7DBCB");
        doc
          .fillColor("#1E5631")
          .fontSize(9)
          .text(txt("BIÊN BẢN XÁC NHẬN BÀN GIAO & TÌNH TRẠNG HIỆN VẬT:"), 50, rowY + 6);

        doc
          .fillColor("#2B2625")
          .fontSize(8.5)
          .text(`${txt("Tình trạng lúc giao:")} ${txt(condLabel)}`, 50, rowY + 19, { width: 495, lineGap: 1.5 })
          .text(`${txt("Đại diện giao (Staff):")} ${txt(staffName)}`, 50, rowY + 21 + condH)
          .text(
            `${txt("Người nhận:")} ${txt(receiver)} ${phone && phone !== "—" ? `(${phone})` : ""}`,
            245,
            rowY + 21 + condH,
          )
          .text(`${txt("Thời gian:")} ${handoverTime}`, 410, rowY + 21 + condH);

        rowY += handoverBoxH + 12;
      }

      // ── Special Instructions / Notes ──
      if (isDelivery) {
        // Shipping Label Box
        const shipBoxH = 75;
        if (rowY + shipBoxH > 740) {
          doc.addPage();
          rowY = 50;
        }
        doc.rect(40, rowY, 515, shipBoxH).fillAndStroke("#FFFBEB", "#FDE68A"); // Yellow warning box
        doc.fillColor("#92400E").fontSize(9.5).text(txt("LƯU Ý VẬN CHUYỂN & MỞ HỘP (UNBOXING):"), 50, rowY + 7);
        doc
          .fillColor("#78350F")
          .fontSize(8.5)
          .text(txt("1. Gửi Shipper: Hàng cổ phục thêu đính thủ công cao cấp. Vui lòng vận chuyển nhẹ tay, không xếp chồng vật nặng."), 50, rowY + 23)
          .text(txt("2. Gửi Khách hàng: Vui lòng quay video lúc mở hộp unboxing kiểm tra số lượng và hiện trạng trang phục."), 50, rowY + 37)
          .text(txt("3. Xác nhận nhận hàng: Quét mã QR hoặc truy cập chi tiết đơn hàng trên web để bấm [Xác nhận đã nhận đồ]."), 50, rowY + 51);

        rowY += shipBoxH + 12;
      } else {
        // In-store detailed 4 terms & conditions box with dynamic heights
        doc.fontSize(8);
        const t1 = txt("1. Bảo quản chất liệu: Cổ phục tơ tằm, gấm thêu thủ công — Tuyệt đối không giặt máy, không tự ủi nhiệt độ cao hoặc phơi nắng gắt.");
        const t2 = txt("2. Tránh bám bẩn & hóa chất: Tránh xịt nước hoa đậm đặc trực tiếp lên sợi tơ, tránh dính rượu bia, dầu mỡ, son phấn và hóa chất tẩy rửa.");
        const t3 = txt("3. Giữ nguyên hiện trạng: Không tự ý cắt sửa form dáng, may vá, bấm kim hoặc đính kèm phụ kiện sắc nhọn làm xước, đứt sợi vải.");
        const t4 = txt("4. Quy định hoàn trả & bồi thường: Trả đồ đúng hạn trước 21h00 ngày hẹn trả. Mọi chậm trễ hoặc hư hỏng sẽ khấu trừ cọc theo Biểu phí bồi thường quy định; nếu thiệt hại vượt tiền cọc, khách hàng cam kết bồi thường phần chênh lệch.");

        const h1 = doc.heightOfString(t1, { width: 495, lineGap: 1.5 });
        const h2 = doc.heightOfString(t2, { width: 495, lineGap: 1.5 });
        const h3 = doc.heightOfString(t3, { width: 495, lineGap: 1.5 });
        const h4 = doc.heightOfString(t4, { width: 495, lineGap: 1.5 });

        const termsContentH = h1 + h2 + h3 + h4 + 16;
        const termsBoxH = Math.max(termsContentH + 24, 85);

        if (rowY + termsBoxH > 740) {
          doc.addPage();
          rowY = 50;
        }

        doc.rect(40, rowY, 515, termsBoxH).fillAndStroke("#FBF9F5", "#E8E2D8");
        doc.fillColor("#8B263E").fontSize(9.5).text(txt("ĐIỀU KHOẢN & QUY ĐỊNH BẢO QUẢN CỔ PHỤC:"), 50, rowY + 6);

        let ty = rowY + 21;
        doc.fillColor("#333333").fontSize(8);
        doc.text(t1, 50, ty, { width: 495, lineGap: 1.5 });
        ty += h1 + 4;
        doc.text(t2, 50, ty, { width: 495, lineGap: 1.5 });
        ty += h2 + 4;
        doc.text(t3, 50, ty, { width: 495, lineGap: 1.5 });
        ty += h3 + 4;
        doc.text(t4, 50, ty, { width: 495, lineGap: 1.5 });

        rowY += termsBoxH + 12;
      }

      // ── Signatures ──
      const sigHeight = 75;
      if (rowY + sigHeight > 780) {
        doc.addPage();
        rowY = 50;
      }

      const sigY = Math.max(rowY + 15, 680);
      const finalSigY = sigY + sigHeight > 800 ? rowY + 15 : sigY;

      if (isDelivery) {
        doc
          .fillColor("#2B2625")
          .fontSize(9.5)
          .text(txt("NHÂN VIÊN ĐÓNG GÓI"), 65, finalSigY, { width: 170, align: "center" })
          .text(txt("ĐƠN VỊ VẬN CHUYỂN / SHIPPER"), 340, finalSigY, { width: 180, align: "center" });
        doc
          .fillColor("#888888")
          .fontSize(8)
          .text(txt("(Ký xác nhận đã đóng đủ hiện vật)"), 65, finalSigY + 14, { width: 170, align: "center" })
          .text(txt("(Ký nhận nguyên kiện từ tiệm)"), 340, finalSigY + 14, { width: 180, align: "center" });
      } else {
        doc
          .fillColor("#2B2625")
          .fontSize(9.5)
          .text(txt("ĐẠI DIỆN CỬA HÀNG (STAFF)"), 65, finalSigY, { width: 170, align: "center" })
          .text(txt("NGƯỜI THUÊ (KHÁCH HÀNG)"), 340, finalSigY, { width: 180, align: "center" });
        doc
          .fillColor("#888888")
          .fontSize(8)
          .text(txt("(Ký xác nhận bàn giao đúng hiện vật)"), 65, finalSigY + 14, { width: 170, align: "center" })
          .text(txt("(Ký xác nhận đã kiểm tra đồ, nộp cọc & đồng ý điều khoản)"), 340, finalSigY + 14, { width: 180, align: "center" });
      }

      doc.end();
    });
  }
}
