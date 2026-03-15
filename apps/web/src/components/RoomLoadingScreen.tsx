"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { RoomState } from "@puid-board/shared";
import { initAudioEngine } from "../audio/engine";

interface LoadingItem {
  label: string;
  status: "pending" | "loading" | "ready" | "error";
  progress: number;
  error?: string;
}

interface RoomLoadingScreenProps {
  state: RoomState;
  realtimeUrl: string;
  onReady: () => void;
}

/**
 * Fetches audio from a URL to verify it's accessible.
 */
async function fetchAudioBuffer(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status}`);
  }
  // Just read the body to confirm it downloads
  await response.arrayBuffer();
}

export function RoomLoadingScreen({ state, realtimeUrl, onReady }: RoomLoadingScreenProps) {
  const [items, setItems] = useState<Map<string, LoadingItem>>(new Map());
  const [audioReady, setAudioReady] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const initRef = useRef(false);

  // Determine what needs to be loaded
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const loadingItems = new Map<string, LoadingItem>();

    // Check deck A
    const deckAItem = state.deckA.loadedTrackId
      ? state.queue.find((q) => q.trackId === state.deckA.loadedTrackId)
      : null;
    if (deckAItem) {
      loadingItems.set("deckA", { label: `Deck A: ${deckAItem.title}`, status: "pending", progress: 0 });
    }

    // Check deck B
    const deckBItem = state.deckB.loadedTrackId
      ? state.queue.find((q) => q.trackId === state.deckB.loadedTrackId)
      : null;
    if (deckBItem) {
      loadingItems.set("deckB", { label: `Deck B: ${deckBItem.title}`, status: "pending", progress: 0 });
    }

    // Check sampler custom sounds
    const hasCustomSampler = state.sampler.slots.some((s) => s.isCustom && s.url);
    if (hasCustomSampler) {
      loadingItems.set("sampler", { label: "Custom sampler sounds", status: "pending", progress: 0 });
    }

    // If nothing to load, mark ready immediately
    if (loadingItems.size === 0) {
      setAllLoaded(true);
    }

    setItems(loadingItems);

    // Start loading everything
    const loadAll = async () => {
      const promises: Promise<void>[] = [];

      // Load deck tracks
      for (const [key, deckItem] of [["deckA", deckAItem], ["deckB", deckBItem]] as const) {
        if (!deckItem) continue;
        const itemKey = key;

        promises.push(
          (async () => {
            try {
              setItems((prev) => {
                const next = new Map(prev);
                next.set(itemKey, { ...next.get(itemKey)!, status: "loading" });
                return next;
              });

              // Determine URL
              let url = deckItem.url;
              if (deckItem.source === "youtube" && deckItem.youtubeVideoId && !deckItem.cached) {
                url = `${realtimeUrl}/api/youtube/stream/${encodeURIComponent(deckItem.youtubeVideoId)}`;
              }

              await fetchAudioBuffer(url);

              setItems((prev) => {
                const next = new Map(prev);
                next.set(itemKey, { ...next.get(itemKey)!, status: "ready", progress: 1 });
                return next;
              });
            } catch (err) {
              setItems((prev) => {
                const next = new Map(prev);
                next.set(itemKey, {
                  ...next.get(itemKey)!,
                  status: "error",
                  error: err instanceof Error ? err.message : "Failed to load",
                });
                return next;
              });
            }
          })()
        );
      }

      // Load sampler custom sounds (just verify URLs are accessible)
      if (hasCustomSampler) {
        promises.push(
          (async () => {
            try {
              setItems((prev) => {
                const next = new Map(prev);
                next.set("sampler", { ...next.get("sampler")!, status: "loading" });
                return next;
              });

              for (const slot of state.sampler.slots) {
                if (slot && slot.isCustom && slot.url) {
                  await fetch(slot.url).then((r) => {
                    if (!r.ok) throw new Error(`Failed: ${r.status}`);
                  });
                }
              }

              setItems((prev) => {
                const next = new Map(prev);
                next.set("sampler", { ...next.get("sampler")!, status: "ready", progress: 1 });
                return next;
              });
            } catch (err) {
              setItems((prev) => {
                const next = new Map(prev);
                next.set("sampler", {
                  ...next.get("sampler")!,
                  status: "error",
                  error: err instanceof Error ? err.message : "Failed to load",
                });
                return next;
              });
            }
          })()
        );
      }

      await Promise.allSettled(promises);
      setAllLoaded(true);
    };

    loadAll();
  }, [state, realtimeUrl]);

  const handleClick = useCallback(async () => {
    try {
      await initAudioEngine();
      setAudioReady(true);
      onReady();
    } catch (err) {
      console.error("[RoomLoadingScreen] Failed to init audio:", err);
    }
  }, [onReady]);

  // Calculate overall progress
  const itemList = Array.from(items.values());
  const totalItems = itemList.length || 1;
  const readyItems = itemList.filter((i) => i.status === "ready").length;
  const overallProgress = totalItems > 0 ? readyItems / totalItems : 1;

  const memberCount = state.members.length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        fontFamily: "monospace",
        color: "#e0e0e0",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <h2 style={{ color: "#3b82f6", fontSize: 24, marginBottom: 8 }}>
          Joining {state.roomCode}
        </h2>
        <p style={{ color: "#888", fontSize: 14, marginBottom: 32 }}>
          {memberCount} {memberCount === 1 ? "person" : "people"} in the room
        </p>

        {/* Per-item progress */}
        {itemList.length > 0 && (
          <div style={{ marginBottom: 32, textAlign: "left" }}>
            {itemList.map((item, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span>{item.label}</span>
                  <span style={{ color: item.status === "ready" ? "#4ade80" : item.status === "error" ? "#ef4444" : "#888" }}>
                    {item.status === "ready" ? "Ready" : item.status === "error" ? "Error" : item.status === "loading" ? "Loading..." : "Waiting"}
                  </span>
                </div>
                <div style={{ height: 4, background: "#222", borderRadius: 2 }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${item.status === "ready" ? 100 : item.status === "loading" ? 50 : 0}%`,
                      background: item.status === "error" ? "#ef4444" : "#3b82f6",
                      borderRadius: 2,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                {item.error && (
                  <p style={{ color: "#ef4444", fontSize: 11, marginTop: 2 }}>{item.error}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Overall progress bar */}
        {itemList.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ height: 6, background: "#222", borderRadius: 3 }}>
              <div
                style={{
                  height: "100%",
                  width: `${overallProgress * 100}%`,
                  background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                  borderRadius: 3,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* Start button */}
        {(allLoaded || items.size === 0) && !audioReady && (
          <button
            onClick={handleClick}
            style={{
              padding: "12px 32px",
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontFamily: "monospace",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {items.size === 0 ? "Click to Join" : "Click to Start"}
          </button>
        )}
      </div>
    </div>
  );
}
