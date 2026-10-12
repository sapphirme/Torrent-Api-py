import os
import json
import asyncio
from .asyncioPoliciesFix import decorator_asyncio_fix
from constants.headers import HEADER_AIO

HTTP_PROXY = os.environ.get("HTTP_PROXY", None)


class Scraper:
    @staticmethod
    def _is_cloudflare_challenge(text):
        if not text:
            return False
        lower = text.lower()
        return (
            "just a moment" in lower
            or "cloudflare" in lower
            or "cf-challenge" in lower
            or "checking your browser before accessing" in lower
        )

    @decorator_asyncio_fix
    async def _get_html(self, session, url):
        try:
            async with session.get(url, headers=HEADER_AIO, proxy=HTTP_PROXY) as r:
                content_type = (r.headers.get("Content-Type") or "").lower()
                if "json" in content_type:
                    try:
                        return await r.json(content_type=None)
                    except Exception:
                        pass

                text = await r.text()
                if not text:
                    return None

                if self._is_cloudflare_challenge(text):
                    return None

                stripped = text.strip()
                if stripped.startswith("{") or stripped.startswith("["):
                    try:
                        return json.loads(stripped)
                    except Exception:
                        pass

                return text
        except Exception:
            return None

    async def get_all_results(self, session, url):
        return await asyncio.gather(asyncio.create_task(self._get_html(session, url)))
