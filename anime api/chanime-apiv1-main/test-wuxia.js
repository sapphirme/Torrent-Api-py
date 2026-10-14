const axios = require('axios');
const cheerio = require('cheerio');

async function testWuxia() {
  const list = [
    'https://wuxiaworld.eu/novel/solo-leveling',
    'https://wuxiaworld.eu/novel/reverend-insanity',
    'https://wuxiaworld.eu/novel/lord-of-the-mysteries'
  ];

  for (const url of list) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 6000,
        validateStatus: () => true
      });
      console.log(url, 'Status:', res.status);
      if (res.status === 200) {
        const $ = cheerio.load(res.data);
        console.log('Title:', $('h1').text().trim());
        const chs = [];
        $('a[href*="/chapter-"], a[href*="/chapter/"]').each((_, el) => {
          const t = $(el).text().trim();
          const h = $(el).attr('href');
          if (t && h) chs.push({ t, h });
        });
        console.log('Chapters found on wuxiaworld.eu:', chs.length, 'Sample:', chs.slice(0, 3));
      }
    } catch (e) {
      console.log(url, 'Error:', e.message);
    }
  }
}

testWuxia();
