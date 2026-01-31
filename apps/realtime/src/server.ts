import { createServer } from "http";
import { Server } from "socket.io";
import { VERSION } from "@puid-board/shared";

const PORT = process.env.PORT ?? 3001;
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(",") ?? [
  "http://localhost:3000",
];

const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: VERSION }));
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
});

io.on("connection", (socket) => {
  console.log(`[connect] client=${socket.id}`);

  socket.on("disconnect", (reason) => {
    console.log(`[disconnect] client=${socket.id} reason=${reason}`);
  });

  // Placeholder for room and event handlers (PR 1.1+)
});

httpServer.listen(PORT, () => {
  console.log(`[realtime] server listening on port ${PORT}`);
  console.log(`[realtime] shared package version: ${VERSION}`);
});
