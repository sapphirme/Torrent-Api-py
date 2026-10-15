from bs4 import BeautifulSoup

def main():
    with open("movie.html", "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "lxml")
    
    iframes = soup.select("iframe")
    for idx, iframe in enumerate(iframes):
        print(f"iframe {idx}: src={iframe.get('src')}, data-src={iframe.get('data-src')}")
        
    title = soup.select_one("h1")
    print(title.text.strip() if title else "No Title")

if __name__ == "__main__":
    main()
