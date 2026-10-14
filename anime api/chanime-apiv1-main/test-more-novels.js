const axios = require('axios');
const cheerio = require('cheerio');

async function testMore() {
  // AniList query
  try {
    const q = `query ($search: String) {
      Page(page: 1, perPage: 5) {
        media(search: $search, type: MANGA) {
          id
          title { romaji english native }
          description(asHtml: false)
          coverImage { extraLarge large medium color }
          bannerImage
          format
          status
          chapters
          volumes
          genres
          averageScore
          synonyms
          staff { edges { node { name { full } } role } }
        }
      }
    }`;
    const res = await axios.post('https://graphql.anilist.co', { query: q, variables: { search: 'Solo Leveling' } });
    console.log('AniList manga/novel result:', res.data.data.Page.media.map(m => ({
      id: m.id,
      title: m.title,
      format: m.format,
      chapters: m.chapters,
      genres: m.genres
    })));
  } catch (e) {
    console.log('AniList error:', e.message);
  }

  // Let's test BoxNovel / NovelFull / AllNovel / RoyalRoad
  const domains = [
    'https://www.royalroad.com/fictions/search?title=solo',
    'https://allnovelupdates.com/?s=solo',
    'https://novelfull.com/search?keyword=solo',
    'https://freewebnovel.com/search?keyword=solo',
    'https://readlightnovels.net/?s=solo'
  ];

  for (const d of domains) {
    try {
      const res = await axios.get(d, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
        timeout: 6000,
        validateStatus: () => true
      });
      console.log(d, 'Status:', res.status, 'Len:', typeof res.data === 'string' ? res.data.length : 0);
    } catch (e) {
      console.log(d, 'Error:', e.message);
    }
  }
}

testMore();
