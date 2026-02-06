"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ============================================================================
// Types
// ============================================================================

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number;
  durationFormatted: string;
  channelName: string;
}

export interface YouTubeTrackData {
  videoId: string;
  title: string;
  durationSec: number;
  thumbnailUrl: string;
  url: string;
}

export type YouTubeSearchProps = {
  onAddTrack: (track: YouTubeTrackData) => void;
};

// ============================================================================
// Component
// ============================================================================

export default function YouTubeSearch({ onAddTrack }: YouTubeSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingVideoId, setLoadingVideoId] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get realtime URL
  const realtimeUrl =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001"
      : "http://localhost:3001";

  // Debounced search
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setShowResults(false);
        return;
      }

      setIsSearching(true);
      setError(null);

      try {
        // Request 15 results for a better selection
        const res = await fetch(
          `${realtimeUrl}/api/youtube/search?q=${encodeURIComponent(searchQuery)}&limit=15`
        );

        if (!res.ok) {
          throw new Error(`Search failed: ${res.status}`);
        }

        const data = await res.json();
        setResults(data.results || []);
        setShowResults(true);
      } catch (err) {
        console.error("[YouTubeSearch] Search error:", err);
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [realtimeUrl]
  );

  // Handle input change with debounce
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      // Clear previous timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      // Debounce search by 400ms
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(value);
      }, 400);
    },
    [performSearch]
  );

  // Handle add to queue
  const handleAddToQueue = useCallback(
    (result: YouTubeSearchResult) => {
      setLoadingVideoId(result.videoId);
      setError(null);

      try {
        // For YouTube tracks, we use the stream proxy URL
        // The actual streaming happens when the track is loaded to a deck
        const streamUrl = `${realtimeUrl}/api/youtube/stream/${result.videoId}`;

        // Call the callback with track data
        onAddTrack({
          videoId: result.videoId,
          title: result.title,
          durationSec: result.durationSec,
          thumbnailUrl: result.thumbnailUrl,
          url: streamUrl,
        });

        // Clear search after adding
        setQuery("");
        setResults([]);
        setShowResults(false);
      } catch (err) {
        console.error("[YouTubeSearch] Add to queue error:", err);
        setError(err instanceof Error ? err.message : "Failed to add track");
      } finally {
        setLoadingVideoId(null);
      }
    },
    [realtimeUrl, onAddTrack]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {/* Search Input */}
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder="Search YouTube for songs..."
          style={{
            width: "100%",
            padding: "0.5rem 0.75rem",
            paddingRight: "2rem",
            background: "#1a1a1b",
            border: "1px solid #333",
            borderRadius: "6px",
            color: "#e5e5e5",
            fontSize: "0.8125rem",
            outline: "none",
          }}
        />
        {/* Search icon or spinner */}
        <div
          style={{
            position: "absolute",
            right: "0.5rem",
            top: "50%",
            transform: "translateY(-50%)",
            color: "#666",
            fontSize: "0.75rem",
          }}
        >
          {isSearching ? "..." : "🔍"}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem",
            background: "#3f1f1f",
            borderRadius: "4px",
            color: "#ff6b6b",
            fontSize: "0.75rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Results dropdown */}
      {showResults && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: "400px",
            overflowY: "auto",
            background: "#1a1a1b",
            border: "1px solid #333",
            borderRadius: "6px",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {results.map((result) => (
            <div
              key={result.videoId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #262626",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#262626";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {/* Thumbnail */}
              <div
                style={{
                  width: "48px",
                  height: "36px",
                  borderRadius: "4px",
                  overflow: "hidden",
                  flexShrink: 0,
                  background: "#333",
                }}
              >
                {result.thumbnailUrl && (
                  <img
                    src={result.thumbnailUrl}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.8125rem",
                    color: "#e5e5e5",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {result.title}
                </div>
                <div
                  style={{
                    fontSize: "0.6875rem",
                    color: "#666",
                    marginTop: "2px",
                  }}
                >
                  {result.channelName} • {result.durationFormatted}
                </div>
              </div>

              {/* Add button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddToQueue(result);
                }}
                disabled={loadingVideoId === result.videoId}
                style={{
                  padding: "0.375rem 0.75rem",
                  background:
                    loadingVideoId === result.videoId ? "#333" : "#ff4444",
                  border: "none",
                  borderRadius: "4px",
                  color: "#fff",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  cursor:
                    loadingVideoId === result.videoId
                      ? "not-allowed"
                      : "pointer",
                  opacity: loadingVideoId === result.videoId ? 0.7 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {loadingVideoId === result.videoId ? "Adding..." : "+ Add"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* No results message */}
      {showResults && results.length === 0 && query.trim() && !isSearching && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            padding: "1rem",
            background: "#1a1a1b",
            border: "1px solid #333",
            borderRadius: "6px",
            zIndex: 100,
            textAlign: "center",
            color: "#666",
            fontSize: "0.8125rem",
          }}
        >
          No results found
        </div>
      )}
    </div>
  );
}
