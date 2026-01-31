import { createServer } from "http";
import { Server } from "socket.io";
import { VERSION } from "@puid-board/shared";
import { registerHandlers } from "./protocol/handlers.js";
import { roomStore } from "./rooms/store.js";
import { handleTrackApiRequest } from "./http/api.js";
import { initPersistence, getPersistence } from "./rooms/persistence.js";

const PORT = process.env.PORT ?? 3001;
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(",") ?? [
  "http://localhost:3000",
];

const httpServer = createServer(async (req, res) => {
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
