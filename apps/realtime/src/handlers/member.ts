import type { Server, Socket } from "socket.io";
import {
  MemberRenameEventSchema,
  type MemberRenamedEvent,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

export function handleMemberRename(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = MemberRenameEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[MEMBER_RENAME] invalid payload socket=${socket.id}`);
    socket.emit("ERROR", {
      type: "VALIDATION_ERROR",
      message: "Invalid MEMBER_RENAME payload",
    });
    return;
  }

  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    socket.emit("ERROR", {
      type: "NOT_IN_ROOM",
      message: "Not in a room",
    });
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) return;

  const member = room.members.find((m) => m.clientId === client.clientId);
  if (!member) return;

  const oldName = member.name;
  const newName = parsed.data.payload.name.trim();

  if (oldName === newName) return; // No change

  member.name = newName;
  room.version++;

  const broadcast: MemberRenamedEvent = {
    type: "MEMBER_RENAMED",
    roomId: room.roomId,
    serverTs: Date.now(),
    payload: {
      clientId: client.clientId,
      oldName,
      newName,
    },
  };

  io.to(room.roomId).emit("MEMBER_RENAMED", broadcast);

  console.log(
    `[MEMBER_RENAME] "${oldName}" -> "${newName}" clientId=${client.clientId} roomId=${room.roomId}`
  );
}

export function registerMemberHandlers(io: Server, socket: Socket): void {
  socket.on("MEMBER_RENAME", (data: unknown) => {
    handleMemberRename(io, socket, data);
  });
}
