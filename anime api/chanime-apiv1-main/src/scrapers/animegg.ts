import axios from 'axios';
import * as cheerio from 'cheerio';
import { cacheGet, cacheSet } from '../utils/cache';

const BASE = 'https://www.animegg.org';

const http = axios.create({
  baseURL: BASE,
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': `${BASE}/`,
  },
});

export interface AnimeGGSearchResult {
  id: string;
  slug: string;
  title: string;
}

export interface AnimeGGEpisode {
  id: string;
  num: number;
  title: string;
  epSlug: string;
  hasSub: boolean;
  hasDub: boolean;
}

export interface AnimeGGServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub';
  embedId: string;
}

export interface AnimeGGStream {
  embedUrl: string;
  streamUrl: string;
  m3u8: string | null;
  type: 'hls' | 'mp4' | 'embed';
  directWatchLinks: { quality: string; url: string; type: string; backup?: string | null }[];
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

export async function searchAnimeGG(query: string): Promise<AnimeGGSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];
  const cacheKey = `animegg:search:${clean.toLowerCase()}`;
  const cached = cacheGet<AnimeGGSearchResult[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get('/search/', { params: { q: clean } });
    const html = res.data || '';
    const results: AnimeGGSearchResult[] = [];

    for (const m of html.matchAll(/<a\b[^>]*class=["'][^"']*\bmse\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) {
      const tag = m[0].match(/<a\b[^>]*>/i)?.[0] ?? '';
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1] || '';
      const slug = href.match(/^\/series\/([^/?#]+)/)?.[1];
      if (!slug) continue;
      const strong = m[0].match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || '';
      const title = strong.replace(/<[^>]+>/g, '').trim() || slug.replace(/-/g, ' ');
      if (!results.some((r) => r.slug === slug)) {
        results.push({ id: slug, slug, title });
      }
    }

    cacheSet(cacheKey, results, 'episodes');
    return results;
  } catch (e: any) {
    console.error('[AnimeGG] Search error:', e?.message || e);
    return [];
  }
}

export async function findAnimeGGSlug(
  anilistId: number | string | null | undefined,
  titles: string | string[] = []
): Promise<string | null> {
  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
  const candidates = Array.from(new Set([
    ...titleList,
    ...titleList.map((t) => t.split(/[:(|-]/)[0]?.trim()),
  ].filter((t): t is string => Boolean(t && t.length >= 2))));

  for (const q of candidates) {
    const results = await searchAnimeGG(q);
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
  const fallback = await searchAnimeGG(candidates[0]);
  if (fallback && fallback[0]) return fallback[0].slug;
  return null;
}

export async function getAnimeGGEpisodes(slug: string): Promise<AnimeGGEpisode[]> {
  const cacheKey = `animegg:eps:${slug}`;
  const cached = cacheGet<AnimeGGEpisode[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get(`/series/${slug}`);
    const html = res.data || '';
    const episodes: AnimeGGEpisode[] = [];

    for (const m of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const block = m[1];
      if (!/\banm_det_pop\b/.test(block)) continue;
      const linkMatch = block.match(/href=["']\/?([^"']+)["']/i);
      if (!linkMatch) continue;
      const href = linkMatch[1].replace(/#.*$/, '');
      const strong = (block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
      const numMatch = strong.match(/(\d+)-(\d+)\s*$/) || strong.match(/(\d+)\s*$/);
      if (!numMatch || !href) continue;

      const num = parseInt(numMatch[1], 10);
      const title = (block.match(/<i\b[^>]*class=["'][^"']*anititle[^"']*["'][^>]*>([\s\S]*?)<\/i>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim() || strong;
      const hasSub = /\bbtn-subbed\b/.test(block);
      const hasDub = /\bbtn-dubbed\b/.test(block);

      episodes.push({
        id: `${slug}:${href}`,
        num,
        title,
        epSlug: href,
        hasSub: hasSub || (!hasSub && !hasDub),
        hasDub,
      });
    }

    episodes.sort((a, b) => a.num - b.num);
    const unique = episodes.filter((ep, index, self) => index === self.findIndex((e) => e.num === ep.num));
    cacheSet(cacheKey, unique, 'episodes');
    return unique;
  } catch (e: any) {
    console.error(`[AnimeGG] Error fetching episodes for ${slug}:`, e?.message || e);
    return [];
  }
}

export async function getAnimeGGServers(epSlugOrId: string): Promise<AnimeGGServer[]> {
  const epSlug = epSlugOrId.includes(':') ? epSlugOrId.split(':').slice(1).join(':') : epSlugOrId;
  const cacheKey = `animegg:servers:${epSlug}`;
  const cached = cacheGet<AnimeGGServer[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get(`/${epSlug}`);
    const html = res.data || '';
    const servers: AnimeGGServer[] = [];

    for (const m of html.matchAll(/<a\b[^>]*data-toggle=["']tab["'][^>]*>/gi)) {
      const tag = m[0];
      const embedId = tag.match(/data-id=["']([^"']+)["']/i)?.[1];
      const serverName = tag.match(/data-mirror=["']([^"']+)["']/i)?.[1] || 'AnimeGG';
      const version = tag.match(/data-version=["']([^"']+)["']/i)?.[1] || 'subbed';
      if (!embedId) continue;

      const type = version.toLowerCase().includes('dub') ? 'dub' : 'sub';
      servers.push({
        name: `${serverName} (${type.toUpperCase()})`,
        sourceId: `${epSlug}:${embedId}:${type}`,
        type,
        embedId,
      });
    }

    if (servers.length === 0) {
      // Fallback
      const defaultId = html.match(/data-id=["']([^"']+)["']/i)?.[1];
      if (defaultId) {
        servers.push({
          name: 'AnimeGG (SUB)',
          sourceId: `${epSlug}:${defaultId}:sub`,
          type: 'sub',
          embedId: defaultId,
        });
      }
    }

    cacheSet(cacheKey, servers, 60);
    return servers;
  } catch (e: any) {
    console.error(`[AnimeGG] Error fetching servers for ${epSlug}:`, e?.message || e);
    return [];
  }
}

export async function getAnimeGGStream(sourceId: string): Promise<AnimeGGStream | null> {
  const cacheKey = `animegg:stream:${sourceId}`;
  const cached = cacheGet<AnimeGGStream>(cacheKey);
  if (cached) return cached;

  let embedId = sourceId;
  if (sourceId.includes(':')) {
    const parts = sourceId.split(':');
    embedId = parts[parts.length - 2] || parts[parts.length - 1];
  }

  try {
    const embedUrl = `${BASE}/embed/${embedId}`;
    const res = await http.get(`/embed/${embedId}`, { headers: { Referer: `${BASE}/` } });
    const html = res.data || '';
    const m = html.match(/var\s+videoSources\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) {
      return {
        embedUrl,
        streamUrl: embedUrl,
        m3u8: null,
        type: 'embed',
        directWatchLinks: [],
        referer: `${BASE}/`,
      };
    }

    let parsed: any[] = [];
    try {
      const asJson = m[1]
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*)'/g, ': "$1"');
      parsed = JSON.parse(asJson);
    } catch {
      parsed = [];
    }

    const links: { quality: string; url: string; type: string; backup?: string | null }[] = [];
    let primaryM3u8: string | null = null;
    let primaryStream: string | null = null;

    for (const s of parsed) {
      let url = s.file ? (s.file.startsWith('http') ? s.file : `${BASE}${s.file}`) : '';
      let backup: string | null = null;
      if (s.bk) {
        try {
          backup = decodeURIComponent(atob(s.bk));
        } catch {
          backup = null;
        }
      }
      if (url) {
        const isM3u8 = url.includes('.m3u8');
        if (isM3u8 && !primaryM3u8) primaryM3u8 = url;
        if (!primaryStream) primaryStream = url;
        links.push({
          quality: s.label || '720p',
          url,
          type: isM3u8 ? 'hls' : 'mp4',
          backup,
        });
      }
    }

    const result: AnimeGGStream = {
      embedUrl,
      streamUrl: primaryM3u8 || primaryStream || embedUrl,
      m3u8: primaryM3u8,
      type: primaryM3u8 ? 'hls' : (primaryStream ? 'mp4' : 'embed'),
      directWatchLinks: links,
      referer: embedUrl,
    };

    cacheSet(cacheKey, result, 60);
    return result;
  } catch (e: any) {
    console.error(`[AnimeGG] Error fetching stream for ${sourceId}:`, e?.message || e);
    return null;
  }
}
