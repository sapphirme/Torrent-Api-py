import re
import time
from curl_cffi import requests
from constants.base_url import TORRENTFUNK

MAX_RESULT_SIZE_BYTES = 2 * 1024 * 1024 * 1024
ENGLISH_SUBTITLE_PATTERN = re.compile(
    r"\b(?:eng|english)[\s._-]*(?:subs?|subtitles?|subbed)\b",
    re.IGNORECASE,
)


def filter_torrentfunk_results(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        return payload

    filtered = [
        item
        for item in payload["results"]
        if isinstance(item, dict)
        and isinstance(item.get("size_bytes"), (int, float))
        and 0 < item["size_bytes"] < MAX_RESULT_SIZE_BYTES
        and ENGLISH_SUBTITLE_PATTERN.search(item.get("name") or "")
    ]
    result = {**payload, "results": filtered}
    result["count"] = len(filtered)
    result["total_found"] = len(filtered)
    return result


class TorrentFunk:
    _name = "Torrent Funk"

    def __init__(self):
        self.BASE_URL = TORRENTFUNK
        self.LIMIT = None

    @staticmethod
    def _normalize_category(category):
        if category is None:
            return None

        normalized = str(category).strip().lower()
        mapping = {
            "tv": "television",
            "television": "television",
            "apps": "software",
            "software": "software",
            "xxx": "adult",
            "adult": "adult",
            "books": "eBooks",
            "ebook": "eBooks",
            "ebooks": "eBooks",
            "images": "images",
            "audiobooks": "Audiobooks",
            "movies": "movies",
            "music": "music",
            "games": "games",
            "anime": "anime",
        }
        return mapping.get(normalized, category)

    def _parse_api_response(self, payload, limit):
        payload = filter_torrentfunk_results(payload)
        if payload is None:
            return None
        if payload.get("status") == "error":
            return None
        if payload.get("status") != "ok":
            return None

        my_dict = {"data": []}
        for item in payload.get("results", []):
            if not item:
                continue
            my_dict["data"].append(
                {
                    "name": item.get("name"),
                    "size": item.get("size"),
                    "seeders": item.get("seeds"),
                    "leechers": item.get("peers"),
                    "category": item.get("category"),
                    "hash": item.get("infohash"),
                    "magnet": item.get("magnet"),
                    "torrent": item.get("torrent_file"),
                    "url": item.get("url"),
                    "date": item.get("added_iso") or item.get("added"),
                    "downloads": None,
                    "uploader": None,
                    "verified": item.get("verified"),
                }
            )
            if limit and len(my_dict["data"]) >= limit:
                break
        return my_dict

    def _fetch_api(self, endpoint, params):
        try:
            response = requests.get(
                self.BASE_URL + endpoint,
                params=params,
                impersonate="chrome",
                timeout=30,
            )
            if response.status_code != 200:
                return None
            payload = response.json()
            if payload.get("status") == "error":
                return None
            return payload
        except Exception:
            return None

    async def search(self, query, page, limit):
        start_time = time.time()
        self.LIMIT = limit
        payload = self._fetch_api(
            "/api/search.json",
            {"q": query, "page": page, "limit": 100},
        )
        results = self._parse_api_response(payload, limit)
        if results is None:
            return None
        results["time"] = time.time() - start_time
        results["total"] = len(results["data"])
        return results

    async def trending(self, category, page, limit):
        start_time = time.time()
        self.LIMIT = limit
        params = {"page": page, "limit": 100}
        mapped_category = self._normalize_category(category)
        if mapped_category:
            params["category"] = mapped_category
        payload = self._fetch_api("/api/latest.json", params)
        results = self._parse_api_response(payload, limit)
        if results is None:
            return None
        results["time"] = time.time() - start_time
        results["total"] = len(results["data"])
        return results

    async def recent(self, category, page, limit):
        return await self.trending(category, page, limit)
