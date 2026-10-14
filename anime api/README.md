# Chanime Scraper API Tester

Local interactive API tester and scraper API for anime metadata, episodes, server lists, and stream resolution.

## Run locally

Requirements: Node.js 18 or later and npm.

```bash
cd "anime api"
npm install
PORT=3001 npm run dev
```

Open the tester at <http://localhost:3001/>. The default port is `3000`; use `PORT=3001` when another app already uses it. `npm run lint` runs the TypeScript check.

Gemini-backed features are optional for the API examples below. Configure `GEMINI_API_KEY` in the environment if you use those features. Other optional settings are documented in [.env.example](.env.example).

## API basics

The API base URL is `http://localhost:3001/api`. The examples use One Piece (AniList ID `21`), episode `1`, and Japanese audio with subtitles (`type=sub`). Replace the ID, episode, or type as needed. Supported types are `sub`, `dub`, and `raw`.

### 1. Search anime

```bash
curl -G 'http://localhost:3001/api/search' \
   --data-urlencode 'q=One Piece'
```

Search results include AniList IDs. Use the ID in the episode, server, and watch requests.

### 2. List episodes for a provider

```bash
curl -G 'http://localhost:3001/api/episodes' \
   --data-urlencode 'anilistId=21' \
   --data-urlencode 'source=animegg'
```

The response includes the episode list and provider-specific `siteId` values.

### 3. List available servers

```bash
curl -G 'http://localhost:3001/api/servers' \
   --data-urlencode 'anilistId=21' \
   --data-urlencode 'ep=1' \
   --data-urlencode 'source=animegg' \
   --data-urlencode 'type=sub'
```

Use `type=all` to list all server types. `/api/servers` returns `sourceId` values and server names; `/api/watch` resolves those servers automatically and can fall back to another available server.

### 4. Resolve a playable stream

```bash
curl -G 'http://localhost:3001/api/watch' \
   --data-urlencode 'anilistId=21' \
   --data-urlencode 'ep=1' \
   --data-urlencode 'type=sub' \
   --data-urlencode 'source=animegg'
```

Path form is also available:

```text
GET /api/watch/{source}/{anilistId}/{episode}/{type}
```

For example: `/api/watch/animegg/21/1/sub`.

## Provider calls

Each command below resolves One Piece episode 1 with subtitles. Run any one after starting the app:

```bash
BASE='http://localhost:3001/api/watch'
watch_provider() {
   curl -G "$BASE" \
      --data-urlencode "source=$1" \
      --data-urlencode 'anilistId=21' \
      --data-urlencode 'ep=1' \
      --data-urlencode 'type=sub'
}

watch_provider senshi
watch_provider animeheaven
watch_provider miruro
watch_provider anikoto
watch_provider otakuvid
watch_provider lunarx
watch_provider animepahe
watch_provider animepaheNg
watch_provider anidbapp
watch_provider anidb
watch_provider animesalt
watch_provider 1embed
watch_provider animegg
watch_provider anineko
watch_provider animenosub
watch_provider aniwaves
```

The supported `source` values are:

| Provider | `source` value | Example watch URL |
|---|---|---|
| Senshi | `senshi` | `/api/watch?source=senshi&anilistId=21&ep=1&type=sub` |
| AnimeHeaven | `animeheaven` | `/api/watch?source=animeheaven&anilistId=21&ep=1&type=sub` |
| Miruro | `miruro` | `/api/watch?source=miruro&anilistId=21&ep=1&type=sub` |
| Anikoto | `anikoto` | `/api/watch?source=anikoto&anilistId=21&ep=1&type=sub` |
| Otakuvid | `otakuvid` | `/api/watch?source=otakuvid&anilistId=21&ep=1&type=sub` |
| LunarX | `lunarx` | `/api/watch?source=lunarx&anilistId=21&ep=1&type=sub` |
| AnimePahe | `animepahe` | `/api/watch?source=animepahe&anilistId=21&ep=1&type=sub` |
| AnimePahe NG | `animepaheNg` | `/api/watch?source=animepaheNg&anilistId=21&ep=1&type=sub` |
| AniDB.app | `anidbapp` | `/api/watch?source=anidbapp&anilistId=21&ep=1&type=sub` |
| AniDB | `anidb` | `/api/watch?source=anidb&anilistId=21&ep=1&type=sub` |
| AnimeSalt | `animesalt` | `/api/watch?source=animesalt&anilistId=21&ep=1&type=sub` |
| 1Embed | `1embed` | `/api/watch?source=1embed&anilistId=21&ep=1&type=sub` |
| AnimeGG | `animegg` | `/api/watch?source=animegg&anilistId=21&ep=1&type=sub` |
| AniNeko | `anineko` | `/api/watch?source=anineko&anilistId=21&ep=1&type=sub` |
| Animenosub | `animenosub` | `/api/watch?source=animenosub&anilistId=21&ep=1&type=sub` |
| AniWaves | `aniwaves` | `/api/watch?source=aniwaves&anilistId=21&ep=1&type=sub` |

For a copy-ready full URL, prepend `http://localhost:3001` to a table path. The shell examples use `curl -G` to encode query values safely.

## Direct provider slugs

For sources with a provider-specific slug, use `/api/episodes?source=...&slug=...` and `/api/watch?source=...&slug=...&ep=...&type=...`. Direct-slug lookup is supported for `animeheaven`, `animepahe`, `animepaheNg`, `anidbapp`, `anidb`, `animesalt`, `animegg`, `anineko`, `animenosub`, and `aniwaves`.

Example:

```bash
curl -G 'http://localhost:3001/api/episodes' \
   --data-urlencode 'source=animeheaven' \
   --data-urlencode 'slug=your-provider-slug'

curl -G 'http://localhost:3001/api/watch' \
   --data-urlencode 'source=animeheaven' \
   --data-urlencode 'slug=your-provider-slug' \
   --data-urlencode 'ep=1' \
   --data-urlencode 'type=sub'
```

## Reading watch responses

Common response fields:

| Field | Meaning |
|---|---|
| `playbackMode` | `hls`, `mp4`, or `iframe` |
| `hlsProxyUrl` | Same-origin HLS playlist proxy when available |
| `proxyStreamUrl` | Same-origin media URL for HLS or MP4 when available |
| `embedUrl` | Provider player URL; use it in an iframe when `iframeOnly` is true |
| `iframeOnly` | No direct HLS/MP4 URL was resolved; playback requires the provider embed |
| `availableServers` | Provider servers the API found for this episode |
| `subtitles` | Subtitle tracks returned by the provider, if any |

The API does not guarantee that every provider has every title or episode. A `404` usually means the provider has no matching episode/server; `502` means stream resolution or an upstream request failed. Some providers return only an iframe, not a direct media URL. Provider sites can block requests or change their player APIs at any time.

## Useful endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/search?q=One%20Piece` | Search anime metadata |
| `GET /api/episodes?anilistId=21&source=animegg` | List episodes |
| `GET /api/servers?anilistId=21&ep=1&source=animegg&type=sub` | List servers |
| `GET /api/watch?anilistId=21&ep=1&source=animegg&type=sub` | Resolve a stream |
| `GET /api/genres` | List genres |
| `GET /api/chanime/status` | Check the optional Chanime child-service status |

This archive does not include the optional `chanimee2.1-main` child service; routes served by that separate service may return `503`.
