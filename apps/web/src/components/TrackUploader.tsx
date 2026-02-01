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
  console.log(`[TrackUploader] Getting duration for: ${file.name} (${file.size} bytes, type=${file.type})`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        console.log(`[TrackUploader] Read file as ArrayBuffer: ${arrayBuffer.byteLength} bytes`);

        const audioContext = new AudioContext();
        console.log(`[TrackUploader] Created AudioContext, state=${audioContext.state}`);

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log(`[TrackUploader] Decoded audio: duration=${audioBuffer.duration}s, sampleRate=${audioBuffer.sampleRate}`);

        await audioContext.close();
        resolve(audioBuffer.duration);
      } catch (err) {
        console.error("[TrackUploader] decodeAudioData failed:", err);
        reject(new Error(`Unable to analyze audio file: ${err instanceof Error ? err.message : String(err)}`));
      }
    };
    reader.onerror = () => {
      console.error("[TrackUploader] FileReader error");
      reject(new Error("Failed to read file"));
    };
    reader.readAsArrayBuffer(file);
  });
}

/** Infer mime type from filename extension */
function inferMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const extToMime: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    aiff: "audio/aiff",
    aif: "audio/aiff",
    flac: "audio/flac",
  };
  return extToMime[ext || ""] || "application/octet-stream";
}

/** Upload track to server */
async function uploadTrack(
  file: File,
  title: string,
  durationSec: number
): Promise<UploadResult> {
  // Use file.type if available, otherwise infer from extension
  const mimeType = file.type || inferMimeType(file.name);

  console.log(`[TrackUploader] Uploading: title="${title}", duration=${durationSec}s, mimeType=${mimeType}`);

  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  formData.append("durationSec", durationSec.toString());
  formData.append("mimeType", mimeType);

  const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";

  console.log(`[TrackUploader] Sending POST to ${realtimeUrl}/api/tracks/upload`);
  const response = await fetch(`${realtimeUrl}/api/tracks/upload`, {
    method: "POST",
    body: formData,
  });

  console.log(`[TrackUploader] Response: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed" }));
    console.error("[TrackUploader] Server error:", error);
    throw new Error(error.error || "Upload failed");
  }

  const data = await response.json();
  console.log("[TrackUploader] Upload success:", data);

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

      console.log(`[TrackUploader] File selected: ${file.name}, size=${file.size}, type="${file.type}"`);

      // Validate file type - check both mime type and extension
      // Some browsers may report incorrect or empty mime types
      const ext = file.name.toLowerCase().split(".").pop();
      const validExtensions = ["mp3", "wav", "aiff", "aif", "flac"];
      const isValidExtension = ext && validExtensions.includes(ext);
      const isValidMimeType = file.type.startsWith("audio/");

      if (!isValidMimeType && !isValidExtension) {
        console.log(`[TrackUploader] Invalid file type: mime="${file.type}", ext="${ext}"`);
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
