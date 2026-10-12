from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from torrents.subplease import SubPlease

router = APIRouter(tags=["SubsPlease RSS API"])


def _response(results, endpoint, page, limit):
    if results is None:
        raise HTTPException(status_code=404, detail="SubsPlease show or AniList ID was not found")
    response = {
        "status": "ok",
        "endpoint": endpoint,
        "page": page,
        "limit": limit,
        "count": len(results["data"]),
        "total_found": results["total"],
        "results": results["data"],
    }
    if "show" in results:
        response["show"] = results["show"]
    return response


@router.get("/search")
@router.get("/search.json")
async def subplease_search(
    q: Optional[str] = Query(None, description="Anime title to search"),
    slug: Optional[str] = Query(None, description="SubsPlease show slug"),
    anilist_id: Optional[int] = Query(None, description="AniList anime ID"),
    limit: int = 20,
    page: int = 1,
):
    limit = min(max(limit, 1), 50)
    page = max(page, 1)
    selectors = [bool(q), bool(slug), anilist_id is not None]
    if sum(selectors) != 1:
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of q, slug, or anilist_id",
        )

    provider = SubPlease()
    if slug:
        results = await provider.show_by_slug(slug, page, limit)
        endpoint = "show"
    elif anilist_id is not None:
        results = await provider.search_anilist(anilist_id, page, limit)
        endpoint = "anilist"
    else:
        results = await provider.search(q, page, limit)
        endpoint = "search"
    return _response(results, endpoint, page, limit)


@router.get("/shows/{slug}")
async def subplease_show_by_slug(slug: str, limit: int = 20, page: int = 1):
    limit = min(max(limit, 1), 50)
    page = max(page, 1)
    results = await SubPlease().show_by_slug(slug, page, limit)
    return _response(results, "show", page, limit)


@router.get("/anilist/{anilist_id}")
async def subplease_show_by_anilist_id(
    anilist_id: int,
    limit: int = 20,
    page: int = 1,
):
    limit = min(max(limit, 1), 50)
    page = max(page, 1)
    results = await SubPlease().search_anilist(anilist_id, page, limit)
    return _response(results, "anilist", page, limit)


@router.get("")
@router.get("/")
@router.get("/latest")
@router.get("/latest.json")
async def subplease_latest(
    category: Optional[str] = None,
    limit: int = 20,
    page: int = 1,
):
    limit = min(max(limit, 1), 50)
    page = max(page, 1)
    results = await SubPlease().recent(category, page, limit)
    return _response(results, "latest", page, limit)