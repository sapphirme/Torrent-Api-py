from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from .scraper import scrape_home, scrape_search, scrape_details, scrape_episode, resolve_multi_lang_stream

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

app = FastAPI(
    title="AnimeSalt API",
    description="An unofficial scraper API for animesalt.ac",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )

@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    logging.error(f"Unhandled error: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )

@app.get("/")
async def root():
    return {"message": "Welcome to the AnimeSalt API. Visit /docs for documentation."}

@app.get("/api/home")
async def get_home(response: Response):
    """Scrape latest anime, trending, and featured sections."""
    # Cache on CDN for 1 hour, stale while revalidate for 24 hours
    response.headers["Cache-Control"] = "public, s-maxage=3600, stale-while-revalidate=86400"
    data = await scrape_home()
    return {"success": True, "data": data}

@app.get("/api/search")
async def get_search(response: Response, q: str = Query(..., description="Search query")):
    """Scrape search results dynamically."""
    # Cache searches for 1 hour
    response.headers["Cache-Control"] = "public, s-maxage=3600, stale-while-revalidate=86400"
    data = await scrape_search(q)
    return {"success": True, "query": q, "results": data}

@app.get("/api/anime/{slug}")
async def get_anime_details(response: Response, slug: str):
    """Scrape Title, Description, Genres, Episodes list, Thumbnail."""
    # Cache details for 12 hours
    response.headers["Cache-Control"] = "public, s-maxage=43200, stale-while-revalidate=86400"
    data = await scrape_details(slug)
    return {"success": True, "data": data}

@app.get("/api/episode/{episode_id}")
async def get_episode(response: Response, episode_id: str):
    """Extract video player or iframe. If m3u8 link exists, return it."""
    # NOTE: the m3u8_link is a signed URL with a short `expires` timestamp
    # (usually a few minutes), so this response must NOT be cached — a
    # cached response would hand out an already-expired link.
    response.headers["Cache-Control"] = "no-store"
    data = await scrape_episode(episode_id)
    return {"success": True, "data": data}

@app.get("/api/episode/{episode_id}/lang/{language}")
async def get_episode_lang(response: Response, episode_id: str, language: str):
    """Resolve one dub-language "Server 2" entry (see multi_lang_servers on
    /api/episode/{id}) through its short.icu link to an actual stream.

    Slow (launches a headless browser) and best-effort — short.icu's
    click-through/countdown behavior may change without notice. Never
    cached, same reasoning as the main episode endpoint.
    """
    response.headers["Cache-Control"] = "no-store"
    from .scraper import scrape_episode_meta
    meta = await scrape_episode_meta(episode_id)
    servers = meta.get("multi_lang_servers", [])

    match = next(
        (s for s in servers if s["language"].strip().lower() == language.strip().lower()),
        None,
    )
    if not match:
        available = [s["language"] for s in servers]
        raise HTTPException(
            status_code=404,
            detail=f"No '{language}' server for this episode. Available: {available}",
        )

    result = await resolve_multi_lang_stream(match["link"])
    return {
        "success": result["error"] is None,
        "data": {
            "language": match["language"],
            "short_link": match["link"],
            **result,
        },
    }

if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
