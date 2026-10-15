import requests
import time
import json

BASE_URL = "http://127.0.0.1:5000"

def test_api():
    print(f"Testing API at {BASE_URL}...")
    
    # Wait a bit for the server to be fully ready
    time.sleep(2)
    
    try:
        # Test Home
        print("\n1. Testing /api/home")
        r = requests.get(f"{BASE_URL}/api/home")
        r.raise_for_status()
        data = r.json()
        print(f"Status: {r.status_code}")
        print(f"Success: {data.get('success')}")
        sections = list(data.get('data', {}).keys())
        print(f"Sections found: {sections[:3]}...")
        
        # Test Search
        print("\n2. Testing /api/search?q=naruto")
        r = requests.get(f"{BASE_URL}/api/search?q=naruto")
        r.raise_for_status()
        data = r.json()
        print(f"Status: {r.status_code}")
        print(f"Success: {data.get('success')}")
        results = data.get('results', [])
        print(f"Items found: {len(results)}")
        if results:
            print(f"First result: {results[0].get('title')} ({results[0].get('slug')})")
            
        # Test Details
        slug = "naruto-shippuden"
        if results:
            slug = results[0].get('slug', slug)
        print(f"\n3. Testing /api/anime/{slug}")
        r = requests.get(f"{BASE_URL}/api/anime/{slug}")
        r.raise_for_status()
        data = r.json()
        print(f"Status: {r.status_code}")
        print(f"Success: {data.get('success')}")
        anime_data = data.get('data', {})
        print(f"Title: {anime_data.get('title')}")
        print(f"Episodes count: {len(anime_data.get('episodes', []))}")
        
        # Test Episode
        episode_id = "naruto-shippuden-1x1"
        if anime_data.get('episodes'):
            episode_id = anime_data['episodes'][0].get('id', episode_id)
            
        print(f"\n4. Testing /api/episode/{episode_id}")
        r = requests.get(f"{BASE_URL}/api/episode/{episode_id}")
        r.raise_for_status()
        data = r.json()
        print(f"Status: {r.status_code}")
        print(f"Success: {data.get('success')}")
        ep_data = data.get('data', {})
        print(f"Video Player: {ep_data.get('video_player')}")
        
        print("\n✅ All tests passed successfully!")
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")

if __name__ == "__main__":
    test_api()