import asyncio
from curl_cffi.requests import AsyncSession
from bs4 import BeautifulSoup
from api.scraper import _extract_image

async def fetch_season_html(session, post_id, season_num, referer):
    url = f"https://animesalt.ac/wp-admin/admin-ajax.php?action=action_select_season&season={season_num}&post={post_id}"
    try:
        r = await session.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": referer})
        return season_num, r.text
    except:
        return season_num, ""

def extract_episodes_from_html(html, season_num):
    soup = BeautifulSoup(html, "lxml")
    episodes = []
    ep_items = soup.select("article.episodes")
    for item in ep_items:
        ep_num_elem = item.select_one(".num-epi")
        ep_title_elem = item.select_one(".entry-title")
        ep_link_elem = item.parent.select_one("a.lnk-blk") or item.select_one("a.lnk-blk")
        
        img_elem = item.select_one("img")
        thumbnail = _extract_image(img_elem) if img_elem else ""

        ep_num = ep_num_elem.text.strip() if ep_num_elem else ""
        ep_title = ep_title_elem.text.strip() if ep_title_elem else ""
        ep_url = ep_link_elem["href"] if ep_link_elem else ""
        ep_id = ep_url.strip("/").split("/")[-1] if ep_url else ""

        episodes.append({
            "season": season_num,
            "number": ep_num,
            "title": ep_title,
            "url": ep_url,
            "id": ep_id,
            "thumbnail": thumbnail
        })
    return episodes

async def main():
    async with AsyncSession(impersonate="chrome120") as session:
        r = await session.get("https://animesalt.ac/series/naruto/")
        soup = BeautifulSoup(r.text, "lxml")
        
        # Check for season buttons
        post_id = None
        seasons = {}
        
        season_btns = soup.select(".season-btn")
        if season_btns:
            post_id = season_btns[0].get("data-post")
            season_nums = [btn.get("data-season") for btn in season_btns]
            
            print(f"Found post_id={post_id}, seasons={season_nums}")
            
            tasks = [fetch_season_html(session, post_id, s, "https://animesalt.ac/series/naruto/") for s in season_nums]
            results = await asyncio.gather(*tasks)
            
            for season_num, html in results:
                seasons[season_num] = extract_episodes_from_html(html, season_num)
                print(f"Season {season_num} has {len(seasons[season_num])} episodes.")
                if seasons[season_num]:
                    print("Example:", seasons[season_num][0])
        else:
            print("No season buttons found.")

if __name__ == "__main__":
    asyncio.run(main())
