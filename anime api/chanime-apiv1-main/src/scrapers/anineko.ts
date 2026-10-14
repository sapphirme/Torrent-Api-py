import axios from 'axios';
import * as cheerio from 'cheerio';
import { cacheGet, cacheSet } from '../utils/cache';

const BASE = 'https://anineko.site';

const http = axios.create({
  baseURL: BASE,
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': `${BASE}/`,
  },
});

export interface AniNekoSearchResult {
  id: string;
  slug: string;
  title: string;
}

export interface AniNekoEpisode {
  id: string;
  num: number;
  title: string;
  epSlug: string;
  hasSub: boolean;
  hasDub: boolean;
}

export interface AniNekoServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub';
  embedUrl: string;
}

export interface AniNekoStream {
  embedUrl: string;
  streamUrl: string;
  m3u8: string | null;
  type: 'hls' | 'embed';
  directWatchLinks: { quality: string; url: string; type: string }[];
  referer: string;
}

function decodeEntities(str: string): string {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
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

export async function searchAniNeko(query: string): Promise<AniNekoSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];
  const cacheKey = `anineko:search:${clean.toLowerCase()}`;
  const cached = cacheGet<AniNekoSearchResult[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get('/filter', { params: { keyword: clean } });
    const html = res.data || '';
    const results: AniNekoSearchResult[] = [];
    const $ = cheerio.load(html);

    $('div.main-card .item-bottom .name a[href], a.nv-anime-thumb[href]').each((_index, element) => {
      const link = $(element);
      const href = link.attr('href') || '';
      const slug = href.match(/\/watch\/([^/?#]+)/)?.[1];
      if (!slug) return;
      const title = link.text().trim() || link.find('img').attr('alt') || slug.replace(/-/g, ' ');

      if (!results.some((r) => r.slug === slug)) {
        results.push({ id: slug, slug, title });
      }
    });

    cacheSet(cacheKey, results, 'episodes');
    return results;
  } catch (e: any) {
    console.error('[AniNeko] Search error:', e?.message || e);
    return [];
  }
}

export async function findAniNekoSlug(
  anilistId: number | string | null | undefined,
  titles: string | string[] = []
): Promise<string | null> {
  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
  const candidates = Array.from(new Set([
    ...titleList,
    ...titleList.map((t) => t.split(/[:(|-]/)[0]?.trim()),
  ].filter((t): t is string => Boolean(t && t.length >= 2))));

  for (const q of candidates) {
    const results = await searchAniNeko(q);
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
  const fallback = await searchAniNeko(candidates[0]);
  if (fallback && fallback[0]) return fallback[0].slug;
  return null;
}

export async function getAniNekoEpisodes(slug: string): Promise<AniNekoEpisode[]> {
  const cacheKey = `anineko:eps:${slug}`;
  const cached = cacheGet<AniNekoEpisode[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get(`/watch/${slug}`);
    const html = res.data || '';
    const episodes: AniNekoEpisode[] = [];

    for (const m of html.matchAll(/<article\b[^>]*class=["'][^"']*nv-info-episode-item[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)) {
      const block = m[1];
      const link = block.match(/<a\b[^>]*class=["'][^"']*nv-info-episode-main[^"']*["'][^>]*>/i)?.[0] ?? '';
      const href = link.match(/href=["']([^"']+)["']/i)?.[1] || '';
      const num = Number(href.match(/\/ep-(\d+)/)?.[1]);
      if (!Number.isFinite(num)) continue;

      const titleMatch = block.match(/<a\b[^>]*class=["'][^"']*nv-info-episode-main[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : `Episode ${num}`;
      const badges = [...block.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((b) => b[1].replace(/<[^>]+>/g, '').trim().toLowerCase());

      episodes.push({
        id: `${slug}:ep-${num}`,
        num,
        title,
        epSlug: `ep-${num}`,
        hasSub: badges.includes('sub') || (!badges.includes('sub') && !badges.includes('dub')),
        hasDub: badges.includes('dub'),
      });
    }

    episodes.sort((a, b) => a.num - b.num);
    const unique = episodes.filter((ep, index, self) => index === self.findIndex((e) => e.num === ep.num));
    cacheSet(cacheKey, unique, 'episodes');
    return unique;
  } catch (e: any) {
    console.error(`[AniNeko] Error fetching episodes for ${slug}:`, e?.message || e);
    return [];
  }
}

export async function getAniNekoServers(slugAndEp: string): Promise<AniNekoServer[]> {
  let seriesSlug = slugAndEp;
  let epSlug = 'ep-1';
  if (slugAndEp.includes(':')) {
    const parts = slugAndEp.split(':');
    seriesSlug = parts[0];
    epSlug = parts[1];
  }

  const cacheKey = `anineko:servers:${seriesSlug}:${epSlug}`;
  const cached = cacheGet<AniNekoServer[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get(`/watch/${seriesSlug}/${epSlug}`, {
      headers: { Referer: `${BASE}/watch/${seriesSlug}` },
    });
    const html = res.data || '';
    const servers: AniNekoServer[] = [];

    for (const panel of html.matchAll(/<div\b[^>]*class=["'][^"']*nv-server-grid[^"']*["'][^>]*data-id=["']([^"']+)["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*nv-server-grid|$)/gi)) {
      const rawAudio = panel[1].toLowerCase();
      const type = rawAudio.includes('dub') ? 'dub' : 'sub';

      for (const btn of panel[2].matchAll(/data-video=["']([^"']+)["']/gi)) {
        const embedUrl = decodeEntities(btn[1]);
        let serverName = 'AniNeko Server';
        try {
          serverName = new URL(embedUrl).hostname.replace('www.', '');
        } catch {}

        servers.push({
          name: `${serverName} (${type.toUpperCase()})`,
          sourceId: embedUrl,
          type,
          embedUrl,
        });
      }
    }

    cacheSet(cacheKey, servers, 60);
    return servers;
  } catch (e: any) {
    console.error(`[AniNeko] Error fetching servers for ${slugAndEp}:`, e?.message || e);
    return [];
  }
}

export async function extractAniNekoHls(embedUrl: string): Promise<string | null> {
  try {
    const res = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': `${BASE}/`,
      },
      timeout: 6000,
    });
    const html = res.data || '';
    const patterns = [
      /const\s+src\s*=\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /["'](https?:\/\/[^"']+\/master\.m3u8[^"']*)["']/i,
      /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    ];

    for (const pattern of patterns) {
      const m = html.match(pattern);
      if (m && m[1]) return decodeEntities(m[1]);
    }
  } catch {}
  return null;
}

export async function getAniNekoStream(sourceIdOrEmbedUrl: string): Promise<AniNekoStream | null> {
  const cacheKey = `anineko:stream:${sourceIdOrEmbedUrl}`;
  const cached = cacheGet<AniNekoStream>(cacheKey);
  if (cached) return cached;

  const embedUrl = sourceIdOrEmbedUrl;
  try {
    const directHls = await extractAniNekoHls(embedUrl);
    const result: AniNekoStream = {
      embedUrl,
      streamUrl: directHls || embedUrl,
      m3u8: directHls,
      type: directHls ? 'hls' : 'embed',
      directWatchLinks: directHls ? [{ quality: 'Auto', url: directHls, type: 'hls' }] : [],
      referer: embedUrl,
    };

    cacheSet(cacheKey, result, 60);
    return result;
  } catch (e: any) {
    console.error(`[AniNeko] Error fetching stream for ${sourceIdOrEmbedUrl}:`, e?.message || e);
    return null;
  }
}
