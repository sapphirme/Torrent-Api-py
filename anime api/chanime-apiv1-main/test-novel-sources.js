const axios = require('axios');
const cheerio = require('cheerio');

async function testNovelSources() {
  const query = 'solo-leveling';
  console.log('Testing novel sources...');

  // 1. NovelBin
  try {
    const res = await axios.get(`https://novelbin.me/search?keyword=${encodeURIComponent('solo leveling')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 8000
    });
    console.log('NovelBin search status:', res.status);
    const $ = cheerio.load(res.data);
    const list = [];
    $('.list-novel .row').each((_, el) => {
      const title = $(el).find('.novel-title a').text().trim();
      const href = $(el).find('.novel-title a').attr('href');
      if (title && href) list.push({ title, href });
    });
    console.log('NovelBin results:', list.slice(0, 3));
  } catch (e) {
    console.log('NovelBin error:', e.message);
  }

  // 2. Ranobes
  try {
    const res = await axios.get(`https://ranobes.top/index.php?do=search&subaction=search&story=${encodeURIComponent('solo leveling')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 8000
    });
    console.log('Ranobes search status:', res.status);
    const $ = cheerio.load(res.data);
    const list = [];
    $('.short-cont').each((_, el) => {
      const title = $(el).find('.title a').text().trim();
      const href = $(el).find('.title a').attr('href');
      if (title && href) list.push({ title, href });
    });
    console.log('Ranobes results:', list.slice(0, 3));
  } catch (e) {
    console.log('Ranobes error:', e.message);
  }

  // 3. AniList for metadata
  try {
    const q = `query ($search: String) {
      Page(page: 1, perPage: 5) {
        media(search: $search, type: MANGA, format_in: [NOVEL]) {
          id
          title { romaji english }
          description
          coverImage { large }
          genres
          chapters
          status
        }
      }
    }`;
    const res = await axios.post('https://graphql.anilist.co', { query: q, variables: { search: 'solo leveling' } });
    console.log('AniList novel data:', res.data.data.Page.media.map(m => ({ id: m.id, title: m.title.english || m.title.romaji, chapters: m.chapters })));
  } catch (e) {
    console.log('AniList error:', e.message);
  }
}

testNovelSources();
