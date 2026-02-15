/**
 * YouTube service for searching and extracting audio.
 *
 * APPROACH (BACKEND AUDIO EXTRACTION):
 * - Server: YouTube Data API v3 for search
 * - Server: RapidAPI youtube-mp36 for audio extraction (GET /dl?id={videoId})
 * - Client: Receives direct audio URLs, uses Web Audio API for full DJ controls
 *
 * WHY THIS APPROACH:
 * All self-hosted server-side approaches failed:
 * 1. ytdl-core: Bot detection, datacenter IP blocked
 * 2. yt-dlp with cookies: Cookies expire/rotate frequently, unreliable
 * 3. play-dl + youtube-dl-exec: Works locally (residential IP) but blocked on servers
 * 4. Invidious API: All public instances down/blocked
 * 5. Piped API: Same issues as Invidious
 * 6. YouTube IFrame Player: Cross-origin restrictions prevent Web Audio API access
 *
 * RapidAPI youtube-mp36 solves these issues:
 * - They handle datacenter IP blocking with residential proxies
 * - Reliable uptime and maintenance
 * - Simple API integration
 * - Client gets direct audio URL for Web Audio API
 * - Predictable costs: ~$10-200/mo depending on volume
 *
 * Alternative: Self-hosted MichaelBelgium/Youtube-API (migrate at scale if needed)
 */

import { google } from 'googleapis';

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

export interface YouTubeAudioResult {
  url: string;
  mimeType: string;
  expiresAt: number;
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
// Audio Extraction via yt-dlp (Self-hosted)
// ============================================================================

import youtubedl from 'youtube-dl-exec';
import { getYouTubeCookiesPath } from './youtube-cookies.js';

/**
 * Get audio download URL for a YouTube video using yt-dlp
 *
 * @param videoId YouTube video ID (e.g., "dQw4w9WgXcQ")
 * @returns Audio URL, mime type, and expiration timestamp
 */
export async function getYouTubeAudioUrl(
  videoId: string
): Promise<YouTubeAudioResult> {
  console.log(`[YouTube] ========== getYouTubeAudioUrl START ==========`);
  console.log(`[YouTube] videoId: ${videoId}`);

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[YouTube] Full URL: ${videoUrl}`);

    console.log(`[YouTube] Extracting audio URL using yt-dlp...`);

    // Build yt-dlp options with cookie support
    const options: any = {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      ]
    };

    // Try to fetch fresh cookies from API (helps bypass YouTube bot detection on datacenter IPs)
    console.log(`[YouTube] Attempting to fetch cookies...`);
    try {
      const cookiesPath = await getYouTubeCookiesPath();
      if (cookiesPath) {
        options.cookies = cookiesPath;
        console.log(`[YouTube] ✓ Using cookies from: ${cookiesPath}`);
      } else {
        console.warn(`[YouTube] ⚠ No cookies available. Proceeding without cookies.`);
      }
    } catch (cookieError) {
      console.warn(`[YouTube] ⚠ Failed to fetch cookies, proceeding without them:`);
      console.warn(`[YouTube] Cookie error:`, cookieError instanceof Error ? cookieError.message : cookieError);
    }

    // Use yt-dlp to get the best audio format
    console.log(`[YouTube] Calling yt-dlp with options:`, JSON.stringify(options, null, 2));
    const info = await youtubedl(videoUrl, options) as any;
    console.log(`[YouTube] yt-dlp returned successfully`);
    console.log(`[YouTube] Video title: ${info?.title || 'unknown'}`);
    console.log(`[YouTube] Video duration: ${info?.duration || 'unknown'}s`);

    // DIAGNOSTIC: Check what YouTube actually returned
    console.log(`[YouTube DIAGNOSTIC] ========== VERBOSE RESPONSE ANALYSIS ==========`);
    console.log(`[YouTube DIAGNOSTIC] playabilityStatus:`, JSON.stringify(info?.playabilityStatus, null, 2));
    console.log(`[YouTube DIAGNOSTIC] Has streamingData:`, !!info?.streamingData);
    if (info?.streamingData) {
      console.log(`[YouTube DIAGNOSTIC] streamingData.formats count:`, info.streamingData.formats?.length || 0);
      console.log(`[YouTube DIAGNOSTIC] streamingData.adaptiveFormats count:`, info.streamingData.adaptiveFormats?.length || 0);
      console.log(`[YouTube DIAGNOSTIC] Sample formats:`, JSON.stringify(info.streamingData.formats?.slice(0, 2) || [], null, 2));
      console.log(`[YouTube DIAGNOSTIC] Sample adaptiveFormats:`, JSON.stringify(info.streamingData.adaptiveFormats?.slice(0, 2) || [], null, 2));
    } else {
      console.error(`[YouTube DIAGNOSTIC] ✗ NO streamingData in response!`);
    }
    console.log(`[YouTube DIAGNOSTIC] Top-level formats array count:`, info?.formats?.length || 0);
    console.log(`[YouTube DIAGNOSTIC] ========================================`);

    if (!info || !info.formats) {
      console.error(`[YouTube] ✗ No formats found for video: ${videoId}`);
      console.error(`[YouTube] Info object keys:`, Object.keys(info || {}));
      console.error(`[YouTube] Full info object:`, JSON.stringify(info, null, 2));
      throw new Error('No audio formats available for this video');
    }

    console.log(`[YouTube] Total formats found: ${info.formats.length}`);

    // Find the best audio-only format (usually 140 = m4a audio)
    const audioFormats = info.formats.filter((f: any) =>
      f.acodec && f.acodec !== 'none' && f.vcodec === 'none'
    );

    console.log(`[YouTube] Audio-only formats found: ${audioFormats.length}`);

    if (audioFormats.length === 0) {
      console.error(`[YouTube] ✗ No audio-only formats found for video: ${videoId}`);
      console.error(`[YouTube] Available formats:`, info.formats.map((f: any) => ({
        format_id: f.format_id,
        ext: f.ext,
        acodec: f.acodec,
        vcodec: f.vcodec
      })));
      throw new Error('No audio-only formats available');
    }

    // Sort by quality and prefer m4a/webm
    audioFormats.sort((a: any, b: any) => {
      const aScore = (a.abr || 0) + (a.ext === 'm4a' ? 10 : 0);
      const bScore = (b.abr || 0) + (b.ext === 'm4a' ? 10 : 0);
      return bScore - aScore;
    });

    const bestAudio = audioFormats[0];
    const audioUrl = bestAudio.url;

    console.log(`[YouTube] ✓ Selected format: ${bestAudio.format_id} (${bestAudio.ext})`);
    console.log(`[YouTube] Bitrate: ${bestAudio.abr || 'unknown'}kbps`);
    console.log(`[YouTube] Audio URL (first 150 chars): ${audioUrl.substring(0, 150)}...`);

    // Check for errors in response
    if (!audioUrl) {
      console.error(`[YouTube] ✗ No audio URL found in selected format:`, bestAudio);
      throw new Error('No audio URL extracted from video');
    }

    // YouTube URLs typically expire after a few hours
    const expiresAt = Date.now() + (6 * 60 * 60 * 1000); // 6 hours from now

    const mimeType = bestAudio.ext === 'm4a' ? 'audio/mp4' :
                     bestAudio.ext === 'webm' ? 'audio/webm' :
                     'audio/mpeg';

    console.log(`[YouTube] ========== SUCCESS ==========`);
    console.log(`[YouTube] Title: ${info.title}`);
    console.log(`[YouTube] Duration: ${info.duration}s`);
    console.log(`[YouTube] Format: ${bestAudio.ext}`);
    console.log(`[YouTube] MIME: ${mimeType}`);
    console.log(`[YouTube] ========== getYouTubeAudioUrl END ==========`);

    return {
      url: audioUrl,
      mimeType,
      expiresAt
    };
  } catch (error) {
    console.error('[YouTube] ========== EXTRACTION FAILED ==========');
    console.error('[YouTube] Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[YouTube] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[YouTube] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('[YouTube] Full error object:', error);
    console.error('[YouTube] ========================================');
    throw new Error(`YouTube audio extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
