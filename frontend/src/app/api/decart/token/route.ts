import { NextRequest, NextResponse } from "next/server";
import { createDecartClient } from "@decartai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase";

// Lưu số phiên Gương soi Live theo userId trong ngày (In-memory Rate Limiting)
const dailyLiveSessions = new Map<string, { count: number; date: string }>();

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

// Cấu hình ngân sách & Hạn mức phiên
const BASE_DAILY_LIVE_SESSIONS = 2; // Mặc định 2 phiên (15s)/ngày cho mỗi tài khoản
const BONUS_MEASUREMENT_SESSIONS = 2; // Thưởng thêm +2 phiên nếu đã hoàn tất số đo cơ thể
const SESSION_DURATION_SECONDS = 18; // Khống chế cứng trên Decart WebRTC (18s để buffer 3s handshake)

export async function POST(req: NextRequest) {
  const apiKey = process.env.DECART_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    return NextResponse.json(
      {
        error: "CONFIGURATION_ERROR",
        message:
          "Chưa cấu hình DECART_API_KEY trong file .env.local của frontend. Vui lòng thêm DECART_API_KEY=dct_... và khởi động lại server.",
      },
      { status: 500 }
    );
  }

  // 1. Gatekeeper Tầng 1: Bắt buộc đăng nhập tài khoản
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        error: "UNAUTHORIZED",
        message:
          "Bạn cần đăng nhập tài khoản để nhận lượt sử dụng Gương soi Thử đồ Live (Decart AI) miễn phí.",
      },
      { status: 401 }
    );
  }

  const tokenString = authHeader.split(" ")[1];
  let userId = "guest_user";
  try {
    const payloadBase64 = tokenString.split(".")[1];
    if (!payloadBase64) {
      throw new Error("Invalid JWT format");
    }
    const decoded = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8"));
    userId = decoded.sub || decoded.id || decoded.userId;
    if (!userId) {
      throw new Error("Missing user identifier in token");
    }
  } catch {
    return NextResponse.json(
      {
        error: "INVALID_TOKEN",
        message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
      },
      { status: 401 }
    );
  }

  // 2. Kiểm tra phần thưởng nhiệm vụ: Đã lưu số đo cơ thể hay chưa
  let maxDailySessions = BASE_DAILY_LIVE_SESSIONS;
  let hasMeasurementsBonus = false;

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
    const measureRes = await fetch(`${apiUrl}/users/me/measurements`, {
      headers: { Authorization: `Bearer ${tokenString}` },
      cache: "no-store",
    });
    if (measureRes.ok) {
      const measureData = await measureRes.json();
      const m = measureData?.data || measureData;
      if (m && (m.heightCm || m.bustCm || m.waistCm || m.usualSize)) {
        maxDailySessions += BONUS_MEASUREMENT_SESSIONS;
        hasMeasurementsBonus = true;
      }
    }
  } catch {
    // Không gián đoạn nếu service profile tạm bận
  }

  // 3. Gatekeeper Tầng 2: Kiểm soát hạn mức ngân sách AI trong ngày (Rate Limiting)
  const today = getTodayString();
  const userUsage = dailyLiveSessions.get(userId);

  if (userUsage && userUsage.date === today && userUsage.count >= maxDailySessions) {
    return NextResponse.json(
      {
        error: "QUOTA_EXCEEDED",
        message: `Hôm nay bạn đã dùng hết ${userUsage.count}/${maxDailySessions} phiên Gương soi Live (15s).`,
        usedSessions: userUsage.count,
        maxDailySessions,
        hasMeasurementsBonus,
        canEarnMoreByMeasurements: !hasMeasurementsBonus,
      },
      { status: 429 }
    );
  }

  try {
    const client = createDecartClient({ apiKey: apiKey.trim() });

    // Tạo ephemeral client token với giới hạn thời lượng cứng
    const token = await client.tokens.create({
      allowedModels: ["lucy-vton-latest", "lucy-vton-3.6", "lucy-vton-3.5"],
      constraints: {
        realtime: {
          maxSessionDuration: SESSION_DURATION_SECONDS,
        },
      },
    });

    // Cập nhật số lượt đã dùng của user
    const currentCount = (userUsage && userUsage.date === today ? userUsage.count : 0) + 1;
    dailyLiveSessions.set(userId, {
      date: today,
      count: currentCount,
    });

    // 4. Tự động sinh mã Voucher độc quyền riêng cho khách (Dùng 1 lần duy nhất, hết hạn sau 24h)
    let issuedVoucherCode = "COPHUC-LIVE10";
    try {
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const dynamicCode = `LIVE-${randomSuffix}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 giờ tới

      const supabase = getSupabaseAdmin();
      const { error: insertErr } = await (supabase.from("vouchers") as any).insert({
        code: dynamicCode,
        name: `Ưu đãi Gương soi Live 10% (${dynamicCode})`,
        description: `Voucher giảm 10% độc quyền khi trải nghiệm Gương soi Live AI (Hạn dùng 24h)`,
        discount_type: "percentage",
        discount_value: 10,
        min_order_value: 0,
        usage_limit: 1, // Dùng đúng 1 lần duy nhất toàn hệ thống
        per_user_limit: 1, // Khách hàng dùng 1 lần
        start_at: now.toISOString(),
        end_at: expiresAt.toISOString(),
        category_ids: [],
        garment_ids: [],
        is_active: true,
      });

      if (!insertErr) {
        issuedVoucherCode = dynamicCode;
      } else {
        console.warn("Supabase voucher insert fallback to default:", insertErr.message);
      }
    } catch (vErr) {
      console.warn("Dynamic voucher creation failed, fallback to default:", vErr);
    }

    return NextResponse.json({
      apiKey: token.apiKey,
      expiresAt: token.expiresAt,
      sessionDurationSeconds: 15,
      maxDailySessions,
      remainingSessionsToday: Math.max(0, maxDailySessions - currentCount),
      hasMeasurementsBonus,
      voucherCode: issuedVoucherCode,
      voucherDiscount: "10%",
    });
  } catch (err: unknown) {
    console.error("Error creating Decart client token:", err);
    const message = err instanceof Error ? err.message : "Lỗi không xác định khi kết nối Decart API";
    return NextResponse.json(
      { error: "DECART_ERROR", message: `Lỗi kết nối Decart AI: ${message}` },
      { status: 500 }
    );
  }
}
