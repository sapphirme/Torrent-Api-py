const axios = require('axios');
const cheerio = require('cheerio');

async function testSites() {
  // 1. freewebnovel.com
  try {
    const res = await axios.get(`https://freewebnovel.com/search?searchkey=${encodeURIComponent('solo leveling')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });
    console.log('freewebnovel status:', res.status);
    const $ = cheerio.load(res.data);
    const items = [];
    $('.li-row, .col-novel, .ul-list1 li, .item, .novel-item').each((_, el) => {
      const title = $(el).find('h3 a, .title a, a.tit').text().trim();
      const href = $(el).find('h3 a, .title a, a.tit').attr('href');
      if (title && href) items.push({ title, href });
    });
    console.log('freewebnovel items:', items);
  } catch (e) {
    console.log('freewebnovel error:', e.message);
  }

  // 2. lightnovelpub.com
  try {
    const res = await axios.get(`https://lightnovelpub.com/search?keyword=${encodeURIComponent('solo leveling')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });
    console.log('lightnovelpub status:', res.status);
    const $ = cheerio.load(res.data);
    const items = [];
    $('.novel-item, .item').each((_, el) => {
      const title = $(el).find('.novel-title a, h3 a').text().trim();
      const href = $(el).find('.novel-title a, h3 a').attr('href');
      if (title && href) items.push({ title, href });
    });
    console.log('lightnovelpub items:', items);
  } catch (e) {
    console.log('lightnovelpub error:', e.message);
  }
}

testSites();
