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
import busboy from "busboy";
import { trackService, TrackValidationError } from "../services/tracks.js";
import { storageService } from "../services/storage.js";

// Max file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

interface ParsedFormData {
  fields: Record<string, string>;
  file: Buffer | null;
  filename: string | null;
  mimeType: string | null;
}

/**
 * Parse multipart form data using busboy.
 */
function parseMultipartForm(req: IncomingMessage): Promise<ParsedFormData> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      reject(new Error("Content-Type must be multipart/form-data"));
      return;
    }

    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let filename: string | null = null;
    let mimeType: string | null = null;
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let fileLimitExceeded = false;

    try {
      const bb = busboy({
        headers: req.headers,
        limits: {
          fileSize: MAX_FILE_SIZE,
          files: 1,
        },
      });

      bb.on("file", (fieldname, file, info) => {
        if (fieldname !== "file") {
          // Skip non-file fields
          file.resume();
          return;
        }

        filename = info.filename;
        mimeType = info.mimeType;

        file.on("data", (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize > MAX_FILE_SIZE) {
            fileLimitExceeded = true;
            file.destroy();
            return;
          }
          chunks.push(chunk);
        });

        file.on("limit", () => {
          fileLimitExceeded = true;
        });

        file.on("end", () => {
          if (!fileLimitExceeded && chunks.length > 0) {
            fileBuffer = Buffer.concat(chunks);
          }
        });

        file.on("error", (err) => {
          console.error("[parseMultipartForm] File stream error:", err);
        });
      });

      bb.on("field", (fieldname, value) => {
        fields[fieldname] = value;
      });

      bb.on("close", () => {
        if (fileLimitExceeded) {
          reject(new Error(`File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`));
          return;
        }
        resolve({
          fields,
          file: fileBuffer,
          filename,
          mimeType,
        });
      });

      bb.on("error", (err) => {
        console.error("[parseMultipartForm] Busboy error:", err);
        reject(err);
      });

      req.pipe(bb);
    } catch (err) {
      console.error("[parseMultipartForm] Setup error:", err);
      reject(err);
    }
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
 * Infer mime type from filename extension.
 */
function inferMimeTypeFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const ext = filename.toLowerCase().split(".").pop();
  const extToMime: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    aiff: "audio/aiff",
    aif: "audio/aiff",
    flac: "audio/flac",
  };
  return extToMime[ext || ""] || null;
}

/**
 * Handle POST /api/tracks/upload
 */
async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    console.log("[upload] Starting file upload...");

    const { fields, file, filename, mimeType: parsedMimeType } = await parseMultipartForm(req);

    if (!file) {
      console.log("[upload] No file in request");
      sendError(res, 400, "No file uploaded");
      return;
    }

    console.log(`[upload] Received file: ${filename} (${file.length} bytes, parsedMimeType=${parsedMimeType}, fieldMimeType=${fields.mimeType})`);

    const title = fields.title;
    const durationSec = parseFloat(fields.durationSec || "0");

    // Use parsed mimeType from file, fallback to field, fallback to inference from filename
    const inferredMimeType = inferMimeTypeFromFilename(filename);
    let mimeType = parsedMimeType || fields.mimeType;

    // If we got a generic mime type (like application/octet-stream), try to infer from filename
    if (!mimeType || mimeType === "application/octet-stream") {
      mimeType = inferredMimeType || mimeType;
      console.log(`[upload] Inferred mime type from filename: ${mimeType}`);
    }

    const finalFilename = filename || "upload";
    const ownerId = fields.ownerId;

    if (!title) {
      console.log("[upload] Missing title field");
      sendError(res, 400, "Missing required field: title");
      return;
    }

    if (!durationSec || durationSec <= 0) {
      console.log("[upload] Missing or invalid durationSec:", durationSec);
      sendError(res, 400, "Missing or invalid required field: durationSec");
      return;
    }

    if (!mimeType) {
      console.log("[upload] Missing mimeType");
      sendError(res, 400, "Missing required field: mimeType");
      return;
    }

    console.log(`[upload] Processing: title="${title}", duration=${durationSec}s, mimeType=${mimeType}`);

    const result = await trackService.upload({
      buffer: file,
      filename: finalFilename,
      mimeType,
      title,
      durationSec,
      ownerId,
    });

    console.log(`[upload] Success: trackId=${result.trackId}, dedup=${result.deduplication}`);

    sendJson(res, 200, {
      trackId: result.trackId,
      url: result.url,
      deduplication: result.deduplication,
    });
  } catch (error) {
    if (error instanceof TrackValidationError) {
      console.log("[upload] Validation error:", error.message);
      sendError(res, 400, error.message);
    } else {
      console.error("[upload] Server error:", error);
      sendError(res, 500, error instanceof Error ? error.message : "Internal server error");
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
 * Handle GET or HEAD /files/:storageKey
 */
async function handleServeFile(
  _req: IncomingMessage,
  res: ServerResponse,
  storageKey: string,
  headOnly = false
): Promise<void> {
  console.log(`[serveFile] Serving file: ${storageKey} (HEAD=${headOnly})`);
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

    if (headOnly) {
      res.end();
    } else {
      res.end(buffer);
    }
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

  // GET or HEAD /files/:storageKey
  const fileMatch = url.match(/^\/files\/(.+)$/);
  if ((method === "GET" || method === "HEAD") && fileMatch && fileMatch[1]) {
    await handleServeFile(req, res, fileMatch[1], method === "HEAD");
    return true;
  }

  return false;
}
