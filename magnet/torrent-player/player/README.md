> Step-by-step Codespaces guide: see **SETUP.md**.

# Web Torrent Player

Paste a magnet link, pick a file, watch it in the browser.

Torrent (TCP/UDP/DHT) -> ffmpeg (MKV -> HLS, H.264 is remuxed, anything else is transcoded) -> hls.js.
Redis is the smart cache layer.

## Run in GitHub Codespaces
1. Create a repo with these files (or upload the zip into a Codespace and `unzip` it).
2. If the Codespace already existed: `bash setup.sh` (installs ffmpeg, redis, npm deps).
   New Codespaces run it automatically via `.devcontainer`.
3. `npm start`, then open the forwarded port 3000.
4. Click **Try Sintel** to verify everything works with an open-licensed film.

## SubsPlease search and playback

Start the FastAPI service from the repository root (`python main.py`) so it listens on port 8009, then start this player with `npm start` from this directory. Search for an anime title or anime movie above the video; the results come from SubsPlease and are limited to 480p. Select **Play** to load the magnet and automatically play its first video file.

If FastAPI uses a different address or API key, configure these variables before starting the player:

```bash
SUBPLEASE_API_URL="http://127.0.0.1:8009/api/v1/subplease/search"
SUBPLEASE_API_KEY="your-api-key"
```

## What Redis caches
| Key | Purpose |
|---|---|
| `tp:meta:<hash>` | File list + the .torrent itself (14d). Re-opening a torrent is instant and skips the metadata lookup. |
| `tp:done:<hash>:<idx>` | Marks a fully transcoded HLS copy on disk. Cached files play with zero torrent activity. |
| `tp:lru` / `tp:sizes` | Last-access time and bytes per cached file. Oldest entries are evicted when over `MAX_CACHE_GB`. |
| `tp:pos:<hash>:<idx>` | Resume position (90d). |
| `tp:recent` | Recently opened torrents. |

Idle torrents are released after `TORRENT_IDLE_MIN` and their raw download is deleted (the HLS copy stays cached).

## Env vars
`PORT` (3000) · `REDIS_URL` · `MAX_CACHE_GB` (8) · `TORRENT_IDLE_MIN` (5) · `UPLOAD_KBPS` (256) · `DATA_DIR` (./data) · `SUBPLEASE_API_URL` · `SUBPLEASE_API_KEY` (or `PYTORRENT_API_KEY`)

## Device cache (PWA)
`public/sw.js` + `public/kv-cache.js` cache HLS segments in the browser (Cache API + IndexedDB bookkeeping).
Small budget in a tab, large + persistent once the site is added to the home screen. See `CHANIME.md` for the Flask drop-in.
Needs HTTPS (Codespaces forwarded ports are HTTPS; plain `localhost` also works).

## Loading torrents
Paste a magnet link / info hash, or use **Load .torrent** to upload a .torrent file (`POST /api/torrent-file`). Both end up in the same cache.
