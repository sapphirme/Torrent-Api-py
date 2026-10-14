const axios = require('axios');
const cheerio = require('cheerio');

async function testKeyword() {
  const postRes = await axios.post('https://freewebnovel.com/search', 'searchkey=solo&keyword=solo', {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  console.log('POST status:', postRes.status);
  const $p = cheerio.load(postRes.data);
  const results = [];
  $p('h3.tit a, .tit a, a.tit, .novel-item a, .ul-list1 a').each((_, el) => {
    const title = $p(el).text().trim() || $p(el).attr('title')?.trim();
    const href = $p(el).attr('href');
    if (title && href && href.includes('.html')) results.push({ title, href });
  });
  console.log('Results with keyword:', results);
}

testKeyword();
