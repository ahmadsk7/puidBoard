/**
 * YouTube service for searching and extracting audio URLs.
 *
 * Uses youtube-dl-exec (yt-dlp) for reliable audio extraction.
 * Uses fluent-ffmpeg for transcoding to browser-compatible MP3.
 */

import { create as createYtDlp } from "youtube-dl-exec";
import play from "play-dl";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Use system-installed tools (homebrew) for reliability
const ytDlpPath = "/opt/homebrew/bin/yt-dlp";
const ffmpegPath = "/opt/homebrew/bin/ffmpeg";
const youtubeDl = createYtDlp(ytDlpPath);

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
  try {
    // Request extra results to filter out non-music items
    const searchResults = await play.search(query, { limit: limit + 10, source: { youtube: "video" } });

    const results: YouTubeSearchResult[] = [];

    for (const item of searchResults) {
      // Only include video results
      if (item.type !== "video") continue;
      if (!item.id) continue;

      // Skip live streams
      if (item.live) continue;

      // Get duration in seconds
      const durationSec = item.durationInSec || 0;

      // Skip very long videos (likely not songs) - max 20 minutes
      if (durationSec > 1200) continue;

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

    return results;
  } catch (error) {
    console.error("[YouTube] Search error:", error);
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
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Get video info using play-dl
    const info = await play.video_info(url);

    // Get audio formats
    const audioFormats = info.format.filter(f => f.mimeType?.includes("audio"));

    if (audioFormats.length === 0) {
      throw new Error("No audio formats available");
    }

    // Sort by audio quality (bitrate)
    const sortedFormats = audioFormats.sort((a, b) => {
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

  console.log(`[YouTube] Downloading audio for: ${videoId}`);

  try {
    // Use yt-dlp to download and convert to MP3 in one step
    await youtubeDl(url, {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 0, // best quality
      output: tempFile,
      noPlaylist: true,
      quiet: true,
      noWarnings: true,
      ffmpegLocation: ffmpegPath,
    });

    console.log(`[YouTube] Downloaded to: ${tempFile}`);

    // Read the file into a buffer
    const buffer = await fs.promises.readFile(tempFile);
    console.log(`[YouTube] Audio buffer size: ${buffer.length} bytes`);

    // Clean up temp file
    await fs.promises.unlink(tempFile).catch(() => {
      // Ignore cleanup errors
    });

    return {
      buffer,
      contentType: "audio/mpeg",
    };
  } catch (error) {
    // Clean up temp file on error
    await fs.promises.unlink(tempFile).catch(() => {});

    console.error("[YouTube] Download error:", error);
    throw new Error(
      `Failed to download audio: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
