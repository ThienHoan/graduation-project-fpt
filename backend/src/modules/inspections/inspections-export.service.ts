import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import PDFDocument from "pdfkit";

export interface InspectionSlipData {
  id: string;
  bookingId: string;
  status: string;
  inspectedAt: Date | string;
  inspectorName?: string | null;
  customer: {
    fullName?: string | null;
    phone?: string | null;
    email: string;
  };
  garmentAsset: {
    assetCode: string;
    garmentName: string;
    sizeLabel?: string | null;
  };
  booking: {
    rentalStartDate: Date | string;
    rentalEndDate: Date | string;
    depositTotal: number;
    rentalTotal: number;
  };
  findings: Array<{
    id: string;
    findingType: string;
    severity: string;
    description?: string | null;
    penaltyAmount: number;
    /**
     * true  → bản ghi đề xuất ban đầu của Staff (đã bị Manager override),
     *         hiển thị gạch ngang, không tính vào tổng tiền phạt quyết toán.
     * false → bản ghi chính thức (Manager đã duyệt hoặc Staff duy nhất).
     */
    isStaffDraft?: boolean;
  }>;
  note?: string | null;
}

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
export class InspectionsExportService {
  async generateInspectionSlip(data: InspectionSlipData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        info: {
          Title: `Bien Ban Kiem Tra - ${data.id.slice(0, 8)}`,
          Author: data.inspectorName ?? "Co Phuc Viet Staff",
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
        .text(txt("CỔ PHỤC VIỆT - HỆ THỐNG VẬN HÀNH & KIỂM TRA HIỆN VẬT"), 40, 49, {
          width: 515,
          align: "center",
        });

      doc
        .fontSize(13.5)
        .text(txt("BIÊN BẢN KIỂM TRA HOÀN TRẢ & QUYẾT TOÁN CỌC"), 40, 69, {
          width: 515,
          align: "center",
        });

      // ── Metadata Box ──
      doc.y = 106;
      doc
        .fillColor("#2B2625")
        .fontSize(9)
        .text(`${txt("Mã biên bản:")} #${data.id.slice(0, 8).toUpperCase()}`, 45, 106)
        .text(`${txt("Mã đơn thuê:")} #${data.bookingId.slice(0, 8).toUpperCase()}`, 300, 106)
        .text(`${txt("Thời gian kiểm tra:")} ${fmtDate(data.inspectedAt)}`, 45, 120)
        .text(`${txt("Nhân viên kiểm tra:")} ${txt(data.inspectorName ?? "Staff")}`, 300, 120);

      // Customer & Asset Information
      doc.rect(40, 138, 515, 48).fillAndStroke("#FBF9F5", "#E8E2D8");
      doc
        .fillColor("#8B263E")
        .fontSize(9)
        .text(txt("THÔNG TIN KHÁCH HÀNG & TRANG PHỤC KIỂM TRA:"), 50, 144);

      doc
        .fillColor("#333333")
        .fontSize(8.5)
        .text(`${txt("Khách hàng:")} ${txt(data.customer.fullName ?? data.customer.email)}`, 50, 158)
        .text(`${txt("SĐT:")} ${data.customer.phone ?? "—"}`, 300, 158)
        .text(`${txt("Trang phục:")} ${txt(data.garmentAsset.garmentName)} (Size: ${data.garmentAsset.sizeLabel ?? "F"})`, 50, 170)
        .text(`${txt("Mã hiện vật:")} ${data.garmentAsset.assetCode}`, 300, 170);

      // ── Findings Table Header Helper ──
      const drawTableHeader = (yPos: number) => {
        doc
          .fillColor("#8B263E")
          .fontSize(10.5)
          .text(txt("DANH MỤC LỖI HƯ HỎNG & ĐỊNH MỨC BỒI THƯỜNG:"), 40, yPos);

        const thY = yPos + 16;
        doc.rect(40, thY, 515, 20).fill("#EFEAE2");
        doc
          .fillColor("#2B2625")
          .fontSize(8.5)
          .text(txt("STT"), 40, thY + 5, { width: 30, align: "center" })
          .text(txt("Loại Lỗi Phát Hiện"), 74, thY + 5, { width: 110 })
          .text(txt("Mức Độ"), 186, thY + 5, { width: 56, align: "center" })
          .text(txt("Mô Tả Chi Tiết"), 246, thY + 5, { width: 196 })
          .text(txt("Tiền Phạt"), 444, thY + 5, { width: 104, align: "right" });

        return thY + 20;
      };

      let rowY = drawTableHeader(196);
      let totalPenalty = 0;

      if (data.findings.length === 0) {
        doc.rect(40, rowY, 515, 26).fillAndStroke("#FDFBF7", "#E8E2D8");
        doc
          .fillColor("#166534") // Green
          .fontSize(9)
          .text(txt("Không phát hiện lỗi hư hỏng. Trang phục nguyên vẹn đủ điều kiện hoàn 100% cọc."), 50, rowY + 7, {
            width: 495,
            align: "center",
          });
        rowY += 26;
      } else {
        data.findings.forEach((f, idx) => {
          const isStrikethrough = f.isStaffDraft === true;

          // Chỉ tính vào tổng các bản ghi KHÔNG phải staff draft (manager đã duyệt hoặc bình thường)
          if (!isStrikethrough) {
            totalPenalty += Number(f.penaltyAmount);
          }

          // Màu chữ: staff draft → xám nhạt gạch ngang; manager / normal → đen bình thường
          const textColor = isStrikethrough ? "#AAAAAA" : "#333333";
          const severityColor = isStrikethrough ? "#AAAAAA" : "#555555";

          // Dynamic calculation of row height based on text lengths
          doc.fontSize(8.5);
          const typeH = doc.heightOfString(txt(f.findingType), { width: 110, lineGap: 1.5 });
          const descText = f.description ? txt(f.description.trim()) : "—";
          const descH = doc.heightOfString(descText, { width: 196, lineGap: 1.5 });
          const sevH = doc.heightOfString(txt(f.severity.toUpperCase()), { width: 56 });
          const penaltyText = fmtMoney(Number(f.penaltyAmount));
          const penH = doc.heightOfString(penaltyText, { width: 104 });

          const cellContentH = Math.max(typeH, descH, sevH, penH, 12);
          const rowPaddingTop = 5;
          const rowPaddingBottom = 5;
          const rowH = cellContentH + rowPaddingTop + rowPaddingBottom;

          // Check if row overflows the page
          if (rowY + rowH > 740) {
            doc.addPage();
            // Draw mini continuation banner
            doc.rect(40, 40, 515, 24).fill("#8B263E");
            doc
              .fillColor("#FFFFFF")
              .fontSize(9.5)
              .text(txt("CỔ PHỤC VIỆT - BIÊN BẢN KIỂM TRA & QUYẾT TOÁN CỌC (TIẾP THEO)"), 40, 46, {
                width: 515,
                align: "center",
              });
            rowY = drawTableHeader(72);
          }

          // Row background: staff draft dùng màu be nhạt hơn để phân biệt trực quan
          if (isStrikethrough) {
            doc.rect(40, rowY, 515, rowH).fill("#F7F4F0");
          } else if (idx % 2 === 1) {
            doc.rect(40, rowY, 515, rowH).fill("#FDFBF7");
          }

          // Row border bottom
          doc
            .moveTo(40, rowY + rowH)
            .lineTo(555, rowY + rowH)
            .strokeColor("#E8E2D8")
            .lineWidth(0.5)
            .stroke();

          // ── Cell contents ──
          doc.fillColor(textColor).fontSize(8.5);

          // STT
          doc.text(String(idx + 1), 40, rowY + rowPaddingTop, { width: 30, align: "center" });

          // Loại lỗi
          doc.text(txt(f.findingType), 74, rowY + rowPaddingTop, { width: 110, lineGap: 1.5 });
          if (isStrikethrough) {
            // Vẽ đường gạch ngang qua cột "Loại Lỗi" và "Mô Tả"
            const lineY = rowY + rowPaddingTop + typeH / 2;
            doc
              .moveTo(74, lineY)
              .lineTo(440, lineY)
              .strokeColor("#AAAAAA")
              .lineWidth(0.8)
              .stroke();
          }

          // Mức độ
          doc.fillColor(severityColor).text(txt(f.severity.toUpperCase()), 186, rowY + rowPaddingTop, { width: 56, align: "center" });

          // Mô tả chi tiết
          doc.fillColor(textColor).text(descText, 246, rowY + rowPaddingTop, { width: 196, lineGap: 1.5 });

          // Tiền phạt: staff draft → hiển thị xám + gạch ngang tiền; manager → đỏ đậm để nổi bật
          if (isStrikethrough) {
            doc.fillColor("#AAAAAA").text(penaltyText, 444, rowY + rowPaddingTop, { width: 104, align: "right" });
            // Gạch ngang qua số tiền
            const penLineY = rowY + rowPaddingTop + penH / 2;
            doc
              .moveTo(444, penLineY)
              .lineTo(548, penLineY)
              .strokeColor("#AAAAAA")
              .lineWidth(0.8)
              .stroke();
          } else {
            doc.fillColor("#8B263E").text(penaltyText, 444, rowY + rowPaddingTop, { width: 104, align: "right" });
          }

          rowY += rowH;
        });

        // Nếu có manager findings, thêm chú thích nhỏ bên dưới bảng
        const hasStaffDrafts = data.findings.some((f) => f.isStaffDraft);
        if (hasStaffDrafts) {
          doc
            .fillColor("#888888")
            .fontSize(7.5)
            .text(
              txt("(*) Hàng gạch ngang: đề xuất ban đầu của Nhân viên — đã được Quản lý điều chỉnh và chốt mức phạt cuối cùng."),
              44,
              rowY + 3,
              { width: 511 },
            );
          rowY += 14;
        }
      }

      // Summary Total Row
      if (rowY + 22 > 740) {
        doc.addPage();
        rowY = 50;
      }
      doc.rect(40, rowY, 515, 22).fillAndStroke("#EFEAE2", "#D0C8BE");
      doc
        .fillColor("#1A1A1A")
        .fontSize(9)
        .text(txt("TỔNG TIỀN PHẠT KHẤU TRỪ:"), 74, rowY + 6, { width: 360 })
        .text(fmtMoney(totalPenalty), 444, rowY + 6, { width: 104, align: "right" });

      rowY += 30;

      // ── Deposit Settlement Calculation Box ──
      const depositTotal = Number(data.booking.depositTotal);
      const refundRemaining = Math.max(0, depositTotal - totalPenalty);
      const customerExtraOwed = Math.max(0, totalPenalty - depositTotal);
      const settlementBoxH = 72;

      if (rowY + settlementBoxH > 740) {
        doc.addPage();
        rowY = 50;
      }

      doc.rect(40, rowY, 515, settlementBoxH).fillAndStroke("#FBF9F5", "#D0C8BE");
      doc
        .fillColor("#8B263E")
        .fontSize(9.5)
        .text(txt("QUYẾT TOÁN TIỀN CỌC VÀ BỒI THƯỜNG:"), 50, rowY + 7);

      doc
        .fillColor("#333333")
        .fontSize(8.5)
        .text(`${txt("1. Tổng tiền cọc đang giữ:")}`, 50, rowY + 23)
        .text(fmtMoney(depositTotal), 420, rowY + 23, { width: 125, align: "right" })
        .text(`${txt("2. (-) Tổng tiền phạt khấu trừ:")}`, 50, rowY + 37)
        .text(`- ${fmtMoney(totalPenalty)}`, 420, rowY + 37, { width: 125, align: "right" });

      if (customerExtraOwed > 0) {
        doc
          .fillColor("#DC2626") // Red
          .fontSize(9)
          .text(`${txt("3. (=) Tiền phạt vượt cọc - Khách bồi thường thêm:")}`, 50, rowY + 53)
          .text(fmtMoney(customerExtraOwed), 420, rowY + 53, { width: 125, align: "right" });
      } else {
        doc
          .fillColor("#166534") // Green
          .fontSize(9)
          .text(`${txt("3. (=) Số tiền cọc thực hoàn trả cho khách:")}`, 50, rowY + 53)
          .text(fmtMoney(refundRemaining), 420, rowY + 53, { width: 125, align: "right" });
      }

      rowY += settlementBoxH + 12;

      // ── Note / Comments Box ──
      if (data.note && data.note.trim()) {
        const noteTitle = txt("Ghi chú & Ý kiến biên bản:");
        doc.fontSize(8.5);
        const noteContent = txt(data.note.trim());
        const noteTextH = doc.heightOfString(noteContent, { width: 495, lineGap: 2 });
        const noteBoxH = Math.max(noteTextH + 26, 42);

        if (rowY + noteBoxH > 740) {
          doc.addPage();
          rowY = 50;
        }

        doc.rect(40, rowY, 515, noteBoxH).fillAndStroke("#FBF9F5", "#E8E2D8");
        doc.fillColor("#8B263E").fontSize(8.5).text(noteTitle, 50, rowY + 6);
        doc.fillColor("#444444").fontSize(8.5).text(noteContent, 50, rowY + 18, {
          width: 495,
          lineGap: 2,
        });

        rowY += noteBoxH + 12;
      }

      // ── Signatures ──
      const sigHeight = 75;
      if (rowY + sigHeight > 780) {
        doc.addPage();
        rowY = 50;
      }

      const sigY = Math.max(rowY + 15, 680);
      // If sigY puts it off page, place relative to rowY
      const finalSigY = sigY + sigHeight > 800 ? rowY + 15 : sigY;

      doc
        .fillColor("#2B2625")
        .fontSize(9.5)
        .text(txt("NHÂN VIÊN KIỂM TRA (STAFF)"), 65, finalSigY, { width: 170, align: "center" })
        .text(txt("KHÁCH HÀNG (NGƯỜI THUÊ)"), 340, finalSigY, { width: 180, align: "center" });

      doc
        .fillColor("#888888")
        .fontSize(8)
        .text(txt("(Ký và ghi rõ họ tên)"), 65, finalSigY + 14, { width: 170, align: "center" })
        .text(txt("(Ký xác nhận hiện trạng & quyết toán cọc)"), 340, finalSigY + 14, { width: 180, align: "center" });

      doc.end();
    });
  }
}
