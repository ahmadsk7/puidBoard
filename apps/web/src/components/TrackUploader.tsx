"use client";

import { useRef, useState, useCallback } from "react";

export type UploadResult = {
  trackId: string;
  title: string;
  durationSec: number;
  url: string;
};

export type TrackUploaderProps = {
  onUploadComplete: (result: UploadResult) => void;
  disabled?: boolean;
};

/** Get audio duration using Web Audio API */
async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        await audioContext.close();
        resolve(audioBuffer.duration);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

/** Upload track to server */
async function uploadTrack(
  file: File,
  title: string,
  durationSec: number
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  formData.append("durationSec", durationSec.toString());
  formData.append("mimeType", file.type);

  const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";

  const response = await fetch(`${realtimeUrl}/api/tracks/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(error.error || "Upload failed");
  }

  const data = await response.json();

  return {
    trackId: data.trackId,
    title,
    durationSec,
    url: data.url,
  };
}

/**
 * TrackUploader - File input + upload logic for adding tracks.
 * Dark theme design to match DJ board aesthetic.
 */
export default function TrackUploader({
  onUploadComplete,
  disabled = false,
}: TrackUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(() => {
    if (!disabled && !isUploading) {
      inputRef.current?.click();
    }
  }, [disabled, isUploading]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so same file can be selected again
      e.target.value = "";

      // Validate file type
      if (!file.type.startsWith("audio/")) {
        setError("Please select an audio file (MP3, WAV, etc.)");
        return;
      }

      // Validate file size (50MB max)
      if (file.size > 50 * 1024 * 1024) {
        setError("File too large (max 50MB)");
        return;
      }

      setIsUploading(true);
      setError(null);

      try {
        // Extract duration
        setProgress("Analyzing...");
        const duration = await getAudioDuration(file);

        // Upload to server
        setProgress("Uploading...");
        const title = file.name.replace(/\.[^.]+$/, ""); // Remove extension
        const result = await uploadTrack(file, title, duration);

        setProgress("");
        onUploadComplete(result);
      } catch (err) {
        console.error("[TrackUploader] Error:", err);
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
        setProgress("");
      }
    },
    [onUploadComplete]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isUploading}
        style={{
          padding: "0.375rem 0.625rem",
          fontSize: "0.6875rem",
          fontWeight: 500,
          background: isUploading ? "#262626" : "rgba(34, 197, 94, 0.15)",
          color: isUploading ? "#525252" : "#4ade80",
          border: "none",
          borderRadius: 4,
          cursor: disabled || isUploading ? "not-allowed" : "pointer",
          letterSpacing: "0.02em",
          transition: "all 0.15s ease",
          minWidth: 60,
        }}
        onMouseEnter={(e) => {
          if (!disabled && !isUploading) {
            e.currentTarget.style.background = "rgba(34, 197, 94, 0.25)";
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled && !isUploading) {
            e.currentTarget.style.background = "rgba(34, 197, 94, 0.15)";
          }
        }}
      >
        {isUploading ? progress || "..." : "+ Add"}
      </button>

      {error && (
        <div
          style={{
            fontSize: "0.5625rem",
            color: "#f87171",
            maxWidth: 120,
            textAlign: "right",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
