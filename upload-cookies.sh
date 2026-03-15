#!/bin/bash
# Upload cookies to both Fly machines

for machine_id in 185e297c344318 7815674fe5d0e8; do
  echo "Uploading cookies to machine $machine_id..."
  fly ssh sftp shell --app puidboard-realtime --select "$machine_id" << 'SFTP'
put youtube-cookies.txt /app/.storage/youtube-cookies.txt
bye
SFTP
done
echo "Done!"
