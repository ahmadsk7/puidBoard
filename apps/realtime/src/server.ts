import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Load environment variables from .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../.env.local");
dotenv.config({ path: envPath });

import { createServer } from "http";
import { Server } from "socket.io";
import { VERSION } from "@puid-board/shared";
import { registerHandlers } from "./protocol/handlers.js";
import { roomStore } from "./rooms/store.js";
import { handleTrackApiRequest } from "./http/api.js";
import { initPersistence, getPersistence } from "./rooms/persistence.js";

const PORT = process.env.PORT ?? 3001;

// Parse CORS origins from environment variable
// Supports comma-separated list: "http://localhost:3000,https://puidboard.com"
// Automatically includes both www and non-www versions of each origin
const baseCorsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  : ["http://localhost:3000"];

// Expand to include both www and non-www versions
const CORS_ORIGINS: string[] = [];
baseCorsOrigins.forEach((origin) => {
  CORS_ORIGINS.push(origin);
  // Add www version if origin doesn't have it
  if (!origin.includes("www.")) {
    const wwwVersion = origin.replace("://", "://www.");
    CORS_ORIGINS.push(wwwVersion);
  }
  // Add non-www version if origin has www
  if (origin.includes("www.")) {
    const nonWwwVersion = origin.replace("://www.", "://");
    CORS_ORIGINS.push(nonWwwVersion);
  }
});

console.log(`[realtime] CORS origins: ${CORS_ORIGINS.join(", ")}`);

const httpServer = createServer(async (req, res) => {
  // Add CORS headers for all HTTP requests
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", CORS_ORIGINS[0] || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.url === "/health") {
    const persistence = getPersistence();
    const persistenceStats = persistence.getStats();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        version: VERSION,
        rooms: roomStore.getRoomCount(),
        clients: roomStore.getClientCount(),
        persistence: persistenceStats,
      })
    );
    return;
  }

  // Track API endpoints
  const handled = await handleTrackApiRequest(req, res);
  if (handled) {
    return;
  }

  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

io.on("connection", (socket) => {
  console.log(`[connect] socket=${socket.id}`);

  // Register all protocol handlers
  registerHandlers(io, socket);
});

// Initialize persistence and start server
(async () => {
  await initPersistence();

  httpServer.listen(PORT, () => {
    console.log(`[realtime] server listening on port ${PORT}`);
    console.log(`[realtime] shared package version: ${VERSION}`);
  });
})();
