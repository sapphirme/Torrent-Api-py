const axios = require('axios');
const cheerio = require('cheerio');

async function testWebnovels() {
  const sites = [
    'https://freewebnovel.com',
    'https://boxnovel.com',
    'https://novelfull.com',
    'https://lightnovelpub.com',
    'https://novelupdates.com',
    'https://wuxiaworld.eu'
  ];

  for (const s of sites) {
    try {
      const res = await axios.get(s, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 5000,
        validateStatus: () => true
      });
      console.log(s, 'Status:', res.status);
    } catch (e) {
      console.log(s, 'Error:', e.message);
    }
  }
}

testWebnovels();
