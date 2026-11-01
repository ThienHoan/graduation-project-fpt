import { io, type Socket } from "socket.io-client";

/**
 * Xác định URL kết nối Socket.IO cho namespace `/chat`.
 *
 * Socket.IO luôn mở Engine.IO tại `path` mặc định `/socket.io` trên host của URL
 * này; phần `/chat` chỉ là namespace. Vì vậy URL phải trỏ tới **backend** (hoặc
 * một origin có proxy `/socket.io/*`), không được là đường dẫn tương đối.
 *
 * Thứ tự ưu tiên:
 *   1. `NEXT_PUBLIC_SOCKET_URL` — override rõ ràng khi tách domain.
 *   2. Suy ra từ `NEXT_PUBLIC_API_URL` (bỏ hậu tố `/api` hoặc `/backend-api`).
 *      Ví dụ: `http://localhost:4000/api` → `http://localhost:4000/chat`.
 *      Production: `https://domain/backend-api` → `https://domain/chat`, và
 *      Next.js rewrite `/socket.io/*` sẽ chuyển tiếp sang VPS.
 *   3. Fallback cùng origin (dựa vào rewrite `/socket.io/*`) khi không có env.
 */
export function resolveChatSocketUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    const base = apiUrl.replace(/\/$/, "").replace(/\/(api|backend-api)$/, "");
    return `${base}/chat`;
  }

  return "/chat";
}

const chatSocketUrl = resolveChatSocketUrl();

let socket: Socket | null = null;

export function createChatSocket(accessToken: string) {
  const token = `Bearer ${accessToken}`;

  if (socket) {
    if (socket.connected) {
      const currentAuth = socket.auth;
      if (
        currentAuth &&
        typeof currentAuth === "object" &&
        currentAuth.token !== token
      ) {
        socket.auth = { token };
        socket.disconnect().connect();
      }
    } else {
      socket.auth = { token };
      socket.connect();
    }
    return socket;
  }

  socket = io(chatSocketUrl, {
    auth: { token },
    reconnectionDelayMax: 30000,
    timeout: 30000,
  });

  //socket.on("connect", () => console.log("socket connected", socket!.id));
  //socket.on("disconnect", (reason) => console.log("socket disconnected", reason));
  //socket.on("connect_error", (err) => console.log("socket connect_error", err.message));

  return socket;
}

export function getChatSocket() {
  return socket;
}

export function disconnectChatSocket() {
  if (!socket) return;
  //console.log("disconnectChatSocket: disconnecting socket", socket.id);
  socket.removeAllListeners();
  socket.disconnect();
  socket.io.reconnection(false);
  socket = null;
  //console.log("disconnectChatSocket: socket set to null, reconnection disabled");
}
