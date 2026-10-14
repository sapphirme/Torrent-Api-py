const axios = require('axios');
const cheerio = require('cheerio');

async function testNovelScraping() {
  const sources = [
    'https://www.royalroad.com/fiction/21220/mother-of-learning',
    'https://allnovelupdates.com/novel/solo-leveling',
    'https://wuxiaworld.site/novel/solo-leveling-free/'
  ];

  for (const s of sources) {
    try {
      const res = await axios.get(s, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 6000,
        validateStatus: () => true
      });
      console.log(s, 'Status:', res.status);
      if (res.status === 200) {
        const $ = cheerio.load(res.data);
        console.log('Title:', $('h1').text().trim() || $('title').text().trim());
        // Find chapters
        const chs = [];
        $('a[href*="chapter"]').each((_, el) => {
          const href = $(el).attr('href');
          const t = $(el).text().trim();
          if (href && t && !chs.some(c => c.href === href)) chs.push({ href, t });
        });
        console.log('Found chapters count:', chs.length, 'Sample:', chs.slice(0, 3));
      }
    } catch (e) {
      console.log(s, 'Error:', e.message);
    }
  }
}

testNovelScraping();
