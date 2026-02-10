/**
 * YouTube service for searching and extracting audio URLs.
 *
 * Uses youtube-dl-exec (yt-dlp) for reliable audio extraction.
 * Uses fluent-ffmpeg for transcoding to browser-compatible MP3.
 */

// @ts-ignore - No type definitions available
import { create as createYtDlp } from "youtube-dl-exec";
// @ts-ignore - No type definitions available
import play from "play-dl";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Use environment variables with fallbacks for different environments:
// - Production (Docker): uses system-installed binaries in PATH
// - Development (macOS): uses Homebrew paths
const ytDlpPath = process.env.YTDLP_PATH || (process.platform === "darwin" ? "/opt/homebrew/bin/yt-dlp" : "yt-dlp");
const ffmpegPath = process.env.FFMPEG_PATH || (process.platform === "darwin" ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
const youtubeDl = createYtDlp(ytDlpPath);

// Initialize play-dl with YouTube cookies if provided (runs async on first use)
// This helps avoid rate limiting and bot detection in production
let playDlInitialized = false;
const initPlayDl = async () => {
  if (playDlInitialized) return;

  if (process.env.YOUTUBE_COOKIE) {
    console.log(`[YouTube] Setting up authentication with cookies`);
    await play.setToken({
      youtube: {
        cookie: process.env.YOUTUBE_COOKIE
      }
    });
    console.log(`[YouTube] Authentication configured`);
  }

  playDlInitialized = true;
};

console.log(`[YouTube] Initializing YouTube service`);
console.log(`[YouTube] Platform: ${process.platform}`);
console.log(`[YouTube] yt-dlp path: ${ytDlpPath}`);
console.log(`[YouTube] ffmpeg path: ${ffmpegPath}`);
console.log(`[YouTube] Node version: ${process.version}`);

// ============================================================================
// Types
// ============================================================================

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number;
  durationFormatted: string;
  channelName: string;
}

export interface YouTubeAudioResult {
  url: string;
  mimeType: string;
  /** Approximate expiration time (URLs typically expire in ~6 hours) */
  expiresAt: number;
}

// ============================================================================
// Search
// ============================================================================

/**
 * Search YouTube for videos matching a query.
 *
 * @param query - Search query string
 * @param limit - Maximum number of results (default 15)
 * @returns Array of search results
 */
export async function searchYouTube(
  query: string,
  limit: number = 15
): Promise<YouTubeSearchResult[]> {
  console.log(`[YouTube] searchYouTube called with query="${query}", limit=${limit}`);

  try {
    // Initialize play-dl authentication if not already done
    await initPlayDl();

    console.log(`[YouTube] Calling play.search...`);

    // Request extra results to filter out non-music items
    const searchResults = await play.search(query, { limit: limit + 10, source: { youtube: "video" } });

    console.log(`[YouTube] play.search returned ${searchResults.length} raw results`);

    const results: YouTubeSearchResult[] = [];

    for (const item of searchResults) {
      // Only include video results
      if (item.type !== "video") {
        console.log(`[YouTube] Skipping non-video result: ${item.type}`);
        continue;
      }
      if (!item.id) {
        console.log(`[YouTube] Skipping result with no ID`);
        continue;
      }

      // Skip live streams
      if (item.live) {
        console.log(`[YouTube] Skipping live stream: ${item.title}`);
        continue;
      }

      // Get duration in seconds
      const durationSec = item.durationInSec || 0;

      // Skip very long videos (likely not songs) - max 20 minutes
      if (durationSec > 1200) {
        console.log(`[YouTube] Skipping long video (${durationSec}s): ${item.title}`);
        continue;
      }

      results.push({
        videoId: item.id,
        title: item.title || "Unknown Title",
        thumbnailUrl: item.thumbnails[0]?.url || "",
        durationSec,
        durationFormatted: item.durationRaw || "0:00",
        channelName: item.channel?.name || "Unknown",
      });

      if (results.length >= limit) break;
    }

    console.log(`[YouTube] Returning ${results.length} filtered results`);
    return results;
  } catch (error) {
    console.error("[YouTube] Search error:", error);
    console.error("[YouTube] Error type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("[YouTube] Error message:", error instanceof Error ? error.message : String(error));
    console.error("[YouTube] Error stack:", error instanceof Error ? error.stack : "No stack");
    throw new Error(`YouTube search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// ============================================================================
// Audio Extraction
// ============================================================================

/**
 * Get the audio stream URL for a YouTube video.
 *
 * @param videoId - YouTube video ID
 * @returns Audio URL and metadata
 */
export async function getYouTubeAudioUrl(
  videoId: string
): Promise<YouTubeAudioResult> {
  try {
    // Initialize play-dl authentication if not already done
    await initPlayDl();

    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Get video info using play-dl
    const info = await play.video_info(url);

    // Get audio formats
    const audioFormats = info.format.filter((f: any) => f.mimeType?.includes("audio"));

    if (audioFormats.length === 0) {
      throw new Error("No audio formats available");
    }

    // Sort by audio quality (bitrate)
    const sortedFormats = audioFormats.sort((a: any, b: any) => {
      const bitrateA = a.bitrate || 0;
      const bitrateB = b.bitrate || 0;
      return bitrateB - bitrateA;
    });

    const bestFormat = sortedFormats[0];

    if (!bestFormat || !bestFormat.url) {
      throw new Error("Audio format has no URL");
    }

    // YouTube URLs typically expire in ~6 hours
    const expiresAt = Date.now() + 6 * 60 * 60 * 1000;

    return {
      url: bestFormat.url,
      mimeType: bestFormat.mimeType || "audio/webm",
      expiresAt,
    };
  } catch (error) {
    console.error("[YouTube] Audio extraction error:", error);
    throw new Error(
      `Failed to get audio URL: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Download YouTube audio and transcode to MP3.
 * Uses yt-dlp for reliable downloading and ffmpeg for transcoding.
 *
 * @param videoId - YouTube video ID
 * @returns Audio buffer (MP3) and content type
 */
export async function getYouTubeAudioBuffer(
  videoId: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `yt-${videoId}-${Date.now()}.mp3`);
  let cookieFile: string | null = null;

  console.log(`[YouTube] Downloading audio for: ${videoId}`);

  try {
    // Prepare yt-dlp options
    const ytDlpOptions: any = {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 0, // best quality
      format: "bestaudio/best", // Select best audio format available
      output: tempFile,
      noPlaylist: true,
      quiet: false, // Enable output for debugging
      noWarnings: false,
      ffmpegLocation: ffmpegPath,
      preferFreeFormats: true, // Prefer free/open formats
    };

    // If YouTube cookies are provided, write them to a temp file and use them
    if (process.env.YOUTUBE_COOKIE) {
      cookieFile = path.join(tempDir, `yt-cookies-${Date.now()}.txt`);
      await fs.promises.writeFile(cookieFile, process.env.YOUTUBE_COOKIE);
      ytDlpOptions.cookies = cookieFile;
      console.log(`[YouTube] Using cookies for authentication`);
    }

    // Use yt-dlp to download and convert to MP3 in one step
    await youtubeDl(url, ytDlpOptions);

    console.log(`[YouTube] Downloaded to: ${tempFile}`);

    // Read the file into a buffer
    const buffer = await fs.promises.readFile(tempFile);
    console.log(`[YouTube] Audio buffer size: ${buffer.length} bytes`);

    // Clean up temp files
    await fs.promises.unlink(tempFile).catch(() => {
      // Ignore cleanup errors
    });
    if (cookieFile) {
      await fs.promises.unlink(cookieFile).catch(() => {});
    }

    return {
      buffer,
      contentType: "audio/mpeg",
    };
  } catch (error) {
    // Clean up temp files on error
    await fs.promises.unlink(tempFile).catch(() => {});
    if (cookieFile) {
      await fs.promises.unlink(cookieFile).catch(() => {});
    }

    console.error("[YouTube] Download error:", error);
    throw new Error(
      `Failed to download audio: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
