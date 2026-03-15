"use client";

import { useState, useCallback, useRef } from "react";

export interface ToastItem {
  id: string;
  message: string;
  color: string;
  type: "join" | "leave" | "rename";
}

const MAX_TOASTS = 3;
const TOAST_DURATION_MS = 3000;
const FADE_DURATION_MS = 500;

export function useToasts() {
  const [toasts, setToasts] = useState<(ToastItem & { fadingOut: boolean })[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `toast-${++counterRef.current}`;
    setToasts((prev) => {
      const next = [...prev, { ...toast, id, fadingOut: false }];
      // Trim to max
      if (next.length > MAX_TOASTS) {
        return next.slice(next.length - MAX_TOASTS);
      }
      return next;
    });

    // Start fade-out
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, fadingOut: true } : t))
      );
    }, TOAST_DURATION_MS - FADE_DURATION_MS);

    // Remove
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return { toasts, addToast };
}

export function ToastContainer({
  toasts,
}: {
  toasts: (ToastItem & { fadingOut: boolean })[];
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            color: toast.type === "leave" ? "#9ca3af" : "#f9fafb",
            fontSize: "0.8125rem",
            fontFamily: "system-ui, sans-serif",
            opacity: toast.fadingOut ? 0 : 1,
            transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: toast.color,
              flexShrink: 0,
            }}
          />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
