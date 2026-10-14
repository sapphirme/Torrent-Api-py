const axios = require('axios');
const cheerio = require('cheerio');

async function testChapterContent() {
  const chapterUrl = 'https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother';
  const res = await axios.get(chapterUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  console.log('Chapter status:', res.status);
  const $ = cheerio.load(res.data);
  const title = $('h1').text().trim();
  const chapterContent = $('.chapter-content').text().trim();
  console.log('Chapter Title:', title);
  console.log('Content preview (first 300 chars):', chapterContent.slice(0, 300));
  console.log('Content total chars:', chapterContent.length);
}

testChapterContent();
