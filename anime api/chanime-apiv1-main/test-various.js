const axios = require('axios');
const cheerio = require('cheerio');

async function testVariousNovelSites() {
  const sites = [
    { name: 'ScribbleHub', url: 'https://www.scribblehub.com/?s=solo&post_type=fictionposts' },
    { name: 'NovelHall', url: 'https://novelhall.com/index.php?s=so&keyword=solo' },
    { name: 'BestLightNovel', url: 'https://bestlightnovel.com/search_novels/solo' },
    { name: 'ReadNovelFull', url: 'https://readnovelfull.com/search?keyword=solo' },
    { name: 'WuxiaWorldEU', url: 'https://wuxiaworld.eu/search?q=solo' }
  ];

  for (const s of sites) {
    try {
      const res = await axios.get(s.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 6000,
        validateStatus: () => true
      });
      console.log(`[${s.name}] Status: ${res.status}, Length: ${typeof res.data === 'string' ? res.data.length : 0}`);
      if (res.status === 200) {
        const $ = cheerio.load(res.data);
        const links = [];
        $('a').each((_, el) => {
          const t = $(el).text().trim();
          const h = $(el).attr('href');
          if (t.toLowerCase().includes('solo') && h) links.push({ t, h });
        });
        console.log(`  -> Found ${links.length} matching links:`, links.slice(0, 2));
      }
    } catch (e) {
      console.log(`[${s.name}] Error:`, e.message);
    }
  }
}

testVariousNovelSites();
