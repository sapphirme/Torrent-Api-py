import asyncio
from curl_cffi.requests import AsyncSession

async def main():
    async with AsyncSession(impersonate="chrome110") as session:
        # Home
        r = await session.get("https://animesalt.ac/")
        with open("home.html", "w", encoding="utf-8") as f:
            f.write(r.text)

        # Search
        r = await session.get("https://animesalt.ac/?s=naruto")
        with open("search.html", "w", encoding="utf-8") as f:
            f.write(r.text)

        # Anime Details
        r = await session.get("https://animesalt.ac/anime/naruto/")
        with open("details.html", "w", encoding="utf-8") as f:
            f.write(r.text)

        # Episode
        r = await session.get("https://animesalt.ac/episode/naruto-1x1/")
        with open("episode.html", "w", encoding="utf-8") as f:
            f.write(r.text)

if __name__ == "__main__":
    asyncio.run(main())