# Frontend Developer AI Prompt

Hello AI! Your goal is to build a beautiful, modern, and responsive frontend application using the **AnimeSalt API**. 
The API is already fully functional, deployed, and cached.

## API Base URL
`https://animesalt-api-lovat.vercel.app`

*(Note: If you are running it locally, use `http://127.0.0.1:5000`)*

## Endpoints Overview

### 1. Home Page
- **URL**: `GET /api/home`
- **Description**: Returns categorised anime lists (e.g. `fresh_drops`, `on-air_series_view_more`, `latest_anime_movies_view_more`).
- **Response Shape**:
```json
{
  "success": true,
  "data": {
    "fresh_drops": [
      {
        "title": "Naruto",
        "url": "...",
        "slug": "naruto",
        "image": "https://..."
      }
    ],
    "latest_anime_movies_view_more": [ ... ]
  }
}
```

### 2. Search
- **URL**: `GET /api/search?q={query}`
- **Description**: Returns a list of anime/movies matching the search query.
- **Response Shape**:
```json
{
  "success": true,
  "query": "naruto",
  "results": [
    {
      "title": "Naruto Shippuden",
      "url": "...",
      "slug": "naruto-shippuden",
      "image": "https://..."
    }
  ]
}
```

### 3. Anime Details (Series & Movies)
- **URL**: `GET /api/anime/{slug}`
- **Description**: Returns all details for a series (with seasons and episodes) or a movie.
- **Response Shape**:
```json
{
  "success": true,
  "data": {
    "title": "Naruto Shippuden",
    "description": "...",
    "genres": ["Action", "Adventure"],
    "thumbnail": "https://...",
    "is_movie": false,
    "episodes": [
      {
        "number": "1",
        "title": "Homecoming",
        "url": "...",
        "id": "naruto-shippuden-1x1",
        "thumbnail": "https://...",
        "season": "1"
      }
    ],
    "movie_players": [] // Filled with iframe URLs if `is_movie` is true
  }
}
```

### 4. Episode Streaming
- **URL**: `GET /api/episode/{episode_id}`
- **Description**: Returns the video iframe player URL for a specific episode.
- **Response Shape**:
```json
{
  "success": true,
  "data": {
    "video_player": "https://as-cdn21.top/video/...",
    "m3u8_link": null,
    "source": "..."
  }
}
```

## Your Task

1. **Tech Stack**: Choose a modern framework like React (Next.js/Vite), Vue, or Svelte with TailwindCSS.
2. **Pages**:
   - **Home Page**: Fetch `/api/home` and display horizontal scrollable carousels/grids for each section.
   - **Search Page/Modal**: Implement a search bar that calls `/api/search?q=...` and displays a grid of results.
   - **Details Page**: Route to `/anime/[slug]`. Call `/api/anime/{slug}`. Show the thumbnail, description, and genres at the top.
     - If `is_movie == true`, embed the players from `movie_players`.
     - If `is_movie == false`, display a list or grid of `episodes`. Consider grouping them by `season`.
   - **Watch Page**: Route to `/watch/[episode_id]`. Call `/api/episode/{episode_id}` and embed the `video_player` in an `<iframe>` spanning the screen width.
3. **UI/UX**: Make it dark-themed, sleek, and highly responsive, similar to platforms like Netflix or Crunchyroll. Include loading skeletons while fetching data.

Good luck!
