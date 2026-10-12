# Torrent-Api-py

FastAPI service for torrent and anime subtitle discovery.

This build currently supports:

- TorrentFunk public JSON API
- SubsPlease RSS + AniList-powered show resolution
- Health checks and FastAPI docs
- Optional API-key auth via the `X-API-Key` header

## Features

- `GET /api/v1/torrentfunk/search` for TorrentFunk search queries
- `GET /api/v1/torrentfunk/latest` for newest TorrentFunk results
- `GET /api/v1/subplease/search` for anime search by title, slug, or AniList ID
- `GET /api/v1/subplease/shows/{slug}` to fetch releases for a SubsPlease show slug
- `GET /api/v1/subplease/anilist/{anilist_id}` to resolve AniList IDs to releases
- `GET /api/v1/subplease/latest` for recent SubsPlease uploads
- `GET /api/v1/sites` and `GET /api/v1/sites/config` for supported-site metadata

## Installation

```bash
# clone
git clone https://github.com/Ryuk-me/Torrent-Api-py
cd Torrent-Api-py

# create venv
python3 -m venv api-py
source api-py/bin/activate

# install dependencies
pip install -r requirements.txt
```

## Run the API

```bash
# optional auth
export PYTORRENT_API_KEY="your-secret-key"

# TMDB v3 API key for searching TorrentFunk by movie ID
export TMDB_API_KEY="your-tmdb-api-key"

# start server
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 8009
```

Then open:

- http://localhost:8009/docs
- http://localhost:8009/health

## Authentication

If `PYTORRENT_API_KEY` is set, every protected route requires the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/torrentfunk/search?q=ubuntu&limit=2"
```

If no key is configured, requests can run without authentication.

## Endpoint Reference

### Health

```bash
curl http://localhost:8009/health
```

### Supported sites

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/sites"

curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/sites/config"
```

### TorrentFunk

#### Search

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/torrentfunk/search?q=ubuntu&limit=5&page=1"
```

Search TorrentFunk using a TMDB movie ID. The API looks up the movie title and release year on TMDB, then searches TorrentFunk with both:

```bash
curl -H "X-API-Key: your-secret-key" \\
  "http://localhost:8009/api/v1/torrentfunk/search?tmdb_id=550&limit=5"
```

Provide exactly one of `q` or `tmdb_id`. Set `TMDB_API_KEY` to the TMDB key provided for this integration; it is read from the environment rather than embedded in source code.

TorrentFunk search and latest results are filtered to releases strictly below 2 GB whose names explicitly contain an English-subtitle marker, such as `Eng Sub` or `English Subtitles`. Results without a detectable marker are excluded because TorrentFunk does not expose structured subtitle-language metadata.

#### Latest

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/torrentfunk/latest?limit=5"
```

### SubsPlease

#### Search by title

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/subplease/search?q=Dark%20Summoner&limit=2"
```

#### Search by slug

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/subplease/shows/kimetsu-no-yaiba-movie-1-mugenjou-hen-akaza-sairai?limit=2"
```

#### Search by AniList ID

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/subplease/anilist/178788?limit=2"
```

#### Recent uploads

```bash
curl -H "X-API-Key: your-secret-key" \
  "http://localhost:8009/api/v1/subplease/latest?limit=5"
```

You can also use the `.json` variants, for example:

- `/api/v1/torrentfunk/search.json`
- `/api/v1/torrentfunk/latest.json`
- `/api/v1/subplease/search.json`
- `/api/v1/subplease/latest.json`

## Example code

### Python with requests

```python
import requests

base_url = "http://localhost:8009"
headers = {"X-API-Key": "your-secret-key"}

# TorrentFunk search
resp = requests.get(
    f"{base_url}/api/v1/torrentfunk/search",
    params={"q": "ubuntu", "limit": 3},
    headers=headers,
    timeout=30,
)
print(resp.status_code)
print(resp.json())

# SubsPlease search by AniList ID
resp = requests.get(
    f"{base_url}/api/v1/subplease/anilist/178788",
    params={"limit": 2},
    headers=headers,
    timeout=30,
)
print(resp.json())
```

### JavaScript / fetch

```js
const baseUrl = "http://localhost:8009";
const headers = { "X-API-Key": "your-secret-key" };

const torrentfunk = await fetch(
  `${baseUrl}/api/v1/torrentfunk/search?q=ubuntu&limit=2`,
  { headers }
).then((r) => r.json());

const subplease = await fetch(
  `${baseUrl}/api/v1/subplease/search?q=Dark%20Summoner&limit=2`,
  { headers }
).then((r) => r.json());

console.log(torrentfunk);
console.log(subplease);
```

## Example response shape

```json
{
  "status": "ok",
  "endpoint": "search",
  "page": 1,
  "limit": 2,
  "count": 2,
  "total_found": 42,
  "results": [
    {
      "name": "example.torrent",
      "size": "1.2 GB",
      "seeders": 250,
      "leechers": 28,
      "url": "https://example.com/torrent",
      "magnet": "magnet:?xt=urn:btih:...",
      "category": "movies"
    }
  ]
}
```

For SubsPlease responses, the payload may also include a `show` object when resolving a slug or AniList ID.

## Notes

- TorrentFunk calls use the official public JSON API with browser impersonation, which avoids the Cloudflare challenge page.
- SubsPlease searches rely on its RSS feed plus its public show data and AniList lookups.
- SubsPlease results are filtered to 480p-quality releases in the current implementation.
- Use `slug` or `anilist_id` when you want a deterministic match for a show.

## License

This project is distributed under the MIT license as defined in the repository.
