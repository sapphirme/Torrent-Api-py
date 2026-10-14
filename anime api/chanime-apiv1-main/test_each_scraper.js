const axios = require('axios');

// 1. Test Anikoto (anikoto.net)
async function testAnikoto() {
  console.log('\n--- 1. Anikoto (anikoto.net) ---');
  try {
    const res = await axios.get('https://anikoto.net/filter?keyword=solo+leveling', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('Anikoto search status:', res.status, 'HTML len:', res.data.length);
  } catch(e) {
    console.log('Anikoto search error:', e.message);
  }
}

// 2. Test LunarX (lunarx.to)
async function testLunarX() {
  console.log('\n--- 2. LunarX (lunarx.to) ---');
  try {
    const res = await axios.get('https://lunarx.to/filter?keyword=solo+leveling', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('LunarX search status:', res.status, 'HTML len:', res.data.length);
  } catch(e) {
    console.log('LunarX search error:', e.message);
  }
}

// 3. Test AnimeSalt (animesalt.cx)
async function testAnimeSalt() {
  console.log('\n--- 3. AnimeSalt (animesalt.cx) ---');
  try {
    const res = await axios.get('https://animesalt.cx/filter?keyword=solo+leveling', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('AnimeSalt search status:', res.status, 'HTML len:', res.data.length);
  } catch(e) {
    console.log('AnimeSalt search error:', e.message);
  }
}

// 4. Test AniDao (anidao.to)
async function testAniDao() {
  console.log('\n--- 4. AniDao (anidao.to) ---');
  try {
    const res = await axios.get('https://anidao.to/filter?keyword=solo+leveling', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('AniDao search status:', res.status, 'HTML len:', res.data.length);
  } catch(e) {
    console.log('AniDao search error:', e.message);
  }
}

// 5. Test Otakuvid (otakuvid.online)
async function testOtakuvid() {
  console.log('\n--- 5. Otakuvid (otakuvid.online) ---');
  try {
    const res = await axios.get('https://otakuvid.online/filter?keyword=solo+leveling', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('Otakuvid search status:', res.status, 'HTML len:', res.data.length);
  } catch(e) {
    console.log('Otakuvid search error:', e.message);
  }
}

// 6. Test Yumezone (yumezone.live)
async function testYumezone() {
  console.log('\n--- 6. Yumezone (yumezone.live) ---');
  try {
    const res = await axios.get('https://yumezone.live/filter?keyword=solo+leveling', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('Yumezone search status:', res.status, 'HTML len:', res.data.length);
  } catch(e) {
    console.log('Yumezone search error:', e.message);
  }
}

// 7. Test Senshi (senshi.live)
async function testSenshi() {
  console.log('\n--- 7. Senshi (senshi.live) ---');
  try {
    const res = await axios.get('https://senshi.live/filter?keyword=solo+leveling', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('Senshi search status:', res.status, 'HTML len:', res.data.length);
  } catch(e) {
    console.log('Senshi search error:', e.message);
  }
}

// 8. Test AnimeHeaven (animeheaven.me)
async function testAnimeHeaven() {
  console.log('\n--- 8. AnimeHeaven (animeheaven.me) ---');
  try {
    const res = await axios.get('https://animeheaven.me/search.php?s=solo+leveling', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('AnimeHeaven search status:', res.status, 'HTML len:', res.data.length);
  } catch(e) {
    console.log('AnimeHeaven search error:', e.message);
  }
}

async function runAll() {
  await testAnikoto();
  await testLunarX();
  await testAnimeSalt();
  await testAniDao();
  await testOtakuvid();
  await testYumezone();
  await testSenshi();
  await testAnimeHeaven();
}

runAll();
