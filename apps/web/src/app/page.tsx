"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { VERSION } from "@puid-board/shared";
import { generateRoomCode } from "@/components/TopBar";

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");

  const handleCreateRoom = () => {
    const code = generateRoomCode();
    router.push(`/room/${encodeURIComponent(code)}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase().slice(0, 8);
    if (code.length >= 4) {
      router.push(`/room/${encodeURIComponent(code)}`);
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 480 }}>
      <h1>Virtual DJ Rooms</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        Create a room or join with a code. Share the link to mix together.
      </p>
      <p style={{ color: "#666", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Shared package version: {VERSION}
      </p>

      <section style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={handleCreateRoom}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Create Room
        </button>
        <p style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.5rem" }}>
          Creates a new room and copies the link to share.
        </p>
      </section>

      <section>
        <form onSubmit={handleJoinRoom}>
          <label htmlFor="join-code" style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
            Join with code
          </label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="join-code"
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="e.g. ABC123"
              maxLength={8}
              style={{
                padding: "0.5rem 0.75rem",
                fontSize: "1rem",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                width: "8rem",
                textTransform: "uppercase",
              }}
            />
            <button
              type="submit"
              disabled={joinCode.trim().length < 4}
              style={{
                padding: "0.5rem 1rem",
                background: joinCode.trim().length >= 4 ? "#22c55e" : "#9ca3af",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: joinCode.trim().length >= 4 ? "pointer" : "not-allowed",
                fontWeight: 500,
              }}
            >
              Join
            </button>
          </div>
          <p style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
            4–8 character room code
          </p>
        </form>
      </section>

      <p style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
        <Link href="/room" style={{ color: "#3b82f6" }}>
          Open room (mock)
        </Link>{" "}
        when <code>NEXT_PUBLIC_USE_MOCK_ROOM=true</code>
      </p>
    </main>
  );
}
