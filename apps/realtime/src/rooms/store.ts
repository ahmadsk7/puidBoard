/**
 * In-memory room store for managing RoomState.
 * The server maintains authoritative state here.
 */

import {
  RoomState,
  Member,
  ClientId,
  RoomId,
  createDefaultDeck,
  createDefaultMixer,
} from "@puid-board/shared";

/** Generate a random 6-character room code */
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Avoid confusing chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Generate a unique ID */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/** Member colors for assignment */
const MEMBER_COLORS = [
  "#FF6B6B", // Red
  "#4ECDC4", // Teal
  "#45B7D1", // Blue
  "#96CEB4", // Green
  "#FFEAA7", // Yellow
  "#DDA0DD", // Plum
  "#98D8C8", // Mint
  "#F7DC6F", // Gold
];

/** Client connection tracking */
interface ClientConnection {
  clientId: ClientId;
  roomId: RoomId | null;
  socketId: string;
  lastPingMs: number;
}

class RoomStore {
  /** Map of roomId -> RoomState */
  private rooms: Map<RoomId, RoomState> = new Map();

  /** Map of roomCode -> roomId for quick lookup */
  private roomCodeIndex: Map<string, RoomId> = new Map();

  /** Map of socketId -> ClientConnection */
  private clients: Map<string, ClientConnection> = new Map();

  /** Map of clientId -> socketId for reverse lookup */
  private clientSocketIndex: Map<ClientId, string> = new Map();

  /**
   * Create a new room.
   * @param hostName Display name of the host
   * @param socketId Socket ID of the host
   * @returns The created room state and host's client ID
   */
  createRoom(
    hostName: string,
    socketId: string
  ): { room: RoomState; clientId: ClientId } {
    const roomId = generateId();
    let roomCode = generateRoomCode();

    // Ensure unique room code
    while (this.roomCodeIndex.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const clientId = generateId();
    const now = Date.now();

    const host: Member = {
      clientId,
      name: hostName,
      color: MEMBER_COLORS[0]!,
      joinedAt: now,
      isHost: true,
      cursor: null,
      latencyMs: 0,
    };

    const room: RoomState = {
      roomId,
      roomCode,
      version: 0,
      createdAt: now,
      hostId: clientId,
      members: [host],
      queue: [],
      deckA: createDefaultDeck("A"),
      deckB: createDefaultDeck("B"),
      mixer: createDefaultMixer(),
      controlOwners: {},
    };

    // Store room
    this.rooms.set(roomId, room);
    this.roomCodeIndex.set(roomCode, roomId);

    // Track client
    this.clients.set(socketId, {
      clientId,
      roomId,
      socketId,
      lastPingMs: 0,
    });
    this.clientSocketIndex.set(clientId, socketId);

    console.log(
      `[room:create] roomId=${roomId} code=${roomCode} host=${clientId}`
    );

    return { room, clientId };
  }

  /**
   * Join an existing room by code.
   * @param roomCode The room code to join
   * @param memberName Display name of the joining member
   * @param socketId Socket ID of the joining member
   * @returns The room state, member's client ID, or null if room not found
   */
  joinRoom(
    roomCode: string,
    memberName: string,
    socketId: string
  ): { room: RoomState; clientId: ClientId } | null {
    const roomId = this.roomCodeIndex.get(roomCode.toUpperCase());
    if (!roomId) {
      console.log(`[room:join] room not found code=${roomCode}`);
      return null;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      console.log(`[room:join] room state missing roomId=${roomId}`);
      return null;
    }

    const clientId = generateId();
    const now = Date.now();

    // Assign a color not already in use
    const usedColors = new Set(room.members.map((m) => m.color));
    const availableColor =
      MEMBER_COLORS.find((c) => !usedColors.has(c)) ?? MEMBER_COLORS[0]!

    const member: Member = {
      clientId,
      name: memberName,
      color: availableColor,
      joinedAt: now,
      isHost: false,
      cursor: null,
      latencyMs: 0,
    };

    // Add member to room
    room.members.push(member);
    room.version++;

    // Track client
    this.clients.set(socketId, {
      clientId,
      roomId,
      socketId,
      lastPingMs: 0,
    });
    this.clientSocketIndex.set(clientId, socketId);

    console.log(
      `[room:join] roomId=${roomId} clientId=${clientId} name=${memberName}`
    );

    return { room, clientId };
  }

  /**
   * Remove a client from their current room.
   * @param socketId Socket ID of the leaving client
   * @returns Info about the leave, or null if client wasn't in a room
   */
  leaveRoom(
    socketId: string
  ): { roomId: RoomId; clientId: ClientId; room: RoomState | null } | null {
    const client = this.clients.get(socketId);
    if (!client || !client.roomId) {
      return null;
    }

    const { roomId, clientId } = client;
    const room = this.rooms.get(roomId);

    if (room) {
      // Remove member from room
      room.members = room.members.filter((m) => m.clientId !== clientId);
      room.version++;

      // Clean up any control ownership by this client
      for (const controlId of Object.keys(room.controlOwners)) {
        if (room.controlOwners[controlId]?.clientId === clientId) {
          delete room.controlOwners[controlId];
        }
      }

      console.log(
        `[room:leave] roomId=${roomId} clientId=${clientId} remaining=${room.members.length}`
      );

      // If room is empty, clean it up
      if (room.members.length === 0) {
        this.rooms.delete(roomId);
        this.roomCodeIndex.delete(room.roomCode);
        console.log(`[room:delete] roomId=${roomId} (empty)`);
      } else if (room.hostId === clientId && room.members.length > 0) {
        // Transfer host to first remaining member
        const newHost = room.members[0]!;
        room.hostId = newHost.clientId;
        newHost.isHost = true;
        console.log(`[room:host-transfer] roomId=${roomId} newHost=${newHost.clientId}`);
      }
    }

    // Clean up client tracking
    this.clients.delete(socketId);
    this.clientSocketIndex.delete(clientId);

    return { roomId, clientId, room: room ?? null };
  }

  /**
   * Get a room by ID.
   */
  getRoom(roomId: RoomId): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Get a room by code.
   */
  getRoomByCode(roomCode: string): RoomState | undefined {
    const roomId = this.roomCodeIndex.get(roomCode.toUpperCase());
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  /**
   * Get client info by socket ID.
   */
  getClient(socketId: string): ClientConnection | undefined {
    return this.clients.get(socketId);
  }

  /**
   * Get socket ID for a client.
   */
  getSocketId(clientId: ClientId): string | undefined {
    return this.clientSocketIndex.get(clientId);
  }

  /**
   * Update client latency.
   */
  updateLatency(socketId: string, latencyMs: number): void {
    const client = this.clients.get(socketId);
    if (!client || !client.roomId) return;

    client.lastPingMs = latencyMs;

    const room = this.rooms.get(client.roomId);
    if (!room) return;

    const member = room.members.find((m) => m.clientId === client.clientId);
    if (member) {
      member.latencyMs = latencyMs;
    }
  }

  /**
   * Get all members in a room.
   */
  getRoomMembers(roomId: RoomId): Member[] {
    const room = this.rooms.get(roomId);
    return room?.members ?? [];
  }

  /**
   * Get room count (for monitoring).
   */
  getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Get total client count (for monitoring).
   */
  getClientCount(): number {
    return this.clients.size;
  }
}

// Export singleton instance
export const roomStore = new RoomStore();
