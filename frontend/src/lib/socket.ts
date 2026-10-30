import { io, type Socket } from "socket.io-client";

// Socket.IO dùng proxy rewrite của Vercel (/socket.io/* → VPS)
const chatSocketUrl = `/chat`;

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
