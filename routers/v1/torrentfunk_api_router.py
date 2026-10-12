import os
from typing import Optional

from curl_cffi import requests
from fastapi import APIRouter, HTTPException, Query
from torrents.torrentfunk import filter_torrentfunk_results

router = APIRouter(tags=["TorrentFunk JSON API"])

BASE_URL = "https://www.torrentfunk.com"


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
