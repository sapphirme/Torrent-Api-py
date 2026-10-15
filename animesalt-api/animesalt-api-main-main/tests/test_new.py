import requests

def test():
    # Test movie
    r = requests.get("http://127.0.0.1:5000/api/anime/shinchan-movie-the-spicy-kasukabe-dancers")
    print("Movie Response:")
    if r.status_code == 200:
        data = r.json()
        print("Movie Title:", data['data'].get('title'))
        print("Is Movie:", data['data'].get('is_movie'))
        print("Movie Players:", data['data'].get('movie_players'))
    else:
        print("Failed", r.text)

    # Test multi-season series
    r = requests.get("http://127.0.0.1:5000/api/anime/naruto")
    print("\nSeries Response:")
    if r.status_code == 200:
        data = r.json()
        print("Series Title:", data['data'].get('title'))
        episodes = data['data'].get('episodes', [])
        print("Total Episodes Scraped:", len(episodes))
        if episodes:
            print("First Episode:", episodes[0])
            print("Last Episode:", episodes[-1])
    else:
        print("Failed", r.text)

test()
