const axios = require('axios');
const cheerio = require('cheerio');

async function testFull() {
  const query = 'solo leveling';
  
  // Test novelfull.com search
  try {
    const res = await axios.get(`https://novelfull.com/search?keyword=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });
    console.log('NovelFull search status:', res.status);
    const $ = cheerio.load(res.data);
    const items = [];
    $('.list-novel .row').each((_, el) => {
      const title = $(el).find('.novel-title a').text().trim();
      const href = $(el).find('.novel-title a').attr('href');
      const img = $(el).find('img').attr('src');
      if (title && href) items.push({ title, href, img });
    });
    console.log('NovelFull search results:', items.slice(0, 3));

    if (items.length > 0) {
      const novelUrl = 'https://novelfull.com' + items[0].href;
      const nRes = await axios.get(novelUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      console.log('Novel info status:', nRes.status);
      const $n = cheerio.load(nRes.data);
      const desc = $n('.desc-text').text().trim();
      console.log('Desc preview:', desc.slice(0, 150));
      
      // Look for chapters
      const chId = $n('#rating').attr('data-novel-id') || $n('input#novel_id').val() || $n('div[data-novel-id]').attr('data-novel-id');
      console.log('Novel ID for ajax chapters:', chId);

      // Try ajax chapter list on novelfull
      if (chId) {
        const ajaxRes = await axios.get(`https://novelfull.com/ajax/chapter-archive?novelId=${chId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ch = cheerio.load(ajaxRes.data);
        const chList = [];
        $ch('a').each((_, el) => {
          const chTitle = $ch(el).text().trim();
          const chHref = $ch(el).attr('href');
          if (chTitle && chHref) chList.push({ title: chTitle, href: chHref });
        });
        console.log('Total chapters found:', chList.length, 'Sample:', chList.slice(0, 3));

        if (chList.length > 0) {
          const sampleChUrl = 'https://novelfull.com' + chList[0].href;
          const chRes = await axios.get(sampleChUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          const $c = cheerio.load(chRes.data);
          const text = $c('#chapter-content').text().trim();
          console.log('Chapter 1 content text length:', text.length, 'Snippet:', text.slice(0, 200));
        }
      }
    }
  } catch (e) {
    console.log('NovelFull error:', e.message);
  }
}

testFull();
