import re
import time
from html import unescape
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, quote, urlparse

from bs4 import BeautifulSoup
from curl_cffi import requests


class SubPlease:
    _name = "SubsPlease"
    RSS_URL = "https://subsplease.org/rss/"
    API_URL = "https://subsplease.org/api/"
    SHOWS_URL = "https://subsplease.org/shows/"
    ANILIST_URL = "https://graphql.anilist.co"
    ANILIST_QUERY = """query ($id: Int, $search: String) {
            Media(id: $id, search: $search, type: ANIME) {
                id
                title { romaji english native }
                synonyms
            }
        }"""

    def __init__(self):
        self.LIMIT = None

    @staticmethod
    def _parse_feed(xml_data):
        root = ET.fromstring(xml_data)
        items = []

        for item in root.findall("./channel/item"):
            title = item.findtext("title")
            magnet = item.findtext("link")
            if (
                not title
                or not magnet
                or re.search(r"(?<![0-9])480p(?![0-9])", title, re.IGNORECASE) is None
            ):
                continue

            query = parse_qs(urlparse(magnet).query)
            xt = query.get("xt", [""])[0]
            info_hash = xt.rsplit(":", 1)[-1] if xt else item.findtext("guid")
            size = next(
                (
                    child.text
                    for child in item
                    if child.tag.rsplit("}", 1)[-1] == "size"
                ),
                None,
            )

            items.append(
                {
                    "name": title,
                    "size": size,
                    "seeders": None,
                    "leechers": None,
                    "category": item.findtext("category"),
                    "hash": info_hash,
                    "magnet": magnet,
                    "torrent": magnet,
                    "url": None,
                    "date": item.findtext("pubDate"),
                    "downloads": None,
                    "uploader": "SubsPlease",
                    "verified": None,
                }
            )

        return items

    def _fetch_feed(self):
        try:
            response = requests.get(
                self.RSS_URL,
                headers={"User-Agent": "Torrent-Api-Py/1.0"},
                timeout=20,
            )
            if response.status_code != 200:
                return None
            return self._parse_feed(response.content)
        except (ET.ParseError, ValueError, OSError):
            return None
        except Exception:
            return None

    @staticmethod
    def _parse_site_releases(payload):
        if not isinstance(payload, dict):
            return []

        if "episode" in payload or "batch" in payload:
            release_groups = [payload.get("batch", {}), payload.get("episode", {})]
        else:
            release_groups = [payload]

        results = []
        seen_hashes = set()
        for group in release_groups:
            if isinstance(group, dict):
                releases = group.items()
            elif isinstance(group, list):
                releases = ((None, release) for release in group)
            else:
                continue

            for release_key, release in releases:
                if not isinstance(release, dict):
                    continue
                for download in release.get("downloads", []):
                    if str(download.get("res", "")).strip() != "480":
                        continue

                    magnet = download.get("magnet")
                    if not magnet:
                        continue
                    magnet_query = parse_qs(urlparse(magnet).query)
                    xt = magnet_query.get("xt", [""])[0]
                    info_hash = xt.rsplit(":", 1)[-1] if xt else None
                    if info_hash and info_hash in seen_hashes:
                        continue
                    if info_hash:
                        seen_hashes.add(info_hash)

                    name = magnet_query.get("dn", [""])[0]
                    if not name:
                        name = release_key or release.get("show", "SubsPlease release")
                    size = magnet_query.get("xl", [None])[0]
                    results.append(
                        {
                            "name": name,
                            "size": int(size) if size and size.isdigit() else None,
                            "seeders": None,
                            "leechers": None,
                            "category": release.get("show"),
                            "hash": info_hash,
                            "magnet": magnet,
                            "torrent": download.get("torrent"),
                            "url": (
                                f"{SubPlease.SHOWS_URL}{release['page']}/"
                                if release.get("page")
                                else None
                            ),
                            "date": release.get("release_date") or release.get("time"),
                            "downloads": None,
                            "uploader": "SubsPlease",
                            "verified": None,
                        }
                    )
        return results

    @staticmethod
    def _fetch_site_api(params):
        try:
            response = requests.get(
                SubPlease.API_URL,
                params={"tz": "UTC", **params},
                headers={"User-Agent": "Torrent-Api-Py/1.0"},
                timeout=20,
            )
            if response.status_code != 200:
                return None
            return response.json()
        except Exception:
            return None

    @staticmethod
    def _show_metadata(slug):
        if not re.fullmatch(r"[a-z0-9-]+", slug):
            return None
        try:
            response = requests.get(
                f"{SubPlease.SHOWS_URL}{quote(slug, safe='-')}/",
                headers={"User-Agent": "Torrent-Api-Py/1.0"},
                timeout=20,
            )
            if response.status_code != 200:
                return None
            soup = BeautifulSoup(response.text, "html.parser")
            release_table = soup.select_one("#show-release-table")
            title = soup.select_one("h1.entry-title")
            if release_table is None or not release_table.get("sid") or title is None:
                return None
            return {
                "slug": slug,
                "sid": str(release_table["sid"]),
                "title": unescape(title.get_text(" ", strip=True)),
                "url": f"{SubPlease.SHOWS_URL}{slug}/",
            }
        except Exception:
            return None

    @staticmethod
    def _anilist_media(anilist_id):
        try:
            response = requests.post(
                SubPlease.ANILIST_URL,
                json={
                    "query": SubPlease.ANILIST_QUERY,
                    "variables": {"id": anilist_id},
                },
                headers={"User-Agent": "Torrent-Api-Py/1.0"},
                impersonate="chrome",
                timeout=20,
            )
            if response.status_code != 200:
                return None
            return response.json().get("data", {}).get("Media")
        except Exception:
            return None

    @staticmethod
    def _page_results(items, page, limit):
        total = len(items)
        limit = min(max(limit, 1), 50)
        start = (max(page, 1) - 1) * limit
        return {"data": items[start : start + limit], "total": total}

    def _search_site(self, query):
        payload = self._fetch_site_api({"f": "search", "s": query})
        return self._parse_site_releases(payload)

    async def show_by_slug(self, slug, page=1, limit=20):
        started = time.time()
        metadata = self._show_metadata(slug)
        if metadata is None:
            return None
        payload = self._fetch_site_api({"f": "show", "sid": metadata["sid"]})
        results = self._page_results(self._parse_site_releases(payload), page, limit)
        results["show"] = metadata
        results["time"] = time.time() - started
        return results

    async def search_anilist(self, anilist_id, page=1, limit=20):
        started = time.time()
        media = self._anilist_media(anilist_id)
        if media is None:
            return None

        titles = media.get("title") or {}
        queries = []
        for title in [titles.get("romaji"), titles.get("english"), titles.get("native"), *media.get("synonyms", [])]:
            if title and title not in queries:
                queries.append(title)

        matches = {}
        for query in queries[:8]:
            for item in self._search_site(query):
                matches.setdefault(item.get("hash") or item["name"], item)

        results = self._page_results(list(matches.values()), page, limit)
        results["show"] = {
            "anilist_id": media.get("id"),
            "titles": titles,
            "synonyms": media.get("synonyms", []),
        }
        results["time"] = time.time() - started
        return results

    def _results(self, items, page, limit, query=None, category=None):
        if items is None:
            return None

        if query:
            normalized_query = query.strip().casefold()
            items = [item for item in items if normalized_query in item["name"].casefold()]
        if category and category.strip().casefold() != "anime":
            normalized_category = category.strip().casefold()
            items = [
                item
                for item in items
                if normalized_category in (item["category"] or "").casefold()
            ]

        total = len(items)
        start = (max(page, 1) - 1) * min(max(limit, 1), 50)
        end = start + min(max(limit, 1), 50)
        return {"data": items[start:end], "total": total}

    async def search(self, query, page=1, limit=20):
        started = time.time()
        if not query or not query.strip():
            return {"data": [], "total": 0, "time": time.time() - started}
        items = self._search_site(query.strip())
        results = self._page_results(items, page, limit)
        results["time"] = time.time() - started
        return results

    async def recent(self, category=None, page=1, limit=20):
        started = time.time()
        items = self._fetch_feed()
        results = self._results(items, page, limit, category=category)
        if results is None:
            return None
        results["time"] = time.time() - started
        return results