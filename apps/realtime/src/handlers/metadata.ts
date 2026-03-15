import type { Socket } from "socket.io";
import { TrackMetadataReportEventSchema } from "@puid-board/shared";
import { updateMetadataAnalysis } from "../services/youtubeCache.js";

/**
 * Handle TRACK_METADATA_REPORT from clients.
 * Clients send this after completing BPM detection + waveform generation
 * for a YouTube track. We cache the metadata so future joiners skip analysis.
 *
 * This is a standalone event (like TIME_PING), not a room mutation.
 */
export function registerMetadataHandlers(socket: Socket): void {
  socket.on("TRACK_METADATA_REPORT", async (data: unknown) => {
    const parsed = TrackMetadataReportEventSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("[metadata] Invalid TRACK_METADATA_REPORT:", parsed.error.message);
      return;
    }

    const { videoId, bpm, waveform } = parsed.data;

    try {
      await updateMetadataAnalysis(videoId, bpm, waveform);
      console.log(`[metadata] Cached analysis for ${videoId}: BPM=${bpm}`);
    } catch (err) {
      console.error(`[metadata] Failed to cache analysis for ${videoId}:`, err);
    }
  });
}
