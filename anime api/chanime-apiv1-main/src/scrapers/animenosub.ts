import axios from 'axios';
import * as cheerio from 'cheerio';
import { cacheGet, cacheSet } from '../utils/cache';

const BASE = 'https://animenosub.to';

const http = axios.create({
  baseURL: BASE,
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': `${BASE}/`,
  },
});

export interface AnimenosubSearchResult {
  id: string;
  slug: string;
  title: string;
}

export interface AnimenosubEpisode {
  id: string;
  num: number;
  title: string;
  epSlug: string;
  hasSub: boolean;
  hasDub: boolean;
}

export interface AnimenosubServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub';
  embedUrl: string;
}

export interface AnimenosubStream {
  embedUrl: string;
  streamUrl: string;
  m3u8: string | null;
  type: 'hls' | 'embed';
  directWatchLinks: { quality: string; url: string; type: string }[];
  referer: string;
}

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreTitle(query: string, title: string): number {
  const needle = normalize(query);
  const hay = normalize(title);
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 85;
  if (hay.includes(needle)) return 70;
  return 0;
}

export async function searchAnimenosub(query: string): Promise<AnimenosubSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];
  const cacheKey = `animenosub:search:${clean.toLowerCase()}`;
  const cached = cacheGet<AnimenosubSearchResult[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get('/', { params: { s: clean } });
    const html = res.data || '';
    const $ = cheerio.load(html);
    const results: AnimenosubSearchResult[] = [];

    $('article.bs').each((_, el) => {
      const aTag = $(el).find('a[href*="/anime/"]').first();
      const href = aTag.attr('href') || '';
      const slug = href.match(/\/anime\/([^/]+)/)?.[1];
      if (!slug) return;

      const title = aTag.attr('title') || $(el).find('.tt').text().trim() || slug.replace(/-/g, ' ');
      if (!results.some((r) => r.slug === slug)) {
        results.push({ id: slug, slug, title });
      }
    });

    cacheSet(cacheKey, results, 'episodes');
    return results;
  } catch (e: any) {
    console.error('[Animenosub] Search error:', e?.message || e);
    return [];
  }
}

export async function findAnimenosubSlug(
  anilistId: number | string | null | undefined,
  titles: string | string[] = []
): Promise<string | null> {
  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
  const candidates = Array.from(new Set([
    ...titleList,
    ...titleList.map((t) => t.split(/[:(|-]/)[0]?.trim()),
  ].filter((t): t is string => Boolean(t && t.length >= 2))));

  for (const q of candidates) {
    const results = await searchAnimenosub(q);
    let bestMatch = null;
    let bestScore = 0;
    for (const r of results) {
      for (const t of titleList) {
        const cleanTitle = r.title.replace(/\b(english|subbed|dubbed|dub|sub)\b/gi, '').trim();
        const score = Math.max(scoreTitle(t, r.title), scoreTitle(t, cleanTitle));
        if (score > bestScore) {
          bestScore = score;
          bestMatch = r;
        }
      }
    }
    if (bestScore >= 85 && bestMatch) return bestMatch.slug;
  }
  const fallback = await searchAnimenosub(candidates[0]);
  if (fallback && fallback[0]) return fallback[0].slug;
  return null;
}

export async function getAnimenosubEpisodes(slug: string): Promise<AnimenosubEpisode[]> {
  const cacheKey = `animenosub:eps:${slug}`;
  const cached = cacheGet<AnimenosubEpisode[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get(`/anime/${slug}`);
    const html = res.data || '';
    const $ = cheerio.load(html);
    const episodes: AnimenosubEpisode[] = [];

    $('.eplister li').each((_, el) => {
      const aTag = $(el).find('a').first();
      const href = aTag.attr('href') || '';
      const epSlug = href.match(/https?:\/\/animenosub\.to\/([^/]+)/)?.[1];
      if (!epSlug) return;

      const numText = $(el).find('.epl-num').text().trim();
      const num = Number(numText);
      if (!Number.isFinite(num)) return;

      const title = $(el).find('.epl-title').text().trim() || `Episode ${num}`;
      const isDub = title.toLowerCase().includes('dub') || epSlug.toLowerCase().includes('dub');

      episodes.push({
        id: epSlug,
        num,
        title,
        epSlug,
        hasSub: !isDub,
        hasDub: isDub,
      });
    });

    episodes.sort((a, b) => a.num - b.num);
    const unique = episodes.filter((ep, index, self) => index === self.findIndex((e) => e.num === ep.num));
    cacheSet(cacheKey, unique, 'episodes');
    return unique;
  } catch (e: any) {
    console.error(`[Animenosub] Error fetching episodes for ${slug}:`, e?.message || e);
    return [];
  }
}

export async function getAnimenosubServers(epSlug: string): Promise<AnimenosubServer[]> {
  const cacheKey = `animenosub:servers:${epSlug}`;
  const cached = cacheGet<AnimenosubServer[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get(`/${epSlug}`);
    const html = res.data || '';
    const $ = cheerio.load(html);
    const servers: AnimenosubServer[] = [];

    $('select.mirror option').each((i, opt) => {
      const val = $(opt).attr('value');
      const label = $(opt).text().trim() || `Server ${i + 1}`;
      if (!val) return;

      try {
        const decoded = Buffer.from(val, 'base64').toString('utf8');
        let iframeSrc = decoded.match(/src=["']([^"']+)["']/i)?.[1];
        if (iframeSrc) {
          if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
          const type = label.toLowerCase().includes('dub') ? 'dub' : 'sub';
          servers.push({
            name: `${label} (${type.toUpperCase()})`,
            sourceId: iframeSrc,
            type,
            embedUrl: iframeSrc,
          });
        }
      } catch {}
    });

    if (servers.length === 0) {
      const defaultIframe = html.match(/<iframe\b[^>]*src=["']([^"']+)["']/i)?.[1];
      if (defaultIframe) {
        let fullSrc = defaultIframe.startsWith('//') ? 'https:' + defaultIframe : defaultIframe;
        servers.push({
          name: 'Animenosub Default',
          sourceId: fullSrc,
          type: 'sub',
          embedUrl: fullSrc,
        });
      }
    }

    cacheSet(cacheKey, servers, 60);
    return servers;
  } catch (e: any) {
    console.error(`[Animenosub] Error fetching servers for ${epSlug}:`, e?.message || e);
    return [];
  }
}

export async function extractAnimenosubHls(iframeUrl: string): Promise<string | null> {
  try {
    const res = await axios.get(iframeUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': `${BASE}/`,
      },
      timeout: 6000,
    });
    const html = res.data || '';
    const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    if (m3u8Match && m3u8Match[0]) return m3u8Match[0];
  } catch {}
  return null;
}

export async function getAnimenosubStream(sourceIdOrIframeUrl: string): Promise<AnimenosubStream | null> {
  const cacheKey = `animenosub:stream:${sourceIdOrIframeUrl}`;
  const cached = cacheGet<AnimenosubStream>(cacheKey);
  if (cached) return cached;

  const iframeUrl = sourceIdOrIframeUrl;
  try {
    const directHls = await extractAnimenosubHls(iframeUrl);
    const result: AnimenosubStream = {
      embedUrl: iframeUrl,
      streamUrl: directHls || iframeUrl,
      m3u8: directHls,
      type: directHls ? 'hls' : 'embed',
      directWatchLinks: directHls ? [{ quality: 'Auto', url: directHls, type: 'hls' }] : [],
      referer: iframeUrl,
    };

    cacheSet(cacheKey, result, 60);
    return result;
  } catch (e: any) {
    console.error(`[Animenosub] Error fetching stream for ${sourceIdOrIframeUrl}:`, e?.message || e);
    return null;
  }
}
