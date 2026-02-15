/**
 * HTTP API for track asset management.
 *
 * Endpoints:
 * - POST /api/tracks/upload - Upload a track
 * - GET /api/tracks/:id - Get track metadata
 * - GET /api/tracks/:id/url - Get track CDN URL
 * - GET /files/:storageKey - Serve track file
 * - GET /api/tracks/sample-pack - List sample pack tracks
 *
 * Sampler sound endpoints:
 * - POST /api/sampler/upload - Upload a sampler sound
 * - GET /api/sampler/sounds?clientId=X&roomId=Y - Get all custom sounds for client in room
 * - DELETE /api/sampler/sounds/:id - Delete a sampler sound
 * - POST /api/sampler/reset - Reset a slot to default
 *
 * YouTube endpoints:
 * - GET /api/youtube/search?q=... - Search YouTube for songs
 * - GET /api/youtube/stream/:videoId - Stream YouTube audio (proxied through server)
 */

import type { IncomingMessage, ServerResponse } from "http";
import busboy from "busboy";
import { trackService, TrackValidationError } from "../services/tracks.js";
import { storageService } from "../services/storage.js";
import { samplerSoundsService, SamplerSoundValidationError } from "../services/samplerSounds.js";
import { searchYouTube, getYouTubeAudioUrl } from "../services/youtube.js";

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
    ogg: "audio/ogg",
    webm: "audio/webm",
  };
  return extToMime[ext || ""] || null;
}

/**
 * Parse URL query parameters
 */
function parseQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return params;

  const queryString = url.slice(queryStart + 1);
  const pairs = queryString.split("&");
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (key && value) {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  return params;
}

/**
 * Read JSON body from request
 */
function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString();
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
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

    // CORS is handled at the server level for file endpoints
    // The main server.ts adds the Access-Control-Allow-Origin header
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": buffer.length,
      "Cache-Control": "public, max-age=31536000", // 1 year
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

// ============================================================================
// SAMPLER SOUND ENDPOINTS
// ============================================================================

/**
 * Handle POST /api/sampler/upload
 */
async function handleSamplerUpload(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    console.log("[samplerUpload] Starting sampler sound upload...");

    const { fields, file, filename, mimeType: parsedMimeType } = await parseMultipartForm(req);

    if (!file) {
      console.log("[samplerUpload] No file in request");
      sendError(res, 400, "No file uploaded");
      return;
    }

    console.log(`[samplerUpload] Received file: ${filename} (${file.length} bytes), parsedMimeType=${parsedMimeType}, fieldMimeType=${fields.mimeType}`);

    const clientId = fields.clientId;
    const roomId = fields.roomId;
    const slot = parseInt(fields.slot || "-1", 10) as 0 | 1 | 2 | 3;

    if (!clientId) {
      sendError(res, 400, "Missing required field: clientId");
      return;
    }

    if (!roomId) {
      sendError(res, 400, "Missing required field: roomId");
      return;
    }

    if (slot < 0 || slot > 3) {
      sendError(res, 400, "Invalid slot: must be 0, 1, 2, or 3");
      return;
    }

    // Infer mime type if needed
    const inferredMimeType = inferMimeTypeFromFilename(filename);
    let mimeType = parsedMimeType || fields.mimeType;
    if (!mimeType || mimeType === "application/octet-stream") {
      mimeType = inferredMimeType || mimeType;
      console.log(`[samplerUpload] Inferred mime type from filename: ${mimeType}`);
    }

    if (!mimeType) {
      console.log("[samplerUpload] ERROR: Could not determine file type");
      sendError(res, 400, "Could not determine file type");
      return;
    }

    console.log(`[samplerUpload] Final mimeType for upload: "${mimeType}"`);

    const result = await samplerSoundsService.upload({
      buffer: file,
      filename: filename || "sample",
      mimeType,
      clientId,
      roomId,
      slot,
    });

    console.log(`[samplerUpload] Success: soundId=${result.soundId}`);

    sendJson(res, 200, {
      soundId: result.soundId,
      url: result.url,
      fileName: result.fileName,
      slot,
    });
  } catch (error) {
    if (error instanceof SamplerSoundValidationError) {
      console.log("[samplerUpload] Validation error:", error.message);
      sendError(res, 400, error.message);
    } else {
      console.error("[samplerUpload] Server error:", error);
      sendError(res, 500, error instanceof Error ? error.message : "Internal server error");
    }
  }
}

/**
 * Handle GET /api/sampler/sounds?clientId=X&roomId=Y
 */
async function handleGetSamplerSounds(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const params = parseQueryParams(req.url || "");
    const clientId = params.clientId;
    const roomId = params.roomId;

    if (!clientId || !roomId) {
      sendError(res, 400, "Missing required query params: clientId and roomId");
      return;
    }

    console.log(`[getSamplerSounds] Getting sounds for client=${clientId}, room=${roomId}`);

    const sounds = await samplerSoundsService.getClientRoomSounds(clientId, roomId);

    sendJson(res, 200, {
      sounds: sounds.map((s) => ({
        id: s.id,
        slot: s.slot,
        fileName: s.fileName,
        url: s.fileUrl,
        isDefault: s.isDefault,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[getSamplerSounds] error:", error);
    sendError(res, 500, "Internal server error");
  }
}

/**
 * Handle DELETE /api/sampler/sounds/:id
 */
async function handleDeleteSamplerSound(
  _req: IncomingMessage,
  res: ServerResponse,
  soundId: string
): Promise<void> {
  try {
    console.log(`[deleteSamplerSound] Deleting sound: ${soundId}`);

    const deleted = await samplerSoundsService.delete(soundId);

    if (!deleted) {
      sendError(res, 404, "Sound not found");
      return;
    }

    sendJson(res, 200, { success: true });
  } catch (error) {
    console.error("[deleteSamplerSound] error:", error);
    sendError(res, 500, "Internal server error");
  }
}

/**
 * Handle POST /api/sampler/reset
 * Body: { clientId, roomId, slot }
 */
async function handleResetSamplerSlot(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const { clientId, roomId, slot } = body;

    if (!clientId || !roomId || slot === undefined) {
      sendError(res, 400, "Missing required fields: clientId, roomId, slot");
      return;
    }

    if (slot < 0 || slot > 3) {
      sendError(res, 400, "Invalid slot: must be 0, 1, 2, or 3");
      return;
    }

    console.log(`[resetSamplerSlot] Resetting slot ${slot} for client=${clientId}, room=${roomId}`);

    await samplerSoundsService.resetSlot(clientId, roomId, slot);

    sendJson(res, 200, { success: true, slot });
  } catch (error) {
    console.error("[resetSamplerSlot] error:", error);
    sendError(res, 500, "Internal server error");
  }
}

// ============================================================================
// YOUTUBE ENDPOINTS
// ============================================================================

/**
 * Handle GET /api/youtube/search?q=...
 */
async function handleYouTubeSearch(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const params = parseQueryParams(req.url || "");
    const query = params.q;
    const limit = parseInt(params.limit || "15", 10);

    console.log(`[youtubeSearch] Received request. URL: ${req.url}, query: ${query}, limit: ${limit}`);

    if (!query) {
      console.log(`[youtubeSearch] Error: Missing query parameter`);
      sendError(res, 400, "Missing required query param: q");
      return;
    }

    console.log(`[youtubeSearch] Starting search for: "${query}" (limit=${limit})`);

    const results = await searchYouTube(query, Math.min(limit, 25));

    console.log(`[youtubeSearch] Successfully found ${results.length} results`);

    sendJson(res, 200, { results });
  } catch (error) {
    console.error("[youtubeSearch] Error occurred:", error);
    console.error("[youtubeSearch] Error stack:", error instanceof Error ? error.stack : "No stack trace");
    sendError(res, 500, error instanceof Error ? error.message : "Search failed");
  }
}

/**
 * Handle GET /api/youtube/stream/:videoId
 * Proxies YouTube audio through our server to avoid CORS issues
 */
async function handleYouTubeStream(
  req: IncomingMessage,
  res: ServerResponse,
  videoId: string
): Promise<void> {
  console.log(`[youtubeStream] ========== STREAM REQUEST START ==========`);
  console.log(`[youtubeStream] videoId: ${videoId}`);
  console.log(`[youtubeStream] Client: ${req.headers['user-agent']}`);
  console.log(`[youtubeStream] Range: ${req.headers.range || 'none'}`);

  try {
    // Get the audio URL from yt-dlp
    console.log(`[youtubeStream] Step 1: Calling getYouTubeAudioUrl...`);
    const result = await getYouTubeAudioUrl(videoId);
    const audioUrl = result.url;

    console.log(`[youtubeStream] ✓ Step 1 complete. Audio URL obtained.`);
    console.log(`[youtubeStream] Step 2: Fetching audio from Google servers...`);

    // Fetch the audio from Google servers
    const response = await fetch(audioUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Range': req.headers.range || 'bytes=0-'
      }
    });

    console.log(`[youtubeStream] Google response status: ${response.status}`);
    console.log(`[youtubeStream] Google response headers:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      console.error(`[youtubeStream] ✗ Failed to fetch audio from Google: ${response.status} ${response.statusText}`);
      sendError(res, 502, "Failed to fetch audio from YouTube");
      return;
    }

    console.log(`[youtubeStream] ✓ Step 2 complete. Audio fetched from Google.`);
    console.log(`[youtubeStream] Step 3: Streaming to client...`);

    // Set CORS and streaming headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');

    // Forward range headers for seeking support
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');

    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
      res.writeHead(206); // Partial Content
    } else {
      res.writeHead(200);
    }

    // Stream the audio data
    if (response.body) {
      const reader = response.body.getReader();

      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(value)) {
              await new Promise(resolve => res.once('drain', resolve));
            }
          }
          res.end();
        } catch (error) {
          console.error(`[youtubeStream] Stream error:`, error);
          res.end();
        }
      };

      await pump();
    } else {
      res.end();
    }

    console.log(`[youtubeStream] ✓ Step 3 complete. Stream finished.`);
    console.log(`[youtubeStream] ========== STREAM REQUEST SUCCESS ==========`);
  } catch (error) {
    console.error("[youtubeStream] ========== STREAM REQUEST FAILED ==========");
    console.error("[youtubeStream] Error type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("[youtubeStream] Error message:", error instanceof Error ? error.message : String(error));
    console.error("[youtubeStream] Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    console.error("[youtubeStream] Full error:", error);
    console.error("[youtubeStream] ================================================");
    if (!res.headersSent) {
      sendError(res, 500, error instanceof Error ? error.message : "Stream proxy failed");
    }
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

  // Log all API requests for debugging
  if (url.startsWith("/api/")) {
    console.log(`[API] ${method} ${url}`);
  }

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

  // ============================================================================
  // SAMPLER SOUND ROUTES
  // ============================================================================

  // POST /api/sampler/upload
  if (method === "POST" && url === "/api/sampler/upload") {
    await handleSamplerUpload(req, res);
    return true;
  }

  // GET /api/sampler/sounds?clientId=X&roomId=Y
  if (method === "GET" && url.startsWith("/api/sampler/sounds")) {
    await handleGetSamplerSounds(req, res);
    return true;
  }

  // DELETE /api/sampler/sounds/:id
  const samplerDeleteMatch = url.match(/^\/api\/sampler\/sounds\/([^/?]+)$/);
  if (method === "DELETE" && samplerDeleteMatch && samplerDeleteMatch[1]) {
    await handleDeleteSamplerSound(req, res, samplerDeleteMatch[1]);
    return true;
  }

  // POST /api/sampler/reset
  if (method === "POST" && url === "/api/sampler/reset") {
    await handleResetSamplerSlot(req, res);
    return true;
  }

  // ============================================================================
  // YOUTUBE ROUTES
  // ============================================================================

  // GET /api/health - Service health check with version info
  if (method === "GET" && url === "/api/health") {
    console.log(`[API] Health check`);
    sendJson(res, 200, {
      status: "ok",
      service: "puidboard-realtime",
      version: "1.0.0-webm-fix",  // Update this when deploying fixes
      platform: process.platform,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
      features: {
        samplerFormats: ["MP3", "WAV", "OGG", "WebM", "M4A"],
        youtubeSearch: true,
        youtubeStream: true,
      },
    });
    return true;
  }

  // GET /api/youtube/status - YouTube service health check
  if (method === "GET" && url === "/api/youtube/status") {
    console.log(`[API] YouTube status check`);
    sendJson(res, 200, {
      status: "ok",
      service: "youtube",
      platform: process.platform,
      nodeVersion: process.version,
    });
    return true;
  }

  // GET /api/youtube/search?q=...
  if (method === "GET" && url.startsWith("/api/youtube/search")) {
    console.log(`[API] Matched YouTube search route: ${url}`);
    await handleYouTubeSearch(req, res);
    return true;
  }

  // GET /api/youtube/stream/:videoId (proxy stream to avoid CORS)
  const youtubeStreamMatch = url.match(/^\/api\/youtube\/stream\/([^/?]+)$/);
  if (method === "GET" && youtubeStreamMatch && youtubeStreamMatch[1]) {
    await handleYouTubeStream(req, res, youtubeStreamMatch[1]);
    return true;
  }

  return false;
}
