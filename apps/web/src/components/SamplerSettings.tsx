"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  type SampleSlot,
  SLOT_KEYBINDS,
  SLOT_COLORS,
  DEFAULT_SAMPLE_NAMES,
  getAllSampleMetadata,
  loadCustomSample,
  resetSlotToDefault,
  previewSample,
  onSampleChange,
  loadDefaultSamples,
} from "@/audio/sampler";

export type SamplerSettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  clientId: string;
  roomId: string;
};

interface SlotState {
  name: string;
  isCustom: boolean;
  isLoading: boolean;
  isRecording: boolean;
  error: string | null;
}

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";

/**
 * Sampler Settings Modal - allows users to customize sampler sounds
 */
export default function SamplerSettings({
  isOpen,
  onClose,
  clientId,
  roomId,
}: SamplerSettingsProps) {
  const [slots, setSlots] = useState<Record<SampleSlot, SlotState>>({
    0: { name: DEFAULT_SAMPLE_NAMES[0], isCustom: false, isLoading: false, isRecording: false, error: null },
    1: { name: DEFAULT_SAMPLE_NAMES[1], isCustom: false, isLoading: false, isRecording: false, error: null },
    2: { name: DEFAULT_SAMPLE_NAMES[2], isCustom: false, isLoading: false, isRecording: false, error: null },
    3: { name: DEFAULT_SAMPLE_NAMES[3], isCustom: false, isLoading: false, isRecording: false, error: null },
  });

  const fileInputRefs = useRef<Record<SampleSlot, HTMLInputElement | null>>({
    0: null,
    1: null,
    2: null,
    3: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const [recordingSlot, setRecordingSlot] = useState<SampleSlot | null>(null);

  // Load defaults and sync with current state on mount
  useEffect(() => {
    if (!isOpen) return;

    // Load default samples if not loaded
    loadDefaultSamples().then(() => {
      // Sync UI with current sample metadata
      const metadata = getAllSampleMetadata();
      setSlots((prev) => {
        const newSlots = { ...prev };
        for (const slot of [0, 1, 2, 3] as SampleSlot[]) {
          const meta = metadata[slot];
          if (meta) {
            newSlots[slot] = {
              ...newSlots[slot],
              name: meta.name,
              isCustom: meta.isCustom,
            };
          }
        }
        return newSlots;
      });
    });

    // Fetch custom sounds from server
    fetchCustomSounds();
  }, [isOpen, clientId, roomId]);

  // Subscribe to sample changes
  useEffect(() => {
    const unsubscribe = onSampleChange((slot, metadata) => {
      setSlots((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          name: metadata.name,
          isCustom: metadata.isCustom,
          isLoading: false,
          error: null,
        },
      }));
    });
    return unsubscribe;
  }, []);

  // Fetch custom sounds from server
  const fetchCustomSounds = useCallback(async () => {
    try {
      const url = `${REALTIME_URL}/api/sampler/sounds?clientId=${encodeURIComponent(clientId)}&roomId=${encodeURIComponent(roomId)}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error("[SamplerSettings] Failed to fetch custom sounds:", response.status);
        return;
      }

      const data = await response.json();
      console.log("[SamplerSettings] Fetched custom sounds:", data.sounds);

      // Load each custom sound into the sampler engine
      for (const sound of data.sounds) {
        const slot = sound.slot as SampleSlot;
        await loadCustomSample(slot, sound.url, sound.fileName);
      }
    } catch (error) {
      console.error("[SamplerSettings] Error fetching custom sounds:", error);
    }
  }, [clientId, roomId]);

  // Handle file upload
  const handleFileSelect = useCallback(async (slot: SampleSlot, file: File) => {
    console.log(`[SamplerSettings] Uploading file for slot ${slot}: ${file.name} (type: ${file.type})`);

    // Validate file type (accept common audio formats)
    // Note: MIME types may include codec info (e.g., "audio/webm;codecs=opus")
    const isValidAudio =
      file.type.startsWith("audio/mpeg") ||   // MP3
      file.type.startsWith("audio/wav") ||    // WAV
      file.type.startsWith("audio/x-wav") ||  // WAV (alternative)
      file.type.startsWith("audio/ogg") ||    // OGG
      file.type.startsWith("audio/webm") ||   // WebM (from recording)
      file.type.startsWith("audio/mp4");      // M4A/AAC

    if (!isValidAudio) {
      console.error(`[SamplerSettings] Invalid file type: ${file.type}`);
      setSlots((prev) => ({
        ...prev,
        [slot]: { ...prev[slot], error: "Invalid file type. Use MP3, WAV, OGG, WebM, or M4A." },
      }));
      return;
    }

    // Validate file size (1MB max)
    if (file.size > 1024 * 1024) {
      setSlots((prev) => ({
        ...prev,
        [slot]: { ...prev[slot], error: "File too large. Max 1MB." },
      }));
      return;
    }

    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], isLoading: true, error: null },
    }));

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clientId", clientId);
      formData.append("roomId", roomId);
      formData.append("slot", slot.toString());

      const response = await fetch(`${REALTIME_URL}/api/sampler/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }

      const result = await response.json();
      console.log(`[SamplerSettings] Upload success:`, result);

      // Load the sample into the sampler engine
      const name = file.name.replace(/\.[^.]+$/, ""); // Remove extension
      await loadCustomSample(slot, result.url, name);

      setSlots((prev) => ({
        ...prev,
        [slot]: { ...prev[slot], name, isCustom: true, isLoading: false },
      }));
    } catch (error) {
      console.error(`[SamplerSettings] Upload error:`, error);
      setSlots((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          isLoading: false,
          error: error instanceof Error ? error.message : "Upload failed",
        },
      }));
    }
  }, [clientId, roomId]);

  // Handle recording
  const startRecording = useCallback(async (slot: SampleSlot) => {
    console.log(`[SamplerSettings] Starting recording for slot ${slot}`);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Choose the best supported recording format
      // Prefer WebM with Opus codec (best quality + compression)
      let mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus";
        } else {
          mimeType = "audio/ogg";
        }
      }

      console.log(`[SamplerSettings] Recording with MIME type: ${mimeType}`);

      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      recordingChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordingChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log(`[SamplerSettings] Recording stopped for slot ${slot}`);

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());

        // Create blob from chunks
        const recordedMimeType = mediaRecorder.mimeType;
        const blob = new Blob(recordingChunksRef.current, { type: recordedMimeType });

        console.log(`[SamplerSettings] Recorded blob size: ${blob.size} bytes, type: ${recordedMimeType}`);

        // Convert to file
        const extension = recordedMimeType.includes("webm") ? "webm" : "ogg";
        const file = new File([blob], `recording-${Date.now()}.${extension}`, { type: recordedMimeType });

        console.log(`[SamplerSettings] Created file: ${file.name}, type: ${file.type}, size: ${file.size}`);

        // Upload the recorded file
        await handleFileSelect(slot, file);

        setRecordingSlot(null);
        setSlots((prev) => ({
          ...prev,
          [slot]: { ...prev[slot], isRecording: false },
        }));
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();

      setRecordingSlot(slot);
      setSlots((prev) => ({
        ...prev,
        [slot]: { ...prev[slot], isRecording: true, error: null },
      }));

      // Auto-stop after 5 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, 5000);
    } catch (error) {
      console.error(`[SamplerSettings] Recording error:`, error);
      setSlots((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          isRecording: false,
          error: "Microphone access denied",
        },
      }));
    }
  }, [handleFileSelect]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Handle reset to default
  const handleReset = useCallback(async (slot: SampleSlot) => {
    console.log(`[SamplerSettings] Resetting slot ${slot} to default`);

    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], isLoading: true, error: null },
    }));

    try {
      // Reset on server
      await fetch(`${REALTIME_URL}/api/sampler/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, roomId, slot }),
      });

      // Reset locally
      await resetSlotToDefault(slot);

      setSlots((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          name: DEFAULT_SAMPLE_NAMES[slot],
          isCustom: false,
          isLoading: false,
        },
      }));
    } catch (error) {
      console.error(`[SamplerSettings] Reset error:`, error);
      setSlots((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          isLoading: false,
          error: "Reset failed",
        },
      }));
    }
  }, [clientId, roomId]);

  // Handle preview
  const handlePreview = useCallback((slot: SampleSlot) => {
    console.log(`[SamplerSettings] Previewing slot ${slot}`);
    previewSample(slot);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, #1a1a1a 0%, #0f0f10 100%)",
          borderRadius: 12,
          border: "1px solid #333",
          padding: 24,
          width: 400,
          maxWidth: "90vw",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "#e5e5e5",
              letterSpacing: "0.025em",
            }}
          >
            Sampler Settings
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#666",
              fontSize: 24,
              cursor: "pointer",
              padding: 4,
              lineHeight: 1,
            }}
          >
            x
          </button>
        </div>

        {/* Slot list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {([0, 1, 2, 3] as SampleSlot[]).map((slot) => (
            <SlotRow
              key={slot}
              slot={slot}
              state={slots[slot]}
              fileInputRef={(el) => (fileInputRefs.current[slot] = el)}
              onFileSelect={handleFileSelect}
              onRecord={recordingSlot === slot ? stopRecording : () => startRecording(slot)}
              onReset={handleReset}
              onPreview={handlePreview}
              isRecording={recordingSlot === slot}
            />
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px solid #333",
            fontSize: 11,
            color: "#666",
            textAlign: "center",
          }}
        >
          Upload audio files (MP3/WAV/OGG/WebM/M4A, max 1MB) or record from mic (max 5s)
        </div>
      </div>
    </div>
  );
}

/**
 * Individual slot row component
 */
function SlotRow({
  slot,
  state,
  fileInputRef,
  onFileSelect,
  onRecord,
  onReset,
  onPreview,
  isRecording,
}: {
  slot: SampleSlot;
  state: SlotState;
  fileInputRef: (el: HTMLInputElement | null) => void;
  onFileSelect: (slot: SampleSlot, file: File) => void;
  onRecord: () => void;
  onReset: (slot: SampleSlot) => void;
  onPreview: (slot: SampleSlot) => void;
  isRecording: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        background: "rgba(255, 255, 255, 0.03)",
        borderRadius: 8,
        border: "1px solid #2a2a2a",
      }}
    >
      {/* Slot indicator */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          background: SLOT_COLORS[slot],
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 14,
          color: "#000",
          flexShrink: 0,
        }}
      >
        {SLOT_KEYBINDS[slot]}
      </div>

      {/* Sample info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "#e5e5e5",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {state.name}
        </div>
        <div
          style={{
            fontSize: 10,
            color: state.isCustom ? "#4ade80" : "#666",
            marginTop: 2,
          }}
        >
          {state.isLoading
            ? "Loading..."
            : state.isRecording
            ? "Recording..."
            : state.isCustom
            ? "Custom"
            : "Default"}
        </div>
        {state.error && (
          <div style={{ fontSize: 10, color: "#f87171", marginTop: 2 }}>
            {state.error}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        {/* Preview button */}
        <ActionButton
          onClick={() => onPreview(slot)}
          disabled={state.isLoading}
          title="Preview"
          icon="play"
        />

        {/* Upload button */}
        <ActionButton
          onClick={() => inputRef.current?.click()}
          disabled={state.isLoading || isRecording}
          title="Upload"
          icon="upload"
        />
        <input
          ref={(el) => {
            inputRef.current = el;
            fileInputRef(el);
          }}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onFileSelect(slot, file);
              e.target.value = "";
            }
          }}
        />

        {/* Record button */}
        <ActionButton
          onClick={onRecord}
          disabled={state.isLoading}
          active={isRecording}
          title={isRecording ? "Stop" : "Record"}
          icon="mic"
        />

        {/* Reset button */}
        {state.isCustom && (
          <ActionButton
            onClick={() => onReset(slot)}
            disabled={state.isLoading || isRecording}
            title="Reset"
            icon="reset"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Action button component
 */
function ActionButton({
  onClick,
  disabled,
  active,
  title,
  icon,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  icon: "play" | "upload" | "mic" | "reset";
}) {
  const icons = {
    play: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    ),
    upload: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
    mic: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    reset: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    ),
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        border: "none",
        background: active ? "#f87171" : "rgba(255, 255, 255, 0.08)",
        color: active ? "#fff" : disabled ? "#444" : "#999",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.15s ease",
      }}
    >
      {icons[icon]}
    </button>
  );
}
