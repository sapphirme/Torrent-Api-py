import unittest
from unittest.mock import patch

from torrents.subplease import SubPlease


class SubPleaseFeedTests(unittest.IsolatedAsyncioTestCase):
    def test_parses_rss_release_fields(self):
        feed = b"""<?xml version=\"1.0\"?>
        <rss version=\"2.0\" xmlns:subsplease=\"https://subsplease.org/rss\">
          <channel><item>
                        <title>[SubsPlease] Example Anime - 02 (480p).mkv</title>
            <link>magnet:?xt=urn:btih:ABC123&amp;dn=example</link>
            <guid isPermaLink=\"false\">ABC123</guid>
            <pubDate>Sun, 11 Oct 2026 09:23:52 +0000</pubDate>
                        <category>Example Anime - 480</category>
            <subsplease:size>468.23 MiB</subsplease:size>
                    </item><item>
                        <title>[SubsPlease] Example Anime - 02 (1080p).mkv</title>
                        <link>magnet:?xt=urn:btih:DEF456&amp;dn=example</link>
                    </item></channel>
        </rss>"""

        item = SubPlease._parse_feed(feed)[0]

        self.assertEqual(item["name"], "[SubsPlease] Example Anime - 02 (480p).mkv")
        self.assertEqual(item["hash"], "ABC123")
        self.assertEqual(item["size"], "468.23 MiB")
        self.assertEqual(item["category"], "Example Anime - 480")
        self.assertIn("magnet:?xt=urn:btih:ABC123", item["magnet"])
        self.assertEqual(len(SubPlease._parse_feed(feed)), 1)

    def test_parses_only_480p_site_api_downloads(self):
        payload = {
            "Example Anime - 02": {
                "show": "Example Anime",
                "episode": "02",
                "page": "example-anime",
                "release_date": "Sun, 11 Oct 2026 09:23:52 +0000",
                "downloads": [
                    {
                        "res": "480",
                        "magnet": "magnet:?xt=urn:btih:ABC123&dn=Example+Anime+02+%28480p%29&xl=123",
                        "torrent": "https://example.com/480.torrent",
                    },
                    {"res": "720", "magnet": "magnet:?xt=urn:btih:DEF456"},
                ],
            }
        }

        results = SubPlease._parse_site_releases(payload)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["hash"], "ABC123")
        self.assertEqual(results[0]["size"], 123)
        self.assertEqual(results[0]["category"], "Example Anime")
        self.assertTrue(results[0]["name"].endswith("(480p)"))

    async def test_search_filters_titles_and_paginates(self):
        items = [
            {"name": "Example Anime episode 1", "category": "anime"},
            {"name": "Example Anime episode 2", "category": "anime"},
        ]
        with patch.object(SubPlease, "_search_site", return_value=items):
            results = await SubPlease().search("example anime", page=2, limit=1)

        self.assertEqual(results["total"], 2)
        self.assertEqual(results["data"][0]["name"], "Example Anime episode 2")

    async def test_anime_category_includes_feed_items(self):
        items = [{"name": "Example Anime episode 1", "category": "Example - 1080"}]
        with patch.object(SubPlease, "_fetch_feed", return_value=items):
            results = await SubPlease().recent(category="anime")

        self.assertEqual(results["total"], 1)

    async def test_show_slug_fetches_show_releases(self):
        metadata = {
            "slug": "example-anime",
            "sid": "123",
            "title": "Example Anime",
            "url": "https://subsplease.org/shows/example-anime/",
        }
        payload = {
            "episode": {
                "Example Anime - 01": {
                    "show": "Example Anime",
                    "page": "example-anime",
                    "downloads": [
                        {
                            "res": "480",
                            "magnet": "magnet:?xt=urn:btih:ABC123&dn=Example+Anime+01+%28480p%29",
                        }
                    ],
                }
            }
        }
        with patch.object(SubPlease, "_show_metadata", return_value=metadata), patch.object(
            SubPlease, "_fetch_site_api", return_value=payload
        ):
            results = await SubPlease().show_by_slug("example-anime")

        self.assertEqual(results["show"]["sid"], "123")
        self.assertEqual(results["total"], 1)
        self.assertTrue(results["data"][0]["name"].endswith("(480p)"))

    async def test_anilist_id_searches_title_variants(self):
        media = {
            "id": 178788,
            "title": {"romaji": "Romaji Title", "english": "English Title"},
            "synonyms": ["Alternate Title"],
        }
        release = {
            "name": "[SubsPlease] Romaji Title - 01 (480p).mkv",
            "hash": "ABC123",
        }
        with patch.object(SubPlease, "_anilist_media", return_value=media), patch.object(
            SubPlease, "_search_site", return_value=[release]
        ) as search_site:
            results = await SubPlease().search_anilist(178788)

        self.assertEqual(results["show"]["anilist_id"], 178788)
        self.assertEqual(results["total"], 1)
        self.assertEqual(search_site.call_count, 3)

    async def test_episode_lookup_matches_exact_episode_number(self):
        releases = {
            "data": [
                {"name": "[SubsPlease] Example Anime - 02 (480p).mkv"},
                {"name": "[SubsPlease] Example Anime - 12 (480p).mkv"},
            ],
            "total": 2,
            "show": {"title": "Example Anime"},
        }
        with patch.object(SubPlease, "show_by_slug", return_value=releases):
            results = await SubPlease().episode(2, slug="example-anime")

        self.assertEqual(results["total"], 1)
        self.assertEqual(results["data"][0]["name"], releases["data"][0]["name"])
        self.assertEqual(results["show"]["title"], "Example Anime")

    def test_episode_metadata_is_preserved_from_site_api(self):
        payload = {
            "episode": {
                "Example Anime - 02": {
                    "show": "Example Anime",
                    "episode": "02",
                    "downloads": [
                        {
                            "res": "480",
                            "magnet": "magnet:?xt=urn:btih:ABC123&dn=Example+Anime+02+%28480p%29",
                        }
                    ],
                }
            }
        }

        results = SubPlease._parse_site_releases(payload)

        self.assertEqual(results[0]["episode"], "02")


if __name__ == "__main__":
    unittest.main()