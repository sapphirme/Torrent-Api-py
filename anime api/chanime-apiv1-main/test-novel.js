const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  try {
    const res = await axios.get('https://lunarx.to', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      validateStatus: () => true
    });
    console.log('Homepage status:', res.status);
    if (res.status === 200) {
      const $ = cheerio.load(res.data);
      console.log('Links on homepage:');
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        console.log(href, '->', text);
      });
      // Look for novel keywords in text or scripts
      const html = res.data;
      const matches = html.match(/novel[a-zA-Z0-9_\-\/]*/gi) || [];
      console.log('Novel matches:', Array.from(new Set(matches)));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
