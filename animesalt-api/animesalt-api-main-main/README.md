# AnimeSalt API - Best Anime Scraper API

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbeyondbday69%2Fanimesalt-api)

**AnimeSalt API** is the ultimate unofficial scraper for animesalt.ac. Features auto-next episode logic, direct m3u8 stream extraction, and full anime metadata.

## Base URL
Production: `https://animesalt-api-lovat.vercel.app`
Local: `http://localhost:500`

## Local Development

### 1. Using Python
```bash
pip install -r requirements.txt
python api/main.py
```

### 2. Using Docker
```bash
docker build -t animesalt-api .
docker run -p 500:500 animesalt-api
```

## Routes

### 1. Home
- **Endpoint:** `GET /api/home`
- **Description:** Scrape latest anime, trending, and featured sections.
- **Cache:** 1 hour

### 2. Search
- **Endpoint:** `GET /api/search?q={query}`
- **Description:** Scrape search results dynamically.
- **Parameters:** `q` (string) - Search term.
- **Cache:** 1 hour

### 3. Anime Details
- **Endpoint:** `GET /api/anime/{slug}`
- **Description:** Scrape Title, Description, Genres, Episodes list, Thumbnail, and Movie Players (if movie).
- **Parameters:** `slug` (string) - Anime slug (e.g., `naruto`).
- **Cache:** 12 hours

### 4. Episode Details
- **Endpoint:** `GET /api/episode/{episode_id}`
- **Description:** Extract video player (iframe) and direct m3u8 link (if available). Also returns `next_episode_id` and `prev_episode_id` for navigation.
- **Parameters:** `episode_id` (string) - Episode ID (e.g., `naruto-1x1`).
- **Cache:** 24 hours

## Auto-Next Logic (Frontend)

If using the iframe (`video_player`):
```javascript
window.addEventListener("message", (e) => {
    if (e.data === "video_playback_completed") {
        // Fetch next_episode_id from API response and load
    }
});
```

To auto-skip intro/outro in iframe:
```javascript
setInterval(() => {
    const iframe = document.querySelector("iframe");
    if (iframe) {
        iframe.contentWindow.postMessage({ autoSkip: { intro: true, outro: true } }, '*');
    }
}, 1000);
```