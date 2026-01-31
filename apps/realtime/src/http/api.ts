/**
 * HTTP API for track asset management.
 *
 * Endpoints:
 * - POST /api/tracks/upload - Upload a track
 * - GET /api/tracks/:id - Get track metadata
 * - GET /api/tracks/:id/url - Get track CDN URL
 * - GET /files/:storageKey - Serve track file
 * - GET /api/tracks/sample-pack - List sample pack tracks
 */

import type { IncomingMessage, ServerResponse } from "http";
import multer from "multer";
import { trackService, TrackValidationError } from "../services/tracks.js";
import { storageService } from "../services/storage.js";

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 1,
  },
});

/**
 * Parse multipart form data.
 */
function parseMultipartForm(
  req: IncomingMessage
): Promise<{ fields: Record<string, string>; file: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const uploadSingle = upload.single("file");
    uploadSingle(req as any, {} as any, (err: any) => {
      if (err) {
        reject(err);
        return;
      }

      const multerReq = req as any;
      const fields: Record<string, string> = multerReq.body || {};
      const file = multerReq.file?.buffer || null;

      resolve({ fields, file });
    });
  });
}

/**
 * Send JSON response.
 */
function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: any
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Send error response.
 */
function sendError(
  res: ServerResponse,
  statusCode: number,
  message: string
): void {
  sendJson(res, statusCode, { error: message });
}

/**
 * Handle POST /api/tracks/upload
 */
async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const { fields, file } = await parseMultipartForm(req);

    if (!file) {
      sendError(res, 400, "No file uploaded");
      return;
    }

    const title = fields.title;
    const durationSec = parseFloat(fields.durationSec || "0");
    const mimeType = (req as any).file?.mimetype || fields.mimeType;
    const filename = (req as any).file?.originalname || "upload";
    const ownerId = fields.ownerId;

    if (!title) {
      sendError(res, 400, "Missing required field: title");
      return;
    }

    if (!durationSec || durationSec <= 0) {
      sendError(res, 400, "Missing or invalid required field: durationSec");
      return;
    }

    const result = await trackService.upload({
      buffer: file,
      filename,
      mimeType,
      title,
      durationSec,
      ownerId,
    });

    sendJson(res, 200, {
      trackId: result.trackId,
      url: result.url,
      deduplication: result.deduplication,
    });
  } catch (error) {
    if (error instanceof TrackValidationError) {
      sendError(res, 400, error.message);
    } else {
      console.error("[upload] error:", error);
      sendError(res, 500, "Internal server error");
    }
  }
}

/**
 * Handle GET /api/tracks/:id
 */
async function handleGetTrack(
  _req: IncomingMessage,
  res: ServerResponse,
  trackId: string
): Promise<void> {
  try {
    const track = await trackService.getById(trackId);

    if (!track) {
      sendError(res, 404, "Track not found");
      return;
    }

    sendJson(res, 200, {
      id: track.id,
      title: track.title,
      durationSec: track.durationSec,
      mimeType: track.mimeType,
      source: track.source,
      createdAt: track.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("[getTrack] error:", error);
    sendError(res, 500, "Internal server error");
  }
}

/**
 * Handle GET /api/tracks/:id/url
 */
async function handleGetTrackUrl(
  _req: IncomingMessage,
  res: ServerResponse,
  trackId: string
): Promise<void> {
  try {
    const url = await trackService.getUrl(trackId);

    if (!url) {
      sendError(res, 404, "Track not found");
      return;
    }

    sendJson(res, 200, { url });
  } catch (error) {
    console.error("[getTrackUrl] error:", error);
    sendError(res, 500, "Internal server error");
  }
}

/**
 * Handle GET /files/:storageKey
 */
async function handleServeFile(
  _req: IncomingMessage,
  res: ServerResponse,
  storageKey: string
): Promise<void> {
  try {
    const buffer = await storageService.read(storageKey);

    // Determine content type from storage key extension
    const ext = storageKey.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      aiff: "audio/aiff",
      flac: "audio/flac",
    };
    const contentType = mimeTypes[ext || ""] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": buffer.length,
      "Cache-Control": "public, max-age=31536000", // 1 year
      "Access-Control-Allow-Origin": "*",
    });
    res.end(buffer);
  } catch (error) {
    console.error("[serveFile] error:", error);
    sendError(res, 404, "File not found");
  }
}

/**
 * Handle GET /api/tracks/sample-pack
 */
async function handleListSamplePack(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const tracks = await trackService.listSamplePack();

    sendJson(
      res,
      200,
      tracks.map((t) => ({
        id: t.id,
        title: t.title,
        durationSec: t.durationSec,
        source: t.source,
      }))
    );
  } catch (error) {
    console.error("[listSamplePack] error:", error);
    sendError(res, 500, "Internal server error");
  }
}

/**
 * Main HTTP request handler for track API.
 */
export async function handleTrackApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "GET";

  // POST /api/tracks/upload
  if (method === "POST" && url === "/api/tracks/upload") {
    await handleUpload(req, res);
    return true;
  }

  // GET /api/tracks/sample-pack
  if (method === "GET" && url === "/api/tracks/sample-pack") {
    await handleListSamplePack(req, res);
    return true;
  }

  // GET /api/tracks/:id
  const trackMatch = url.match(/^\/api\/tracks\/([^/]+)$/);
  if (method === "GET" && trackMatch && trackMatch[1]) {
    await handleGetTrack(req, res, trackMatch[1]);
    return true;
  }

  // GET /api/tracks/:id/url
  const urlMatch = url.match(/^\/api\/tracks\/([^/]+)\/url$/);
  if (method === "GET" && urlMatch && urlMatch[1]) {
    await handleGetTrackUrl(req, res, urlMatch[1]);
    return true;
  }

  // GET /files/:storageKey
  const fileMatch = url.match(/^\/files\/(.+)$/);
  if (method === "GET" && fileMatch && fileMatch[1]) {
    await handleServeFile(req, res, fileMatch[1]);
    return true;
  }

  return false;
}
