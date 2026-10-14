const axios = require('axios');
const cheerio = require('cheerio');

async function testNovelHall() {
  const query = 'solo-leveling';
  try {
    const res = await axios.get(`https://novelhall.com/index.php?s=so&keyword=${encodeURIComponent('solo')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });
    console.log('NovelHall search status:', res.status);
    const $ = cheerio.load(res.data);
    const items = [];
    $('.section-item, tr, .entry-content li, tbody tr').each((_, el) => {
      const a = $(el).find('a').first();
      const title = a.text().trim();
      const href = a.attr('href');
      if (title && href && href.startsWith('/')) {
        items.push({ title, href });
      }
    });
    console.log('NovelHall items:', items.slice(0, 5));

    // Test novel page
    if (items.length > 0) {
      const novelUrl = 'https://novelhall.com' + items[0].href;
      console.log('Fetching novel page:', novelUrl);
      const nRes = await axios.get(novelUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      console.log('Novel page status:', nRes.status);
      const $n = cheerio.load(nRes.data);
      const title = $n('h1').text().trim();
      const intro = $n('.intro, .js-synopsis, .novel-detail').text().trim();
      const img = $n('.book-img img, .detail-thumb img').attr('src');
      console.log('Title:', title, 'Image:', img, 'Intro preview:', intro.slice(0, 100));

      const chapters = [];
      $n('a[href*=".html"]').each((_, el) => {
        const cTitle = $n(el).text().trim();
        const cHref = $n(el).attr('href');
        if (cTitle && cHref && !cHref.includes('author') && !cHref.includes('category')) {
          chapters.push({ title: cTitle, href: cHref });
        }
      });
      console.log('Total chapters on page:', chapters.length, 'Sample:', chapters.slice(0, 3));

      if (chapters.length > 0) {
        let chHref = chapters[0].href;
        if (!chHref.startsWith('http')) {
          chHref = (chHref.startsWith('/') ? 'https://novelhall.com' : novelUrl.replace(/\/$/, '') + '/') + chHref;
        }
        console.log('Fetching chapter content:', chHref);
        const cRes = await axios.get(chHref, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        console.log('Chapter status:', cRes.status);
        const $c = cheerio.load(cRes.data);
        const chContent = $c('.entry-content, .read-content, #htmlContent, .novel-content').text().trim();
        console.log('Chapter Content length:', chContent.length, 'Preview:', chContent.slice(0, 200));
      }
    }
  } catch (e) {
    console.log('NovelHall error:', e.message);
  }
}

testNovelHall();
