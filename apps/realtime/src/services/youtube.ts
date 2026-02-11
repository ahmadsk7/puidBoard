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

/**
 * Get audio download URL for a YouTube video using yt-dlp
 *
 * @param videoId YouTube video ID (e.g., "dQw4w9WgXcQ")
 * @returns Audio URL, mime type, and expiration timestamp
 */
export async function getYouTubeAudioUrl(
  videoId: string
): Promise<YouTubeAudioResult> {
  console.log(`[YouTube] getYouTubeAudioUrl called for videoId: ${videoId}`);

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`[YouTube] Extracting audio URL using yt-dlp for: ${videoId}`);

    // Use yt-dlp to get the best audio format
    const info = await youtubedl(videoUrl, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      ]
    }) as any;

    if (!info || !info.formats) {
      console.error(`[YouTube] No formats found for video: ${videoId}`);
      throw new Error('No audio formats available for this video');
    }

    // Find the best audio-only format (usually 140 = m4a audio)
    const audioFormats = info.formats.filter((f: any) =>
      f.acodec && f.acodec !== 'none' && f.vcodec === 'none'
    );

    if (audioFormats.length === 0) {
      console.error(`[YouTube] No audio-only formats found for video: ${videoId}`);
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

    console.log(`[YouTube] Found audio format: ${bestAudio.ext} (${bestAudio.abr || 'unknown'}kbps)`);
    console.log(`[YouTube] Audio URL: ${audioUrl.substring(0, 100)}...`);

    // Check for errors in response
    if (!audioUrl) {
      console.error(`[YouTube] No audio URL found:`, bestAudio);
      throw new Error('No audio URL extracted from video');
    }

    // YouTube URLs typically expire after a few hours
    const expiresAt = Date.now() + (6 * 60 * 60 * 1000); // 6 hours from now

    const mimeType = bestAudio.ext === 'm4a' ? 'audio/mp4' :
                     bestAudio.ext === 'webm' ? 'audio/webm' :
                     'audio/mpeg';

    console.log(`[YouTube] Successfully extracted audio URL: ${info.title} (${info.duration}s)`);

    return {
      url: audioUrl,
      mimeType,
      expiresAt
    };
  } catch (error) {
    console.error('[YouTube] Audio extraction error:', error);
    throw new Error(`YouTube audio extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
