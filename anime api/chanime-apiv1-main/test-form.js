const axios = require('axios');
const cheerio = require('cheerio');

async function inspectForm() {
  const res = await axios.get('https://freewebnovel.com/search', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(res.data);
  console.log('Search form:', $('form').attr('action'), $('form').attr('method'));
  $('form input').each((_, el) => console.log('input name:', $(el).attr('name'), $(el).attr('value')));

  // Let's test POST search
  try {
    const postRes = await axios.post('https://freewebnovel.com/search', 'searchkey=solo', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    console.log('POST status:', postRes.status);
    const $p = cheerio.load(postRes.data);
    const results = [];
    $p('.li-row').each((_, el) => {
      const title = $p(el).find('.tit a').text().trim();
      const href = $p(el).find('.tit a').attr('href');
      const img = $p(el).find('img').attr('src');
      if (title && href) results.push({ title, href, img });
    });
    console.log('POST search results:', results.slice(0, 5));
  } catch (e) {
    console.log('POST error:', e.message);
  }
}

inspectForm();
