import { searchAniDao, getDaoEpisodes, getDaoServers, getDaoEmbedUrl } from './scrapers/anidao';
import { searchAnikoto, findAnikotoSlug, getAnikotoEpisodes, getAnikotoServers, getAnikotoEmbedUrl } from './scrapers/anikoto';
import { searchAnimeHeaven, findAnimeHeavenId, getHeavenEpisodes, getHeavenServers, getHeavenStream } from './scrapers/animeheaven';
import { searchAnimePahe, findAnimePaheSlug, getAnimePaheEpisodes, getAnimePaheServers, getAnimePaheStream } from './scrapers/animepahe';
import { searchAniWaves, getWaveEpisodes, getWaveServers, getWaveEmbedUrl } from './scrapers/aniwaves';
import { getMiruroEpisodes, getMiruroServers, getMiruroEmbedUrl } from './scrapers/miruro';
import { searchReAnime, getReAnimeEpisodes, getReAnimeServers, getReAnimeEmbedUrl, reAnimeHealthCheck } from './scrapers/reanime';
import { searchSenshi, getEpisodes as getSenshiEpisodes, getServers as getSenshiServers, getEmbedUrl as getSenshiEmbedUrl } from './scrapers/senshi';
import { searchOtakuvid, getOtakuvidEpisodes, getOtakuvidServers, getOtakuvidStream } from './scrapers/otakuvid';

interface TestResult {
  scraper: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  steps: {
    step: string;
    success: boolean;
    details?: string;
    error?: string;
    itemCount?: number;
  }[];
}

async function testAniDao(): Promise<TestResult> {
  const result: TestResult = { scraper: 'AniDao (anidao.to)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing AniDao ---');
    const search = await searchAniDao('Naruto');
    result.steps.push({
      step: 'Search ("Naruto")',
      success: search.length > 0,
      itemCount: search.length,
      details: search.length > 0 ? `Found "${search[0].title}" (ID: ${search[0].id})` : 'No results found',
    });

    if (search.length > 0) {
      const animeId = search[0].id;
      const episodes = await getDaoEpisodes(animeId);
      result.steps.push({
        step: 'Episodes',
        success: episodes.length > 0,
        itemCount: episodes.length,
        details: episodes.length > 0 ? `Found ${episodes.length} episodes (e.g. Ep ${episodes[0].num})` : 'No episodes found',
      });

      if (episodes.length > 0) {
        const epId = episodes[0].id;
        const servers = await getDaoServers(epId);
        result.steps.push({
          step: 'Servers',
          success: servers.length > 0,
          itemCount: servers.length,
          details: servers.length > 0 ? `Found ${servers.length} servers (${servers.map(s => s.name).join(', ')})` : 'No servers found',
        });

        if (servers.length > 0) {
          const embed = await getDaoEmbedUrl(servers[0].sourceId);
          result.steps.push({
            step: 'Embed URL',
            success: !!embed?.embedUrl,
            details: embed ? `Server: ${embed.serverName} -> ${embed.embedUrl.substring(0, 60)}...` : 'Failed to extract embed URL',
          });
        }
      }
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 3 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function testAnikoto(): Promise<TestResult> {
  const result: TestResult = { scraper: 'Anikoto (anikoto.net)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing Anikoto ---');
    const search = await searchAnikoto('Naruto Shippuden');
    result.steps.push({
      step: 'Search ("Naruto Shippuden")',
      success: search.length > 0,
      itemCount: search.length,
      details: search.length > 0 ? `Found "${search[0].title}" (Slug: ${search[0].slug})` : 'No search results',
    });

    const slug = await findAnikotoSlug('Naruto Shippuden') || (search.length > 0 ? search[0].slug : null);
    result.steps.push({
      step: 'Slug Lookup',
      success: !!slug,
      details: slug ? `Slug: ${slug}` : 'Failed to resolve slug',
    });

    if (slug) {
      const episodes = await getAnikotoEpisodes(slug);
      result.steps.push({
        step: 'Episodes',
        success: episodes.length > 0,
        itemCount: episodes.length,
        details: episodes.length > 0 ? `Found ${episodes.length} episodes` : 'No episodes found',
      });

      if (episodes.length > 0) {
        const epId = episodes[0].id;
        const servers = await getAnikotoServers(epId);
        result.steps.push({
          step: 'Servers',
          success: servers.length > 0,
          itemCount: servers.length,
          details: servers.length > 0 ? `Found ${servers.length} servers` : 'No servers found',
        });

        if (servers.length > 0) {
          const embed = await getAnikotoEmbedUrl(servers[0].sourceId);
          result.steps.push({
            step: 'Embed URL',
            success: !!embed?.m3u8 || !!embed?.embedUrl,
            details: embed ? `Type: ${embed.type}, URL: ${(embed.m3u8 || embed.embedUrl || '').substring(0, 60)}...` : 'Failed to resolve embed',
          });
        }
      }
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 3 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function testAnimeHeaven(): Promise<TestResult> {
  const result: TestResult = { scraper: 'AnimeHeaven (animeheaven.me)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing AnimeHeaven ---');
    const search = await searchAnimeHeaven('Naruto');
    result.steps.push({
      step: 'Search ("Naruto")',
      success: search.length > 0,
      itemCount: search.length,
      details: search.length > 0 ? `Found "${search[0].title}" (ID: ${search[0].id})` : 'No search results',
    });

    const animeId = search.length > 0 ? search[0].id : await findAnimeHeavenId('Naruto');
    if (animeId) {
      const episodes = await getHeavenEpisodes(animeId);
      result.steps.push({
        step: 'Episodes',
        success: episodes.length > 0,
        itemCount: episodes.length,
        details: episodes.length > 0 ? `Found ${episodes.length} episodes` : 'No episodes found',
      });

      if (episodes.length > 0) {
        const epId = episodes[0].id;
        const servers = await getHeavenServers(epId);
        result.steps.push({
          step: 'Servers',
          success: servers.length > 0,
          itemCount: servers.length,
          details: servers.length > 0 ? `Found ${servers.length} servers` : 'No servers found',
        });

        const stream = await getHeavenStream(epId);
        result.steps.push({
          step: 'Direct Stream',
          success: !!stream?.streamUrl,
          details: stream?.streamUrl ? `Stream URL: ${stream.streamUrl.substring(0, 60)}...` : 'No direct stream extracted',
        });
      }
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 3 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function testAnimePahe(): Promise<TestResult> {
  const result: TestResult = { scraper: 'AnimePahe (animepahe.ch)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing AnimePahe ---');
    const search = await searchAnimePahe('One Piece');
    result.steps.push({
      step: 'Search ("One Piece")',
      success: search.length > 0,
      itemCount: search.length,
      details: search.length > 0 ? `Found "${search[0].title}" (Slug: ${search[0].slug})` : 'No search results',
    });

    if (search.length > 0) {
      const match = await findAnimePaheSlug('One Piece');
      const seriesSlug = match?.slug || search[0].slug;
      const episodes = await getAnimePaheEpisodes(seriesSlug);
      result.steps.push({
        step: 'Episodes',
        success: episodes.length > 0,
        itemCount: episodes.length,
        details: episodes.length > 0 ? `Found ${episodes.length} episodes (First: ${episodes[0].id})` : 'No episodes found',
      });

      if (episodes.length > 0) {
        const ep = episodes[0];
        const servers = await getAnimePaheServers(ep.id);
        result.steps.push({
          step: 'Servers',
          success: servers.length > 0,
          itemCount: servers.length,
          details: servers.length > 0 ? `Found ${servers.length} servers (${servers.map(s => s.name).join(', ')})` : 'No servers found',
        });

        if (servers.length > 0) {
          const stream = await getAnimePaheStream(servers[0].sourceId);
          result.steps.push({
            step: 'Stream Extraction',
            success: !!stream && (!!stream.streamUrl || !!stream.embedUrl),
            details: stream ? `Resolved stream: ${stream.streamUrl || stream.embedUrl} (${stream.type})` : 'No stream extracted',
          });
        }
      }
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 3 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function testAniWaves(): Promise<TestResult> {
  const result: TestResult = { scraper: 'AniWaves (aniwaves.ru)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing AniWaves ---');
    const search = await searchAniWaves('Naruto');
    result.steps.push({
      step: 'Search ("Naruto")',
      success: search.length > 0,
      itemCount: search.length,
      details: search.length > 0 ? `Found "${search[0].title}" (ID: ${search[0].id})` : 'No search results',
    });

    if (search.length > 0) {
      const animeId = search[0].id;
      const episodes = await getWaveEpisodes(animeId);
      result.steps.push({
        step: 'Episodes',
        success: episodes.length > 0,
        itemCount: episodes.length,
        details: episodes.length > 0 ? `Found ${episodes.length} episodes` : 'No episodes found',
      });

      if (episodes.length > 0) {
        const epId = episodes[0].id;
        const servers = await getWaveServers(epId);
        result.steps.push({
          step: 'Servers',
          success: servers.length > 0,
          itemCount: servers.length,
          details: servers.length > 0 ? `Found ${servers.length} servers` : 'No servers found',
        });

        if (servers.length > 0) {
          const embed = await getWaveEmbedUrl(servers[0].sourceId);
          result.steps.push({
            step: 'Embed URL',
            success: !!embed?.embedUrl,
            details: embed ? `Server: ${embed.serverName} -> ${embed.embedUrl.substring(0, 60)}...` : 'No embed URL',
          });
        }
      }
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 3 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function testMiruro(): Promise<TestResult> {
  const result: TestResult = { scraper: 'Miruro (miruro.tv API pipe)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing Miruro ---');
    // AniList ID 20 = Naruto, 21 = One Piece
    const episodes = await getMiruroEpisodes(20);
    result.steps.push({
      step: 'Episodes (AniList ID 20)',
      success: episodes.length > 0,
      itemCount: episodes.length,
      details: episodes.length > 0 ? `Found ${episodes.length} episodes` : 'No episodes found',
    });

    if (episodes.length > 0) {
      const epId = episodes[0].id;
      const servers = await getMiruroServers(epId);
      result.steps.push({
        step: 'Servers',
        success: servers.length > 0,
        itemCount: servers.length,
        details: servers.length > 0 ? `Found ${servers.length} servers (${servers.slice(0, 3).map(s => s.name).join(', ')})` : 'No servers found',
      });

      if (servers.length > 0) {
        const embed: any = await getMiruroEmbedUrl(servers[0].sourceId);
        result.steps.push({
          step: 'Embed URL',
          success: !!embed && (!!embed.url || embed.sources?.length > 0 || embed.embedUrl),
          details: embed ? `URL: ${(embed.url || embed.embedUrl || '').substring(0, 60)}...` : 'Failed to get embed result',
        });
      }
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 2 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function testReAnime(): Promise<TestResult> {
  const result: TestResult = { scraper: 'ReAnime (FastAPI Sidecar)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing ReAnime ---');
    const health = await reAnimeHealthCheck();
    result.steps.push({
      step: 'Health Check',
      success: health.ok,
      details: health.ok ? `Connected to ${health.url}` : `Server down/unreachable at ${health.url}`,
    });

    if (health.ok) {
      const search = await searchReAnime('Naruto');
      result.steps.push({
        step: 'Search ("Naruto")',
        success: search.length > 0,
        itemCount: search.length,
        details: search.length > 0 ? `Found "${search[0].title}" (Slug: ${search[0].slug})` : 'No results',
      });
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 2 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function testSenshi(): Promise<TestResult> {
  const result: TestResult = { scraper: 'Senshi (senshi.live)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing Senshi ---');
    const search = await searchSenshi('Naruto');
    result.steps.push({
      step: 'Search ("Naruto")',
      success: search.length > 0,
      itemCount: search.length,
      details: search.length > 0 ? `Found "${search[0].title}" (ID: ${search[0].id})` : 'No search results',
    });

    if (search.length > 0) {
      const animeId = search[0].id;
      const episodes = await getSenshiEpisodes(animeId);
      result.steps.push({
        step: 'Episodes',
        success: episodes.length > 0,
        itemCount: episodes.length,
        details: episodes.length > 0 ? `Found ${episodes.length} episodes` : 'No episodes found',
      });

      if (episodes.length > 0) {
        const epId = episodes[0].id;
        const servers = await getSenshiServers(epId);
        result.steps.push({
          step: 'Servers',
          success: servers.length > 0,
          itemCount: servers.length,
          details: servers.length > 0 ? `Found ${servers.length} servers` : 'No servers found',
        });

        if (servers.length > 0) {
          const embed = await getSenshiEmbedUrl(servers[0].sourceId);
          result.steps.push({
            step: 'Embed URL',
            success: !!embed?.embedUrl,
            details: embed ? `Server: ${embed.serverName} -> ${embed.embedUrl.substring(0, 60)}...` : 'Failed to extract embed URL',
          });
        }
      }
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 3 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function testOtakuvid(): Promise<TestResult> {
  const result: TestResult = { scraper: 'Otakuvid (otakuvid.online)', status: 'FAILED', steps: [] };
  try {
    console.log('\n--- Testing Otakuvid ---');
    const search = await searchOtakuvid('Naruto');
    result.steps.push({
      step: 'Search ("Naruto")',
      success: search.length > 0,
      itemCount: search.length,
      details: search.length > 0 ? `Found "${search[0].title}" (ID: ${search[0].id})` : 'No search results',
    });

    if (search.length > 0) {
      const animeId = search[0].id;
      const episodes = await getOtakuvidEpisodes(animeId);
      result.steps.push({
        step: 'Episodes',
        success: episodes.length > 0,
        itemCount: episodes.length,
        details: episodes.length > 0 ? `Found ${episodes.length} episodes` : 'No episodes found',
      });

      if (episodes.length > 0) {
        const epId = episodes[0].id;
        const servers = await getOtakuvidServers(epId);
        result.steps.push({
          step: 'Servers',
          success: servers.length > 0,
          itemCount: servers.length,
          details: servers.length > 0 ? `Found ${servers.length} servers` : 'No servers found',
        });

        if (servers.length > 0) {
          const stream = await getOtakuvidStream(servers[0].sourceId);
          result.steps.push({
            step: 'Direct Download Links',
            success: !!stream && (stream.directDownloadLinks.length > 0 || !!stream.downloadUrl),
            details: stream ? `Download URL: ${stream.downloadUrl} (${stream.directDownloadLinks.length} quality mirrors)` : 'No stream extracted',
          });
        }
      }
    }
  } catch (err: any) {
    result.steps.push({ step: 'Fatal Exception', success: false, error: err?.message || String(err) });
  }

  const passedCount = result.steps.filter(s => s.success).length;
  result.status = passedCount === result.steps.length && result.steps.length >= 3 ? 'SUCCESS' : passedCount > 0 ? 'PARTIAL' : 'FAILED';
  return result;
}

async function main() {
  console.log('=============== RUNNING ALL SCRAPER TESTS ===============\n');
  const results: TestResult[] = [];

  results.push(await testAniDao());
  results.push(await testAnikoto());
  results.push(await testAnimeHeaven());
  results.push(await testAnimePahe());
  results.push(await testAniWaves());
  results.push(await testMiruro());
  results.push(await testReAnime());
  results.push(await testSenshi());
  results.push(await testOtakuvid());

  console.log('\n=================== TEST SUMMARY REPORT ===================\n');
  for (const res of results) {
    const icon = res.status === 'SUCCESS' ? '✅' : res.status === 'PARTIAL' ? '⚠️' : '❌';
    console.log(`${icon} ${res.scraper}: [${res.status}]`);
    for (const step of res.steps) {
      const stepIcon = step.success ? '  ✓' : '  ✗';
      console.log(`${stepIcon} ${step.step}: ${step.details || step.error || (step.success ? 'OK' : 'Failed')}`);
    }
    console.log('');
  }
}

main().catch(console.error);
