import { io, type Socket } from "socket.io-client";

// Socket.IO dùng proxy rewrite của Vercel (/socket.io/* → VPS)
// Không cần base URL — dùng origin hiện tại (relative) để browser tự ghép wss://domain/socket.io/
const realtimeSocketUrl = `/realtime`;

let socket: Socket | null = null;
let currentToken: string | null = null;
let subscriberCount = 0;

function buildSocket(accessToken: string) {
  return io(realtimeSocketUrl, {
    auth: { token: `Bearer ${accessToken}` },
    transports: ["websocket", "polling"],
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