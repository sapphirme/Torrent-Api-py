from torrents.torrentfunk import TorrentFunk
from torrents.subplease import SubPlease

all_sites = {
    "torrentfunk": {
        "website": TorrentFunk,
        "trending_available": True,
        "trending_category": True,
        "search_by_category": False,
        "recent_available": True,
        "recent_category_available": True,
        "categories": [
            "movies",
            "music",
            "television",
            "games",
            "software",
            "anime",
            "adult",
            "eBooks",
        ],
        "limit": 100,
    },
    "subplease": {
        "website": SubPlease,
        "trending_available": False,
        "trending_category": False,
        "search_by_category": False,
        "recent_available": True,
        "recent_category_available": True,
        "categories": ["anime"],
        "limit": 50,
    },
}

sites_config = {
    key: {
        **site_info,
        "website": site_info["website"]._name,
    }
    for key, site_info in all_sites.items()
}


def check_if_site_available(site):
    if site in all_sites.keys():
        return all_sites
    return False
