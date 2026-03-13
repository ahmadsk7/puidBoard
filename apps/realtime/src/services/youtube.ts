/**
 * YouTube service for searching and extracting audio.
 *
 * APPROACH:
 * - Search: YouTube Data API v3 (official, reliable)
 * - Audio extraction: yt-dlp + ffmpeg on the server
 *   yt-dlp handles format selection, anti-bot, HLS assembly, etc.
 *   ffmpeg extracts pure audio from whatever format YouTube serves.
 *   The server streams the resulting audio file to the client.
 * - Client: Receives audio bytes, decodes with Web Audio API for full DJ controls
 */

import { google } from 'googleapis';
import { spawn } from 'child_process';
import { statSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { getYouTubeCookiesPath } from './youtube-cookies.js';

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

console.log(`[YouTube] Initializing YouTube Data API v3`);
console.log(`[YouTube] API Key configured: ${!!process.env.YOUTUBE_API_KEY}`);

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

export interface YouTubeAudioFile {
  filePath: string;
  mimeType: string;
  fileSize: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse ISO 8601 duration (e.g., "PT4M13S") to seconds
 */
function parseDuration(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Clean up any temp files matching a base path prefix
 */
function cleanupTempFiles(tempBase: string): void {
  try {
    const dir = tmpdir();
    const prefix = basename(tempBase);
    const files = readdirSync(dir).filter(f => f.startsWith(prefix));
    for (const f of files) {
      try { unlinkSync(join(dir, f)); } catch {}
    }
  } catch {}
}

// ============================================================================
// Search using YouTube Data API v3
// ============================================================================

/**
 * Search YouTube using YouTube Data API v3 (official API, reliable)
 */
export async function searchYouTube(
  query: string,
  limit: number = 15
): Promise<YouTubeSearchResult[]> {
  console.log(`[YouTube] searchYouTube called with query="${query}", limit=${limit}`);

  if (!process.env.YOUTUBE_API_KEY) {
    throw new Error('YOUTUBE_API_KEY environment variable not set');
  }

  try {
    // Search for videos
    const searchResponse = await youtube.search.list({
      part: ['snippet'],
      q: query,
      type: ['video'],
      maxResults: limit + 10, // Request extra to allow filtering
      videoCategoryId: '10', // Music category
      videoEmbeddable: 'true', // Must be embeddable for iframe playback
    });

    if (!searchResponse.data.items) {
      return [];
    }

    // Get video IDs for duration lookup
    const videoIds = searchResponse.data.items
      .map(item => item.id?.videoId)
      .filter((id): id is string => !!id);

    if (videoIds.length === 0) {
      return [];
    }

    // Fetch video details (including duration)
    const videosResponse = await youtube.videos.list({
      part: ['contentDetails', 'snippet'],
      id: videoIds,
    });

    if (!videosResponse.data.items) {
      return [];
    }

    const results: YouTubeSearchResult[] = [];

    for (const video of videosResponse.data.items) {
      try {
        const videoId = video.id;
        const snippet = video.snippet;
        const contentDetails = video.contentDetails;

        if (!videoId || !snippet || !contentDetails) continue;

        const durationSec = parseDuration(contentDetails.duration || 'PT0S');

        // Skip very long videos (> 20 minutes)
        if (durationSec > 1200) {
          console.log(`[YouTube] Skipping long video (${durationSec}s): ${snippet.title}`);
          continue;
        }

        // Skip very short videos (< 30 seconds)
        if (durationSec < 30) {
          console.log(`[YouTube] Skipping short video (${durationSec}s): ${snippet.title}`);
          continue;
        }

        // Get best quality thumbnail
        const thumbnail = snippet.thumbnails?.high?.url
          || snippet.thumbnails?.medium?.url
          || snippet.thumbnails?.default?.url
          || '';

        results.push({
          videoId,
          title: snippet.title || 'Unknown Title',
          thumbnailUrl: thumbnail,
          durationSec,
          durationFormatted: formatDuration(durationSec),
          channelName: snippet.channelTitle || 'Unknown',
        });

        if (results.length >= limit) break;
      } catch (parseError) {
        console.error(`[YouTube] Error parsing result:`, parseError);
        continue;
      }
    }

    console.log(`[YouTube] Returning ${results.length} results`);
    return results;
  } catch (error) {
    console.error('[YouTube] Search error:', error);
    throw new Error(`YouTube search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================================================
// Audio Extraction via yt-dlp + ffmpeg
// ============================================================================

/**
 * Download and extract audio from a YouTube video using yt-dlp + ffmpeg.
 *
 * Instead of parsing format JSON and proxying URLs (which breaks when YouTube
 * changes what formats they serve from datacenter IPs), this lets yt-dlp handle
 * everything: format selection, anti-bot measures, HLS assembly, and audio
 * extraction via ffmpeg. The result is always a clean audio file.
 *
 * @param videoId YouTube video ID
 * @param signal Optional AbortSignal to cancel the download
 * @returns Path to extracted audio file, mime type, and file size
 */
export async function downloadYouTubeAudio(
  videoId: string,
  signal?: AbortSignal
): Promise<YouTubeAudioFile> {
  console.log(`[YouTube] downloadAudio videoId=${videoId}`);

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const tempBase = join(tmpdir(), `yt-audio-${videoId}-${Date.now()}`);
  const expectedOutput = `${tempBase}.m4a`;

  // Get cookies path
  let cookiesPath: string | null = null;
  try {
    cookiesPath = await getYouTubeCookiesPath();
  } catch {
    // Proceed without cookies
  }

  const args: string[] = [
    '--format', 'bestaudio/worst[height>=360]/best',   // Best audio-only; fall back to smallest muxed with AAC-LC audio (360p+); last resort: best overall
    '-x',                            // Extract audio
    '--audio-format', 'm4a',        // Convert to m4a (AAC) — universal browser support
    '--audio-quality', '0',          // Best quality
    '-o', `${tempBase}.%(ext)s`,     // Output template
    '--no-check-certificates',
    '--no-warnings',
    '--add-header', 'referer:youtube.com',
    '--add-header', 'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  ];

  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  args.push(videoUrl);

  return new Promise<YouTubeAudioFile>((resolve, reject) => {
    const spawnOpts: any = {};
    if (signal) {
      spawnOpts.signal = signal;
    }

    console.log(`[YouTube] Spawning yt-dlp for ${videoId}`);
    const proc = spawn('yt-dlp', args, spawnOpts);
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.log(`[YouTube] yt-dlp: ${line}`);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      stderr += line + '\n';
      if (line) console.log(`[YouTube] yt-dlp: ${line}`);
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      cleanupTempFiles(tempBase);
      if (err.code === 'ABORT_ERR') {
        reject(new Error('Download cancelled'));
      } else {
        reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
      }
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        console.warn(`[YouTube] yt-dlp exited with code ${code} for ${videoId} — checking for output file anyway`);
      }

      // Check for output file FIRST — yt-dlp can exit non-zero (e.g. one HLS
      // fragment out of 55 fails) but still produce a perfectly valid audio file.
      if (existsSync(expectedOutput)) {
        const stat = statSync(expectedOutput);
        if (stat.size > 0) {
          console.log(`[YouTube] Extracted ${videoId}: m4a ${(stat.size / 1024 / 1024).toFixed(1)}MB (exit code ${code})`);
          resolve({ filePath: expectedOutput, mimeType: 'audio/mp4', fileSize: stat.size });
          return;
        }
      }

      // yt-dlp may output with a different extension if ffmpeg conversion was skipped
      const dir = tmpdir();
      const prefix = basename(tempBase);
      const files = readdirSync(dir).filter(f => f.startsWith(prefix));

      if (files.length > 0) {
        const matchedFile = files[0]!;
        const filePath = join(dir, matchedFile);
        const stat = statSync(filePath);
        if (stat.size > 0) {
          const ext = matchedFile.split('.').pop() || '';
          const mimeType = ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' :
                          ext === 'webm' || ext === 'opus' ? 'audio/webm' :
                          'audio/mpeg';
          console.log(`[YouTube] Extracted ${videoId}: ${ext} ${(stat.size / 1024 / 1024).toFixed(1)}MB (exit code ${code})`);
          resolve({ filePath, mimeType, fileSize: stat.size });
          return;
        }
      }

      // No valid output file — now it's a real failure
      cleanupTempFiles(tempBase);
      console.error(`[YouTube] yt-dlp failed for ${videoId}: no output file produced (exit code ${code})`);
      reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(-500)}`));
    });
  });
}
