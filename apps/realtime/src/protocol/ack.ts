/**
 * Event acknowledgment protocol for discrete events.
 *
 * Discrete events (queue mutations, deck commands, etc.) require acknowledgment
 * so clients can implement retry logic and optimistic UI updates.
 */

import { Socket } from "socket.io";
import { EventAck, EventId } from "@puid-board/shared";

/**
 * Send an acknowledgment for a discrete event.
 *
 * @param socket - The socket to send the ack to
 * @param clientSeq - The client sequence number being acknowledged
 * @param eventId - The server-assigned event ID
 * @param accepted - Whether the event was accepted and applied
 * @param error - Optional error message if rejected
 */
export function sendAck(
  socket: Socket,
  clientSeq: number,
  eventId: EventId,
  accepted: boolean,
  error?: string
): void {
  const ack: EventAck = {
    type: "EVENT_ACK",
    clientSeq,
    eventId,
    accepted,
    error,
  };

  socket.emit("EVENT_ACK", ack);
}

/**
 * Send a positive acknowledgment for a successfully applied event.
 */
export function sendAcceptedAck(
  socket: Socket,
  clientSeq: number,
  eventId: EventId
): void {
  sendAck(socket, clientSeq, eventId, true);
}

/**
 * Send a negative acknowledgment for a rejected event.
 */
export function sendRejectedAck(
  socket: Socket,
  clientSeq: number,
  eventId: EventId,
  error: string
): void {
  sendAck(socket, clientSeq, eventId, false, error);
}

/**
 * Generate a unique event ID.
 * Format: timestamp-random
 */
export function generateEventId(): EventId {
  return `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
