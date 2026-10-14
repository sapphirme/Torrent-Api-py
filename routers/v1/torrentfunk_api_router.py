import os
import re
from typing import Optional

from curl_cffi import requests
from fastapi import APIRouter, HTTPException, Query
from torrents.torrentfunk import filter_torrentfunk_results

router = APIRouter(tags=["TorrentFunk JSON API"])

BASE_URL = "https://www.torrentfunk.com"


def _fetch_tmdb(path: str):
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not tmdb_key:
        raise HTTPException(status_code=503, detail="TMDB_API_KEY is not configured")
    try:
        response = requests.get(
            f"https://api.themoviedb.org/3{path}",
            params={"api_key": tmdb_key},
            timeout=20,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="TMDB request failed") from exc
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="TMDB item was not found")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="TMDB lookup failed")
    return response.json()


def _matches_series_episode(name: str, season: int, episode: int):
    patterns = [
        rf"\bS0*{season}\s*[-._ ]?\s*E0*{episode}(?!\d)(?!-\s*0*\d+)",
        rf"\bSeason\s+0*{season}\s+(?:Episode|Ep)\s+0*{episode}(?!\d)(?!-\s*0*\d+)",
    ]
    if season == 1:
        patterns.append(
            rf"\s-\s*0*{episode}(?!-\s*0*\d+)(?=\s*(?:\(|\[|$))"
        )
    return any(re.search(pattern, name, re.IGNORECASE) for pattern in patterns)


def _fetch_json(endpoint: str, params: dict):
    try:
        requested_limit = params.get("limit", 20)
        params = {**params, "limit": 100}
        response = requests.get(
            f"{BASE_URL}{endpoint}",
            params=params,
            impersonate="chrome",
            timeout=30,
        )
        if response.status_code >= 400:
            raise HTTPException(
                status_code=response.status_code,
                detail=response.text[:500] or "TorrentFunk request failed",
            )
        payload = response.json()
        if isinstance(payload, dict) and payload.get("status") == "error":
            raise HTTPException(
                status_code=400,
                detail=payload.get("error", "TorrentFunk API error"),
            )
        payload = filter_torrentfunk_results(payload)
        if isinstance(payload, dict) and isinstance(payload.get("results"), list):
            payload["results"] = payload["results"][:requested_limit]
            payload["count"] = len(payload["results"])
            payload["total_found"] = len(payload["results"])
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"TorrentFunk API request failed: {exc}",
        ) from exc


@router.get("")
@router.get("/")
@router.get("/search")
@router.get("/search.json")
async def torrentfunk_search(
    q: Optional[str] = Query(None, description="Search terms"),
    tmdb_id: Optional[int] = Query(None, description="TMDB movie ID"),
    category: Optional[str] = None,
    verified: Optional[int] = None,
    sort: Optional[str] = "seeds",
    order: Optional[str] = "desc",
    limit: int = 20,
    page: int = 1,
):
    if bool(q) == (tmdb_id is not None):
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of q or tmdb_id",
        )
    tmdb_movie = None
    if tmdb_id is not None:
        tmdb_key = os.getenv("TMDB_API_KEY")
        if not tmdb_key:
            raise HTTPException(status_code=503, detail="TMDB_API_KEY is not configured")
        try:
            response = requests.get(
                f"https://api.themoviedb.org/3/movie/{tmdb_id}",
                params={"api_key": tmdb_key},
                timeout=20,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="TMDB request failed") from exc
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="TMDB movie was not found")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="TMDB movie lookup failed")
        tmdb_movie = response.json()
        title = tmdb_movie.get("title") or tmdb_movie.get("original_title")
        if not title:
            raise HTTPException(status_code=502, detail="TMDB movie has no title")
        year = (tmdb_movie.get("release_date") or "")[:4]
        q = f"{title} {year}".strip()

    params = {
        "q": q,
        "sort": sort,
        "order": order,
        "limit": min(max(limit, 1), 100),
        "page": max(page, 1),
    }
    if category:
        params["category"] = category
    if verified is not None:
        params["verified"] = verified
    results = _fetch_json("/api/search.json", params)
    if tmdb_movie and isinstance(results, dict):
        results["tmdb"] = {
            "id": tmdb_movie.get("id"),
            "title": tmdb_movie.get("title"),
            "release_date": tmdb_movie.get("release_date"),
        }
    return results


@router.get("/episode")
async def torrentfunk_episode(
    tmdb_id: int = Query(..., ge=1, description="TMDB TV series ID"),
    season: int = Query(..., ge=1, description="Season number"),
    episode: int = Query(..., ge=1, description="Episode number"),
    max_size_gb: float = Query(1.5, ge=1.0, le=1.5),
    limit: int = 20,
    page: int = 1,
):
    series = _fetch_tmdb(f"/tv/{tmdb_id}")
    tmdb_episode = _fetch_tmdb(
        f"/tv/{tmdb_id}/season/{season}/episode/{episode}"
    )
    series_title = series.get("name") or series.get("original_name")
    if not series_title:
        raise HTTPException(status_code=502, detail="TMDB series has no title")

    episode_code = f"S{season:02d}E{episode:02d}"
    episode_title = tmdb_episode.get("name")
    query = f"{series_title} {episode_code} {episode_title or ''}".strip()
    params = {
        "q": query,
        "sort": "seeds",
        "order": "desc",
        "limit": 100,
        "page": 1,
        "category": "television",
    }
    results = _fetch_json("/api/search.json", params)
    if not isinstance(results, dict) or not isinstance(results.get("results"), list):
        return results

    max_size_bytes = max_size_gb * 1024**3
    matches = [
        item
        for item in results["results"]
        if item.get("size_bytes", max_size_bytes) < max_size_bytes
        and _matches_series_episode(item.get("name") or "", season, episode)
    ]
    page_size = min(max(limit, 1), 100)
    start = (max(page, 1) - 1) * page_size
    results["results"] = matches[start : start + page_size]
    results["count"] = len(results["results"])
    results["total_found"] = len(matches)
    results["tmdb"] = {
        "id": tmdb_id,
        "title": series_title,
        "season": season,
        "episode": episode,
        "episode_title": episode_title,
    }
    return results


@router.get("/latest")
@router.get("/latest.json")
async def torrentfunk_latest(
    category: Optional[str] = None,
    verified: Optional[int] = None,
    limit: int = 20,
    page: int = 1,
):
    params = {
        "limit": min(max(limit, 1), 100),
        "page": max(page, 1),
    }
    if category:
        params["category"] = category
    if verified is not None:
        params["verified"] = verified
    return _fetch_json("/api/latest.json", params)
