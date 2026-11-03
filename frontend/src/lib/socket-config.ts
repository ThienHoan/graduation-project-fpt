/**
 * Logic dùng chung cho cả hai namespace Socket.IO (`/chat` và `/realtime`).
 *
 * Tách riêng khỏi `socket.ts` để `realtime.ts` không phải import module chat.
 */

export type SocketNamespace = "/chat" | "/realtime";

export type SocketTransport = "polling" | "websocket";

/**
 * Transport Engine.IO phù hợp với URL đích.
 *
 * - **Cùng origin** (đi qua rewrite `/socket.io/*` của Vercel/Next.js): rewrite
 *   chỉ proxy được HTTP polling, KHÔNG forward được WebSocket Upgrade → chỉ
 *   dùng `["polling"]`, tránh log lỗi
 *   `wss://<origin>/socket.io?... failed` và vòng probe vô ích mỗi lần reconnect.
 * - **Khác origin** (nối thẳng backend, vd dev `localhost:3000` → `:4000`): dùng
 *   `["polling", "websocket"]` để tận dụng WebSocket.
 *
 * `pageOrigin` chỉ dùng cho test; mặc định `window.location.origin`.
 */
export function resolveSocketTransports(url: string, pageOrigin?: string): SocketTransport[] {
  const origin =
    pageOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined);
  if (!origin) return ["polling", "websocket"];
  try {
    return new URL(url, origin).origin === origin ? ["polling"] : ["polling", "websocket"];
  } catch {
    return ["polling", "websocket"];
  }
}

/**
 * URL đầy đủ cho một namespace Socket.IO.
 *
 * Thứ tự ưu tiên:
 *   1. `NEXT_PUBLIC_SOCKET_URL` — đã bao gồm namespace, vd `https://host/chat`.
 *   2. Suy ra từ `NEXT_PUBLIC_API_URL` (bỏ hậu tố `/api` hoặc `/backend-api`).
 *      `http://localhost:4000/api` → `http://localhost:4000/chat`.
 *   3. URL tương đối cùng origin — dựa vào rewrite `/socket.io/*` của Next.js.
 *
 * Phần `/chat` / `/realtime` chỉ là namespace; Engine.IO luôn mở ở `/socket.io`.
 */
export function resolveSocketUrl(namespace: SocketNamespace, pageOrigin?: string): string {
  const resolved = resolveSocketUrlFromEnv(namespace);

  // Trang chạy HTTPS mà URL resolve ra `http://host` → trình duyệt chặn Mixed
  // Content. Thay vì tin tưởng env (dễ trỏ nhầm IP http://...:4000 trên Vercel),
  // lùi về URL tương đối cùng origin để đi qua rewrite `/socket.io/*` của
  // Next.js/Vercel. Localhost/`127.0.0.1` được miễn vì trình duyệt coi là
  // "potentially trustworthy", không bị Mixed Content.
  if (isInsecureMixedContent(resolved, pageOrigin)) {
    return namespace;
  }

  return resolved;
}

/** Từ một biến môi trường (không guard Mixed Content). */
function resolveSocketUrlFromEnv(namespace: SocketNamespace): string {
  const explicit = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  if (explicit) {
    const clean = explicit.replace(/\/$/, "");
    return `${clean.replace(/\/(chat|realtime)$/, "")}${namespace}`;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    const base = apiUrl.replace(/\/$/, "").replace(/\/(api|backend-api)$/, "");
    return `${base}${namespace}`;
  }

  return namespace;
}

/** Loopback được phép là `http://` kể cả khi trang đang HTTPS. */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * URL có phải Mixed Content không: trang HTTPS nhưng đích là `http://` khác
 * loopback. `pageOrigin` chỉ dùng cho test; mặc định `window.location.origin`.
 */
function isInsecureMixedContent(url: string, pageOrigin?: string): boolean {
  const origin =
    pageOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined);
  if (!origin || !origin.startsWith("https:")) return false;

  try {
    const target = new URL(url, origin);
    if (target.protocol !== "http:") return false;
    return !isLoopbackHostname(target.hostname);
  } catch {
    return false;
  }
}

/**
 * Có cần dấu `/` ở cuối Engine.IO path (`/socket.io/`) hay không.
 *
 * Hai môi trường có yêu cầu **ngược nhau**, nên phải chọn theo origin đích:
 *
 * - **Kết nối trực tiếp tới backend** (khác origin trang, vd frontend
 *   `localhost:3000` → backend `localhost:4000`): socket.io server chỉ khớp
 *   `/socket.io/`; gọi `/socket.io` (không `/`) trả **404** → cần `true`.
 *
 * - **Đi qua rewrite của Vercel/Next.js** (cùng origin): URL `/socket.io/?...`
 *   bị **308** redirect bỏ `/`, trình duyệt không mang theo header
 *   `Upgrade: websocket` → hỏng. Còn `/socket.io?...` được rewrite thêm `/`
 *   khi forward sang backend → cần `false`.
 *
 * `pageOrigin` chỉ dùng cho test; mặc định lấy `window.location.origin`.
 */
export function shouldAddTrailingSlash(url: string, pageOrigin?: string): boolean {
  const origin = pageOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined);
  if (!origin) return false;
  try {
    return new URL(url, origin).origin !== origin;
  } catch {
    return false;
  }
}
