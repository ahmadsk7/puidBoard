/**
 * Test yt-dlp locally to see what YouTube returns on residential IP
 */
import youtubedl from 'youtube-dl-exec';

async function testLocal() {
  const videoId = 'Qxlnb1lEdEs'; // Same video from the error logs
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  console.log(`\n========== TESTING LOCALLY ==========`);
  console.log(`Video: ${videoUrl}\n`);

  const options = {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    addHeader: [
      'referer:youtube.com',
      'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    ]
  };

  try {
    console.log('Calling yt-dlp...\n');
    const info = await youtubedl(videoUrl, options);

    console.log('✓ SUCCESS\n');
    console.log('Title:', info.title);
    console.log('Duration:', info.duration, 'seconds\n');

    console.log('========== PLAYABILITY STATUS ==========');
    console.log(JSON.stringify(info.playabilityStatus, null, 2));
    console.log('\n========== STREAMING DATA ==========');
    console.log('Has streamingData:', !!info.streamingData);

    if (info.streamingData) {
      console.log('formats count:', info.streamingData.formats?.length || 0);
      console.log('adaptiveFormats count:', info.streamingData.adaptiveFormats?.length || 0);

      if (info.streamingData.formats?.length > 0) {
        console.log('\nSample format:');
        console.log(JSON.stringify(info.streamingData.formats[0], null, 2));
      }

      if (info.streamingData.adaptiveFormats?.length > 0) {
        console.log('\nSample adaptiveFormat:');
        console.log(JSON.stringify(info.streamingData.adaptiveFormats[0], null, 2));
      }
    }

    console.log('\n========== TOP-LEVEL FORMATS ==========');
    console.log('Total formats:', info.formats?.length || 0);

    if (info.formats?.length > 0) {
      const audioFormats = info.formats.filter(f =>
        f.acodec && f.acodec !== 'none' && f.vcodec === 'none'
      );
      console.log('Audio-only formats:', audioFormats.length);

      if (audioFormats.length > 0) {
        console.log('\nBest audio format:');
        audioFormats.sort((a, b) => {
          const aScore = (a.abr || 0) + (a.ext === 'm4a' ? 10 : 0);
          const bScore = (b.abr || 0) + (b.ext === 'm4a' ? 10 : 0);
          return bScore - aScore;
        });
        const best = audioFormats[0];
        console.log(`  format_id: ${best.format_id}`);
        console.log(`  ext: ${best.ext}`);
        console.log(`  abr: ${best.abr}kbps`);
        console.log(`  acodec: ${best.acodec}`);
        console.log(`  url: ${best.url.substring(0, 100)}...`);
      }
    }

    console.log('\n========== END ==========\n');
  } catch (error) {
    console.error('\n✗ FAILED');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testLocal();
