/**
 * Time synchronization handlers for Virtual DJ Rooms.
 *
 * Implements a simple time sync protocol:
 * 1. Client sends TIME_PING(t0)
 * 2. Server responds TIME_PONG(t0, server_ts)
 * 3. Client computes RTT = (t1 - t0), offset = server_ts - ((t0 + t1) / 2)
 */

import type { Socket } from "socket.io";
import { TimePingEventSchema, TimePongEvent } from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

/**
 * Handle TIME_PING for clock synchronization.
 *
 * This allows clients to:
 * - Estimate round-trip time (RTT)
 * - Calculate clock offset from server
 * - Compensate for network latency in sync
 */
export function handleTimePing(socket: Socket, data: unknown): void {
  const parsed = TimePingEventSchema.safeParse(data);
  if (!parsed.success) {
    // Silently ignore invalid pings (high-frequency, not critical)
    return;
  }

  const { t0 } = parsed.data;
  const serverTs = Date.now();

  // Estimate one-way latency (assumes symmetric network)
  // This is approximate - clients should use multiple samples
  const estimatedLatencyMs = Math.max(0, Math.round((serverTs - t0) / 2));

  // Update stored latency for this client (used for UI indicators)
  roomStore.updateLatency(socket.id, estimatedLatencyMs);

  // Send pong with server timestamp
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
