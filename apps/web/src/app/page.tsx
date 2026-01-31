import { VERSION } from "@puid-board/shared";

export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Virtual DJ Rooms</h1>
      <p>Multiplayer mixer - coming soon.</p>
      <p style={{ color: "#666", fontSize: "0.875rem" }}>
        Shared package version: {VERSION}
      </p>
    </main>
  );
}
