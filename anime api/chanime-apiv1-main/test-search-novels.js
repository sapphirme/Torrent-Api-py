const axios = require('axios');
const cheerio = require('cheerio');

async function testSearch(q) {
  const url = `https://www.royalroad.com/fictions/search?title=${encodeURIComponent(q)}`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(res.data);
  const results = [];
  $('.fiction-list-item').each((_, el) => {
    const title = $(el).find('.fiction-title a').text().trim();
    const href = $(el).find('.fiction-title a').attr('href');
    const image = $(el).find('img').attr('src');
    const author = $(el).find('.author a').text().trim();
    const description = $(el).find('.fiction-description').text().trim();
    const stats = $(el).find('.stats').text().trim().replace(/\s+/g, ' ');
    if (title && href) {
      const id = href.replace(/^\/fiction\//, '');
      results.push({ id, title, href, image, author, description, stats });
    }
  });
  console.log(`Search "${q}": found ${results.length} items. Sample:`, results.slice(0, 2));
}

async function run() {
  await testSearch('Shadow Slave');
  await testSearch('The Beginning After The End');
  await testSearch('Solo');
  await testSearch('Overlord');
}

run();
