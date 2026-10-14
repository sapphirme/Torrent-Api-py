# Setup: run it in GitHub Codespaces

Everything below happens in the browser. About 10 minutes the first time.

## 1. Create a Codespace
1. On GitHub, create an **empty private repo** (for example `web-torrent-player`).
2. Open it, then **Code -> Codespaces -> Create codespace on main**.

## 2. Add the project
1. Drag `web-torrent-player.zip` into the Explorer sidebar of the Codespace.
2. In the terminal:
   ```bash
   sudo apt-get install -y unzip      # only if "unzip: command not found"
   unzip web-torrent-player.zip && rm web-torrent-player.zip
   ```
   The zip has no top-level folder, so run this in the repo root.
3. Optional: commit it (`git add . && git commit -m "player" && git push`) so a rebuilt Codespace keeps it.

## 3. Install (once)
```bash
bash setup.sh
```
Installs ffmpeg, Redis and the npm packages. A Codespace created *after* the files are committed does this automatically (`.devcontainer`).

## 4. Run
```bash
npm start
```
You should see `Web torrent player on http://localhost:3000`. Redis is started for you (data in `./data/redis`).

## 5. Open it
Open the **Ports** tab, find port **3000** and click the globe icon. Codespaces serves it over HTTPS, which the service worker and home-screen install need.

## 6. First test (open-licensed film)
1. Click **Try Sintel**, then click the `.mp4` file.
2. Status goes: reading file info -> remuxing -> ready. Playback starts after a few seconds.
3. Magnets with a 40-char hex hash or a 32-char base32 hash (Nyaa style) are both accepted.
Only use media you have the right to stream.

## 6b. Using .torrent files
A .torrent file is the same thing as a magnet link (same info hash) plus the file list and trackers, saved as a small file.
1. Click **Load .torrent** next to the magnet box and pick the file from your computer or phone. You don't need to copy it into the Codespace; the browser uploads it to the app.
2. The file list appears straight away, because it comes from the file itself (no peers needed to list it). Pick a file to play.
3. The app keeps the torrent info for 14 days, so you can reopen it from the recent chips without the file.
Limits: files up to 5 MB; a torrent with no seeders still stalls at the 60 s metadata step; video that isn't H.264 (older XviD/AVI, HEVC) is transcoded on the server, which is slow on a small CPU.
For a safe first try, download the Sintel .torrent from webtorrent.io (`https://webtorrent.io/torrents/sintel.torrent`) and load it.

## 7. Test checklist
| What | How | Expected |
|---|---|---|
| Server cache (Redis) | `redis-cli keys 'tp:*'` | `tp:meta:...`, `tp:done:...`, `tp:lru`, `tp:sizes` |
| Instant replay | refresh, play the same file again | starts in about 2 seconds, "cached" tag on the file |
| Server disk | `du -sh data/*` while playing, again after about 5 min | `data/downloads` drops to empty, `data/hls` stays |
| Device cache | footer "Device cache" line | megabytes grow as you watch |
| Save while watching | tick **Save to device while watching**, play a file | "Saving to device 12/240" counts up to "Saved to device" |
| Service worker | DevTools -> Application -> Service Workers / Cache Storage | `kv-hls-v1` holds `.ts` segments |
| Home screen | Chrome install icon (or **Add to Home Screen** button), open the installed app | footer says "installed, protected from eviction" |
| Offline replay | after a full watch, DevTools -> Network -> Offline, reload, play | plays from the device |

## 8. Test on a phone
1. In the **Ports** tab, right-click port 3000 -> **Port Visibility -> Public**.
   A public port is reachable by anyone with the URL and this app has no login. Use it briefly, then set it back to Private.
2. Open the forwarded URL on the phone.
   - **Android (Chrome):** menu -> Install app, or use the in-page button.
   - **iPhone (Safari):** Share -> **Add to Home Screen**. Safari has no install prompt.

## 9. Optional: rebuild the Kotlin part
`public/kv-cache-kt.js` is prebuilt from `kotlin-js/src/jsMain/kotlin/KvCache.kt`. To rebuild, see `kotlin-js/README.md`.
To go back to plain JavaScript, change the script tag in `public/index.html` to `/kv-cache.js`.

## 10. Troubleshooting
| Problem | Fix |
|---|---|
| "Cannot reach Redis" | `redis-server --daemonize yes`, then `npm start` again |
| "Timed out waiting for torrent metadata" | no peers answered in 60 s; retry, or try a better-seeded torrent |
| "Paste a magnet link ... btih hash" | the old `server.js` is running; stop (Ctrl+C) and `npm start` again |
| Footer says "not supported" or no service worker | use the HTTPS Ports URL, not plain HTTP |
| "Stopped: device cache full" | the browser budget is 150 MiB; install to the home screen for 2 GiB |
| `ffmpeg not found` | `bash setup.sh` again |
| Port 3000 not listed | `npm start` must be running; check the terminal |

## 11. Settings (environment variables)
`QUALITY` (original | balanced | small) · `MAX_FILE_GB` (3, refuse bigger files; 0 = no limit) · `RELEASE_ON_DONE` (1, delete the raw download as soon as an episode is processed) · `PORT` (3000) · `REDIS_URL` · `MAX_CACHE_GB` (8, server cache cap) · `TORRENT_IDLE_MIN` (5, minutes before raw downloads are deleted) · `UPLOAD_KBPS` (256, seeding cap) · `DATA_DIR` (./data)

Example: `QUALITY=small MAX_CACHE_GB=5 npm start`

`QUALITY=balanced` re-encodes to at most 720p (about 2.5 Mbps); `small` to at most 480p (about 1.2 Mbps). Files already under the target are left as they are. Re-encoding uses CPU, so on a small server it may not keep up with playback while an episode is still processing; test with one of your own files.

## 12. Later: moving to a VPS
Install Node 20, ffmpeg and Redis, run `npm install` and `npm start` (or use pm2), and put Caddy or nginx in front for HTTPS. Set `MAX_CACHE_GB` below your free disk. Bandwidth, not CPU, is the limit with many viewers.

Stop the server with Ctrl+C. A Codespace stops itself after about 30 minutes idle; delete it at github.com/codespaces when finished.
