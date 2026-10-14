import json
import unittest
from unittest.mock import MagicMock

from helper.html_scraper import Scraper
from torrents.torrentfunk import TorrentFunk
from routers.v1.torrentfunk_api_router import _matches_series_episode


class FakeResponse:
    def __init__(self, payload, content_type):
        self.payload = payload
        self.headers = {"Content-Type": content_type}

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self, content_type=None):
        return self.payload

    async def text(self):
        if isinstance(self.payload, str):
            return self.payload
        return json.dumps(self.payload)


class HtmlScraperJsonTests(unittest.IsolatedAsyncioTestCase):
    async def test_parses_json_response(self):
        session = MagicMock()
        expected = {"data": [{"name": "example"}]}
        session.get.return_value = FakeResponse(expected, "application/json")

        result = await Scraper()._get_html(session, "https://example.com/data")

        self.assertEqual(result, expected)

    async def test_keeps_html_response_as_text(self):
        session = MagicMock()
        expected = "<html><body>ok</body></html>"
        session.get.return_value = FakeResponse(expected, "text/html")

        result = await Scraper()._get_html(session, "https://example.com")

        self.assertEqual(result, expected)

    async def test_rejects_cloudflare_challenge_page(self):
        session = MagicMock()
        session.get.return_value = FakeResponse(
            "<title>Just a moment...</title><div>Checking your browser before accessing</div>",
            "text/html",
        )

        result = await Scraper()._get_html(session, "https://www.torrentfunk.com")

        self.assertIsNone(result)

    def test_torrentfunk_api_payload_is_parsed(self):
        payload = {
            "status": "ok",
            "page": 1,
            "limit": 1,
            "count": 1,
            "total_found": 1,
            "results": [
                {
                    "id": 1,
                    "name": "Ubuntu Linux Bible [Eng Sub]",
                    "infohash": "45bb7b3ac77116ef4e7ec743e2a8319caddf87b1",
                    "magnet": "magnet:?xt=urn:btih:45bb7b3ac77116ef4e7ec743e2a8319caddf87b1",
                    "torrent_file": "https://example.com/file.torrent",
                    "url": "https://www.torrentfunk.com/torrent/1/ubuntu-linux-bible.html",
                    "category": "Software",
                    "category_id": 5,
                    "size_bytes": 8488590,
                    "size": "8.1 MB",
                    "seeds": 5,
                    "peers": 1,
                    "verified": False,
                    "added": 1766370340,
                    "added_iso": "2025-12-22T02:25:40+00:00",
                }
            ],
        }

        parsed = TorrentFunk()._parse_api_response(payload, limit=1)

        self.assertEqual(parsed["data"][0]["name"], "Ubuntu Linux Bible [Eng Sub]")
        self.assertEqual(parsed["data"][0]["hash"], "45bb7b3ac77116ef4e7ec743e2a8319caddf87b1")
        self.assertEqual(parsed["data"][0]["seeders"], 5)
        self.assertEqual(parsed["data"][0]["category"], "Software")

    def test_torrentfunk_results_require_small_size_and_english_subtitle_marker(self):
        payload = {
            "status": "ok",
            "results": [
                {"name": "Film (2024) [Eng Sub]", "size_bytes": 1_900_000_000},
                {"name": "Film (2024) [Eng Sub]", "size_bytes": 2 * 1024**3},
                {"name": "Film (2024) 1080p", "size_bytes": 1_000_000_000},
                {"name": "Film (2024) [English Subtitles]", "size_bytes": 1_000_000_000},
            ],
        }

        parsed = TorrentFunk()._parse_api_response(payload, limit=10)

        self.assertEqual(
            [item["name"] for item in parsed["data"]],
            ["Film (2024) [Eng Sub]", "Film (2024) [English Subtitles]"],
        )

    def test_series_episode_match_requires_requested_season_and_episode(self):
        self.assertTrue(
            _matches_series_episode("Example Show S02E03 480p Eng Sub", 2, 3)
        )
        self.assertFalse(
            _matches_series_episode("Example Show S02E13 480p Eng Sub", 2, 3)
        )
        self.assertFalse(
            _matches_series_episode("Example Show S01E03 480p Eng Sub", 2, 3)
        )
        self.assertFalse(
            _matches_series_episode("Example Show S02E03-04 480p Eng Sub", 2, 3)
        )


if __name__ == "__main__":
    unittest.main()
