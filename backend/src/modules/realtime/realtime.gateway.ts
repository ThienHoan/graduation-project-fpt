import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { AppRole } from "@prisma/client";
import type { Server, Socket } from "socket.io";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "./realtime.service";

interface JwtPayload {
  sub?: string;
  role?: AppRole;
}

interface RealtimeSocket extends Socket {
  data: {
    user?: {
      userId: string;
      role: AppRole;
    };
  };
}

@WebSocketGateway({
  namespace: "/realtime",
  cors: {
    origin: true,
    credentials: true,
  },
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.bindServer(server);
  }

  async handleConnection(client: RealtimeSocket) {
    const token = this.getTokenFromHandshake(client);
    if (!token) {
      client.disconnect();
      return;
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      client.disconnect();
      return;
    }

    if (!payload.sub || !payload.role) {
      client.disconnect();
      return;
    }

    const user = await this.prisma.userAccount.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      client.disconnect();
      return;
    }

    client.data.user = { userId: user.id, role: user.role };
    client.join("dashboard:all");
    client.join(`user:${user.id}`);
    client.join(`role:${user.role}`);

    if (user.role === "staff") {
      client.join("dashboard:staff");
    }
    if (user.role === "manager_owner" || user.role === "admin") {
      client.join("dashboard:manager");
    }
    if (user.role === "admin") {
      client.join("dashboard:admin");
    }
    if (user.role === "customer") {
      client.join("dashboard:customer");
    }
  }

  private getTokenFromHandshake(client: Socket) {
    const raw = client.handshake.auth?.token;
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    return raw.startsWith("Bearer ") ? raw.slice(7) : raw;
  }
}
