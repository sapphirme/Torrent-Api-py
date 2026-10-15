import asyncio
from curl_cffi.requests import AsyncSession

async def main():
    async with AsyncSession(impersonate="chrome120") as session:
        r = await session.get("https://animesalt.ac/movies/shinchan-movie-the-spicy-kasukabe-dancers/")
        with open("movie.html", "w", encoding="utf-8") as f:
            f.write(r.text)

if __name__ == "__main__":
    asyncio.run(main())
