from bs4 import BeautifulSoup

def parse_home():
    with open("home.html", "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "lxml")
        
    print("=== Home ===")
    # Find possible sections
    sections = soup.select("section, div.module, div.sect")
    for s in sections:
        h2 = s.select_one("h2, h3, .title, .heading")
        if h2:
            print("Section:", h2.text.strip())
            items = s.select("article, .item, .post")
            if items:
                print("  Items count:", len(items))
                item = items[0]
                title = item.select_one("h2, h3, .title")
                a = item.select_one("a")
                img = item.select_one("img")
                print("  Example Item:")
                print("    Title:", title.text.strip() if title else "N/A")
                print("    Link:", a["href"] if a else "N/A")
                print("    Image:", img["src"] if img else "N/A")
                print()

def parse_search():
    with open("search.html", "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "lxml")
        
    print("=== Search ===")
    items = soup.select("article, .item, .post, .result-item")
    if items:
        print("Items count:", len(items))
        item = items[0]
        title = item.select_one("h2, h3, .title")
        a = item.select_one("a")
        img = item.select_one("img")
        print("Example Search Item:")
        print("  Title:", title.text.strip() if title else "N/A")
        print("  Link:", a["href"] if a else "N/A")
        print("  Image:", img["src"] if img else "N/A")

def parse_details():
    with open("details.html", "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "lxml")
        
    print("=== Details ===")
    title = soup.select_one("h1")
    desc = soup.select_one(".description, .synopsis, .info p")
    genres = soup.select(".genre a, .genres a")
    episodes = soup.select(".episodes a, .episode-list a, ul.episodes li a")
    img = soup.select_one(".poster img, .thumbnail img")
    
    print("Title:", title.text.strip() if title else "N/A")
    print("Desc:", desc.text.strip()[:100] if desc else "N/A")
    print("Genres:", [g.text.strip() for g in genres])
    print("Episodes count:", len(episodes))
    if episodes:
        print("First episode:", episodes[0]["href"])

def parse_episode():
    with open("episode.html", "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "lxml")
        
    print("=== Episode ===")
    iframe = soup.select_one("iframe")
    video = soup.select_one("video")
    if iframe:
        print("Iframe:", iframe["src"])
    if video:
        print("Video:", video.get("src", "has source tags"))
        
parse_home()
parse_search()
parse_details()
parse_episode()
