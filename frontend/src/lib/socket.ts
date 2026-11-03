import { io, type Socket } from "socket.io-client";
import { resolveSocketUrl, shouldAddTrailingSlash } from "./socket-config";

export { shouldAddTrailingSlash };

/**
 * URL kết nối Socket.IO cho namespace `/chat`.
 *
 * Socket.IO luôn mở Engine.IO ở `/socket.io` trên host của URL này; phần `/chat`
 * chỉ là namespace. Xem `socket-config.ts` để biết thứ tự ưu tiên của URL.
 */
export function resolveChatSocketUrl(): string {
  return resolveSocketUrl("/chat");
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
    // Đi qua rewrite của Vercel chỉ HTTP polling được proxy, WebSocket Upgrade
    // bị trả 400. Thử `polling` trước để kết nối thành công rồi để engine.io tự
    // nâng cấp lên `websocket` khi hạ tầng hỗ trợ.
    transports: ["polling", "websocket"],
    // Phải là `true` khi nối trực tiếp backend (localhost:4000 cần `/socket.io/`)
    // và `false` khi đi qua rewrite Vercel (Next.js 308 bỏ "/" làm mất header
    // Upgrade). `shouldAddTrailingSlash` tự chọn theo origin đích.
    addTrailingSlash: shouldAddTrailingSlash(chatSocketUrl),
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
