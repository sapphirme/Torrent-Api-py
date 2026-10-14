const axios = require('axios');

async function checkRaw() {
  const res = await axios.get('https://freewebnovel.com/search?searchkey=solo', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  console.log('freewebnovel html snippet:\n', res.data.slice(0, 1000));
}

checkRaw();
