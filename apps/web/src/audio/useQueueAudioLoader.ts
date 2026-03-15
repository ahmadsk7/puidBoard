"use client";

import { useEffect, useRef, useState } from "react";
import type { QueueItem, LoadingState } from "@puid-board/shared";

/**
 * Hook to pre-load YouTube audio for queue items.
 * Monitors the queue and automatically starts loading YouTube tracks.
 * Updates loading state and stores AudioBuffer in queue items.
 */
export function useQueueAudioLoader(
  queue: QueueItem[],
  realtimeUrl: string
): {
  queueWithAudio: QueueItem[];
  isLoading: (queueItemId: string) => boolean;
  getLoadingState: (queueItemId: string) => LoadingState | null;
} {
  // Track loading state for each queue item
  const [loadingStates, setLoadingStates] = useState<Map<string, LoadingState>>(new Map());

  // Track audio buffers for each queue item
  const [audioBuffers, setAudioBuffers] = useState<Map<string, AudioBuffer>>(new Map());

  // Track which items are currently being loaded (to avoid duplicates)
  const loadingItemsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Process all YouTube tracks in the queue
    for (const item of queue) {
      // Skip if not a YouTube track
      if (item.source !== "youtube" || !item.youtubeVideoId) {
        continue;
      }

      // Skip if already loaded or currently loading
      if (audioBuffers.has(item.id) || loadingItemsRef.current.has(item.id)) {
        continue;
      }

      // Skip if there's an error (don't retry automatically)
      const currentState = loadingStates.get(item.id);
      if (currentState?.stage === "error") {
        continue;
      }

      // Start loading this track
      console.log(`[QueueAudioLoader] Starting pre-load for: ${item.title}`);
      loadingItemsRef.current.add(item.id);

      // Update loading state — skip "extracting" for cached tracks
      const initialStage = item.cached ? "downloading" : "extracting";
      setLoadingStates((prev) => {
        const next = new Map(prev);
        next.set(item.id, { stage: initialStage, progress: 0, error: null });
        return next;
      });

      // Load the audio
      loadYouTubeAudio(item, realtimeUrl, (state) => {
        setLoadingStates((prev) => {
          const next = new Map(prev);
          next.set(item.id, state);
          return next;
        });
      })
        .then((buffer) => {
          console.log(`[QueueAudioLoader] ✓ Pre-load complete for: ${item.title}`);
          setAudioBuffers((prev) => {
            const next = new Map(prev);
            next.set(item.id, buffer);
            return next;
          });
          setLoadingStates((prev) => {
            const next = new Map(prev);
            next.set(item.id, { stage: "idle", progress: 1, error: null });
            return next;
          });
          loadingItemsRef.current.delete(item.id);
        })
        .catch((err) => {
          console.error(`[QueueAudioLoader] ✗ Pre-load failed for: ${item.title}`, err);
          setLoadingStates((prev) => {
            const next = new Map(prev);
            next.set(item.id, { stage: "error", progress: 0, error: err.message });
            return next;
          });
          loadingItemsRef.current.delete(item.id);
        });
    }
  }, [queue, realtimeUrl, audioBuffers, loadingStates]);

  // Create enhanced queue items with loading state and audio buffers
  const queueWithAudio: QueueItem[] = queue.map((item) => ({
    ...item,
    loading: loadingStates.get(item.id),
    audioBuffer: audioBuffers.get(item.id),
  }));

  const isLoading = (queueItemId: string) => {
    const state = loadingStates.get(queueItemId);
    return state?.stage !== "idle" && state?.stage !== "error" && state !== undefined;
  };

  const getLoadingState = (queueItemId: string) => {
    return loadingStates.get(queueItemId) ?? null;
  };

  return { queueWithAudio, isLoading, getLoadingState };
}

/**
 * Load YouTube audio and return the AudioBuffer.
 * Reports progress via onProgress callback.
 */
async function loadYouTubeAudio(
  item: QueueItem,
  realtimeUrl: string,
  onProgress: (state: LoadingState) => void
): Promise<AudioBuffer> {
  const videoId = item.youtubeVideoId;
  if (!videoId) {
    throw new Error("No YouTube video ID");
  }

  // Stage 1: Extracting (backend yt-dlp runs, takes ~10s)
  onProgress({ stage: "extracting", progress: 0, error: null });

  // For cached tracks, use the direct URL. For uncached, construct the stream URL.
  const streamUrl = item.cached
    ? item.url
    : `${realtimeUrl}/api/youtube/stream/${encodeURIComponent(videoId)}`;
  console.log(`[loadYouTubeAudio] Streaming from: ${streamUrl}`);

  const response = await fetch(streamUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch YouTube audio: ${response.status} ${response.statusText}`);
  }

  // Stage 2: Downloading (yt-dlp done, now downloading audio bytes)
  const contentLength = parseInt(response.headers.get("Content-Length") || "0", 10);
  console.log(`[loadYouTubeAudio] Downloading (${(contentLength / 1024 / 1024).toFixed(1)}MB)...`);

  onProgress({ stage: "downloading", progress: 0, error: null });

  // Stream the response body with progress tracking
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  let lastNotifyTime = performance.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    receivedBytes += value.length;

    // Throttle progress updates (every 100ms)
    const now = performance.now();
    if (contentLength > 0 && now - lastNotifyTime > 100) {
      const progress = receivedBytes / contentLength;
      onProgress({ stage: "downloading", progress, error: null });
      lastNotifyTime = now;
    }
  }

  // Final download progress
  onProgress({ stage: "downloading", progress: 1, error: null });

  // Combine chunks into a single ArrayBuffer
  const combined = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  const arrayBuffer = combined.buffer;

  // Stage 3: Decoding
  onProgress({ stage: "decoding", progress: 0, error: null });

  console.log(`[loadYouTubeAudio] Decoding ${arrayBuffer.byteLength} bytes`);
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  console.log(`[loadYouTubeAudio] ✓ Decoded: ${audioBuffer.duration.toFixed(2)}s`);

  // Note: Analysis happens later when loaded to deck
  onProgress({ stage: "idle", progress: 1, error: null });

  return audioBuffer;
}

/**
 * Get pre-loaded audio buffer for a queue item.
 * Returns null if not loaded yet.
 */
export function getPreloadedAudio(queue: QueueItem[], queueItemId: string): AudioBuffer | null {
  const item = queue.find((q) => q.id === queueItemId);
  return item?.audioBuffer ?? null;
}
