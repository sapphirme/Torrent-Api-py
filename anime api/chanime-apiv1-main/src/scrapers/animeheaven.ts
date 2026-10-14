import * as cheerio from 'cheerio';
import { makeClient } from '../utils/fetch';
import { cacheGet, cacheSet, cacheDel } from '../utils/cache';

const BASE = 'https://animeheaven.me';
// AnimeHeaven is direct fetch, no FlareSolverr needed
const http = makeClient(BASE, BASE + '/');

export interface HeavenSearchResult {
  id: string;
  title: string;
  url: string;
  image?: string;
}

export interface HeavenEpisode {
  id: string;
  num: number;
  title: string;
}

export interface HeavenServer {
  name: string;
  sourceId: string;
  type: 'sub';
}

export interface HeavenStream {
  embedUrl: string;
  streamUrl: string;
  mp4: string;
  downloadUrl: string;
  m3u8: null;
  type: 'mp4';
  servers: string[];
}

function absoluteUrl(url: string): string {
  return new URL(url, BASE).toString();
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreTitle(query: string, title: string): number {
  const needle = normalizeTitle(query);
  const hay = normalizeTitle(title);
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;

  // Exact word match
  const needleWords = query.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  const hayWords = title.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  if (needleWords.length === hayWords.length && needleWords.every((w, i) => hayWords[i] === w)) return 100;

  if (needle.length <= 3) {
    if (hayWords.includes(needle)) return 90;
    return 0;
  }

  if (hay.startsWith(needle)) return 85 - Math.min(20, (hay.length - needle.length) * 2);
  if (needle.startsWith(hay)) return 80 - Math.min(20, (needle.length - hay.length) * 2);

  if (needleWords.length > 1 && needleWords.every((w) => hayWords.includes(w))) {
    const wordRatio = needleWords.length / hayWords.length;
    return Math.floor(75 + wordRatio * 20);
  }

  if (needle.length >= 5 && hay.includes(needle)) return 65;

  let matches = 0;
  for (const ch of needle) if (hay.includes(ch)) matches++;
  return Math.floor((matches / Math.max(needle.length, 1)) * 30);
}

export async function searchAnimeHeaven(query: string): Promise<HeavenSearchResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];
  const cacheKey = `heaven:search:${cleanQ.toLowerCase()}`;
  const cached = cacheGet<HeavenSearchResult[]>(cacheKey);
  if (cached) return cached;

  let html = '';
  try {
    const res = await http.get('/fastsearch.php', {
      params: { xhr: 1, s: cleanQ },
      headers: { Accept: 'text/html,*/*' },
    });
    html = String(res.data || '');
  } catch (_) {}

  // Fallback to /search.php if fastsearch returned no data
  if (!html || !html.includes('anime.php?')) {
    try {
      const res = await http.get('/search.php', {
        params: { s: cleanQ },
        headers: { Accept: 'text/html,*/*' },
      });
      html = String(res.data || '');
    } catch (_) {}
  }

  const $ = cheerio.load(html);
  const results: HeavenSearchResult[] = [];
  $('a[href*="anime.php?"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const id = href.split('?')[1]?.trim();
    const title = $(el).find('.fastname').text().trim() || $(el).find('img').attr('alt')?.trim() || $(el).text().trim() || '';
    if (!id || !title) return;
    results.push({
      id,
      title,
      url: absoluteUrl(`/anime.php?${id}`),
      image: absoluteUrl($(el).find('img').attr('src') ?? ''),
    });
  });

  const unique = Array.from(new Map(results.map((r) => [r.id, r])).values());
  if (unique.length > 0) {
    cacheSet(cacheKey, unique, 'episodes');
  }
  return unique;
}

export async function findAnimeHeavenId(titles: string | string[]): Promise<string | null> {
  const titleList = (Array.isArray(titles) ? titles : [titles])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (!titleList.length) return null;

  const title = titleList[0];
  const cacheKey = `heaven:find:${normalizeTitle(title)}`;
  const cached = cacheGet<string | null>(cacheKey);
  if (cached !== null) return cached;

  const variants = Array.from(new Set(
    titleList.flatMap((title) => {
      const noPossessive = title.replace(/[’']s\b/gi, '');
      return [
        title,
        noPossessive,
        title.replace(/[’']/g, ''),
        noPossessive.replace(/[+]/g, ' '),
        title.replace(/[+]/g, ' '),
        title.split(/[:(|-]/)[0]?.trim(),
        noPossessive.split(/[:(|-]/)[0]?.trim(),
        title.replace(/[’']/g, '').split(/\s+/).slice(0, 2).join(' '),
        noPossessive.split(/\s+/).slice(0, 2).join(' '),
        title.replace(/[’']/g, '').split(/\s+/)[0],
        noPossessive.split(/\s+/)[0],
      ];
    }).filter((value): value is string => Boolean(value && value.trim().length >= 3))
  ));

  const allResults: HeavenSearchResult[] = [];
  for (const variant of variants) {
    const results = await searchAnimeHeaven(variant).catch(() => []);
    allResults.push(...results);
    // Break early if a strong match (>= 85) is found to keep within timeout
    if (results.some((r) => titleList.some((t) => scoreTitle(t, r.title) >= 85))) {
      break;
    }
  }

  const unique = Array.from(new Map(allResults.map((result) => [result.id, result])).values());
  if (!unique.length) {
    cacheSet(cacheKey, null, 120); // 2 min TTL for negatives
    return null;
  }

  const scored = unique.map((result) => {
    const maxScore = Math.max(...titleList.map((t) => scoreTitle(t, result.title)));
    return { result, score: maxScore };
  }).sort((a, b) => b.score - a.score);

  if (scored[0].score < 50) {
    cacheSet(cacheKey, null, 120);
    return null;
  }
  const bestId = scored[0].result.id;
  cacheSet(cacheKey, bestId, 'episodes');
  return bestId;
}

export async function getHeavenEpisodes(animeId: string): Promise<HeavenEpisode[]> {
  const cleanId = String(animeId || '').replace(/^https?:\/\/[^/]+\//, '').replace(/^anime\.php\?/, '').replace(/^\?/, '').trim();
  if (!cleanId) return [];

  const cacheKey = `heaven:eps:${cleanId}`;
  const cached = cacheGet<HeavenEpisode[]>(cacheKey);
  if (cached) return cached;

  const res = await http.get(`/anime.php?${cleanId}`);
  const $ = cheerio.load(res.data);
  const episodes: HeavenEpisode[] = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const onm = $(el).attr('onmouseover') || '';
    const onc = $(el).attr('onclick') || '';
    const id = $(el).attr('id') || '';
    if (!href.includes('gate.php') && !onm.includes('gate') && !onc.includes('gate')) return;

    let key = id && /^[a-f0-9]{20,}/i.test(id) ? id : null;
    if (!key) {
      const match = (onm + ' ' + onc).match(/gate[ha]\(\s*["'&;quot]*([a-f0-9]{20,})/i);
      key = match ? match[1] : null;
    }
    if (!key) return;

    const rawNum = $(el).find('.watch2').first().text().trim() ||
      $(el).text().match(/(?:ep(?:isode)?\s*|#\s*)?(\d+(?:\.\d+)?)/i)?.[1] ||
      '';
    const num = Number(rawNum.replace(/^0+(\d)/, '$1'));
    const finalNum = Number.isFinite(num) ? num : episodes.length + 1;
    episodes.push({ id: key, num: finalNum, title: `Episode ${rawNum || finalNum}` });
  });

  const unique = Array.from(new Map(episodes.map((ep) => [ep.id, ep])).values())
    .sort((a, b) => a.num - b.num);
  if (unique.length > 0) {
    cacheSet(cacheKey, unique, 'episodes');
  }
  return unique;
}

export async function getHeavenServers(episodeId: string): Promise<HeavenServer[]> {
  return [
    { name: 'AnimeHeaven', sourceId: episodeId, type: 'sub' },
  ];
}

export async function getHeavenStream(episodeId: string, bypassCache = false): Promise<HeavenStream | null> {
  const cleanKey = String(episodeId || '').replace(/^.*key=/, '').trim();
  if (!cleanKey) return null;

  const cacheKey = `heaven:stream:${cleanKey}`;
  if (!bypassCache) {
    const cached = cacheGet<HeavenStream>(cacheKey);
    if (cached) return cached;
  } else {
    cacheDel(cacheKey);
  }

  const res = await http.get('/gate.php', {
    headers: {
      Cookie: `key=${cleanKey}`,
      Referer: `${BASE}/`,
      Accept: 'text/html,*/*',
    },
  });
  const html = String(res.data || '');
  const $ = cheerio.load(html);
  const rawSources: string[] = [];

  // Check video, source, and embed elements
  $('video source, video[src], source[data-src], [data-video], [data-src]').each((_, el) => {
    const src = $(el).attr('src')?.trim() || $(el).attr('data-src')?.trim() || $(el).attr('data-video')?.trim();
    if (src && /^https?:\/\//i.test(src) && !rawSources.includes(src)) {
      rawSources.push(src);
    }
  });

  // Regex fallback in case DOM was dynamically constructed
  const regexMatches = html.match(/https?:\/\/[a-z0-9-._]+\/video\.mp4\?[^\s"'<>]+/gi) || [];
  for (const match of regexMatches) {
    if (!rawSources.includes(match)) {
      rawSources.push(match);
    }
  }

  const cleanUrls = rawSources
    .map((u) => u.replace(/&amp;/g, '&').trim())
    .filter((u) => /^https?:\/\//i.test(u));

  const sources = Array.from(new Set(cleanUrls));

  const primary = sources.find((url) => url.includes('/video.mp4') && !url.includes('&error')) || sources[0];
  if (!primary) return null;

  const download = sources.find((url) => url.includes('&d') || url.endsWith('?d')) || `${primary}${primary.includes('?') ? '&' : '?'}d`;

  const stream: HeavenStream = {
    embedUrl: `${BASE}/gate.php`,
    streamUrl: primary,
    mp4: primary,
    downloadUrl: download,
    m3u8: null,
    type: 'mp4',
    servers: sources,
  };
  cacheSet(cacheKey, stream, 10);
  return stream;
}
