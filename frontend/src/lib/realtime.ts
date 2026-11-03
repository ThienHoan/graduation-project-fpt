import { io, type Socket } from "socket.io-client";
import { resolveSocketUrl, shouldAddTrailingSlash } from "./socket-config";

// Namespace `/realtime`. URL được suy ra giống `/chat` để localhost trỏ đúng
// backend (trước đây hardcode "/realtime" nên ở dev lại đi qua rewrite của
// Next.js và chạm nhầm VPS production).
const realtimeSocketUrl = resolveSocketUrl("/realtime");

let socket: Socket | null = null;
let currentToken: string | null = null;
let subscriberCount = 0;

function buildSocket(accessToken: string) {
  return io(realtimeSocketUrl, {
    auth: { token: `Bearer ${accessToken}` },
    // Đi qua rewrite của Vercel chỉ HTTP polling được proxy; yêu cầu WebSocket
    // Upgrade bị trả 400. Vì vậy thử `polling` trước để kết nối thành công, sau
    // đó client tự nâng cấp lên `websocket` khi hạ tầng cho phép.
    transports: ["polling", "websocket"],
    // Xem `socket-config.ts`: true khi nối trực tiếp backend, false khi qua
    // rewrite cùng origin (Vercel 308 làm mất header Upgrade).
    addTrailingSlash: shouldAddTrailingSlash(realtimeSocketUrl),
    reconnectionDelayMax: 30000,
    timeout: 30000,
  });
}

export function createRealtimeSocket(accessToken: string) {
  const token = `Bearer ${accessToken}`;

  if (socket) {
    if (currentToken !== token) {
      currentToken = token;
      socket.auth = { token };
      socket.disconnect().connect();
    }
    return socket;
  }

  currentToken = token;
  socket = buildSocket(accessToken);
  return socket;
}

export function subscribeRealtimeSocket(accessToken: string, listener: (socket: Socket) => void) {
  const activeSocket = createRealtimeSocket(accessToken);
  subscriberCount += 1;
  listener(activeSocket);

  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount > 0) return;
    activeSocket.removeAllListeners();
    activeSocket.disconnect();
    activeSocket.io.reconnection(false);
    if (socket === activeSocket) {
      socket = null;
      currentToken = null;
    }
  };
}