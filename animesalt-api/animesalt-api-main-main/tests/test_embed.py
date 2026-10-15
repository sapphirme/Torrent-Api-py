import asyncio
from curl_cffi.requests import AsyncSession

async def main():
    async with AsyncSession(impersonate="chrome110") as session:
        r = await session.get("https://as-cdn21.top/video/36660e59856b4de58a219bcf4e27eba3")
        with open("embed.html", "w", encoding="utf-8") as f:
            f.write(r.text)

if __name__ == "__main__":
    asyncio.run(main())