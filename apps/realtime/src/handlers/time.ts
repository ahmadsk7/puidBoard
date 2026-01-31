/**
 * Time synchronization handlers.
 * Handles TIME_PING/TIME_PONG for client clock sync.
 */

import { Socket } from "socket.io";
import { TimePingEventSchema, TimePongEvent } from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

/**
 * Handle TIME_PING event for latency measurement and clock sync.
 * 
 * Client sends: TIME_PING { t0: clientTimestamp }
 * Server responds: TIME_PONG { t0: clientTimestamp, serverTs: serverTimestamp }
 * 
 * Client can then compute:
 * - RTT = t1 - t0 (where t1 is when client receives pong)
 * - clock_skew = serverTs - (t0 + RTT/2)
 */
export function handleTimePing(socket: Socket, data: unknown): void {
  const parsed = TimePingEventSchema.safeParse(data);
  if (!parsed.success) {
    return; // Silently ignore invalid pings
  }

  const { t0 } = parsed.data;
  const serverTs = Date.now();

  // Calculate approximate latency (one-way estimate)
  const latencyMs = Math.max(0, Math.round((serverTs - t0) / 2));

  // Update stored latency for the client
  roomStore.updateLatency(socket.id, latencyMs);

  // Send pong response
  const pong: TimePongEvent = {
    type: "TIME_PONG",
    t0,
    serverTs,
  };

  socket.emit("TIME_PONG", pong);
}

/**
 * Register time sync handlers on a socket.
 */
export function registerTimeHandlers(socket: Socket): void {
  socket.on("TIME_PING", (data: unknown) => {
    handleTimePing(socket, data);
  });
}
