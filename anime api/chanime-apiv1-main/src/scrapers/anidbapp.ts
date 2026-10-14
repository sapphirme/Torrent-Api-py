import axios from 'axios';
import { cacheGet, cacheSet } from '../utils/cache';

export const BASE = process.env.ANIDB_DOMAIN || 'https://anidb.se';
export const MIRROR_DOMAINS = ['https://anidb.se', 'https://anidb.app'];
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PROXY_WORKERS = [
  process.env.ANIDB_PROXY_URL,
  'https://anidb-proxy.kvngmark007.workers.dev/',
  'https://chanime-proxy.kvngmark007.workers.dev/',
].filter(Boolean) as string[];

export interface AnidbSearchResult {
  slug: string;
  siteId: number;
  title: string;
  meta?: string;
}

export interface AnidbEpisode {
  id: string;
  num: number;
  title: string;
  duration?: number;
  isFiller?: boolean;
  sourceNumber?: number;
  sourceId?: string | number;
}

export interface AnidbServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub';
}

export interface AnidbStream {
  embedUrl: string;
  streamUrl: string;
  m3u8: string | null;
  type: 'hls' | 'embed';
  subtitles: { label: string; url: string; kind?: string; default?: boolean }[];
  intro?: { start: number; end: number };
  outro?: { start: number; end: number };
  servers: string[];
  directWatchLinks: { quality: string; url: string; type: string }[];
  referer: string;
}

/**
 * Robust fetcher with direct request and multiple proxy worker fallbacks.
 */
export async function fetchWithFallback(url: string, headers: Record<string, string> = {}): Promise<string> {
  const urlsToTry = [url];
  if (url.includes('anidb.app')) {
    urlsToTry.unshift(url.replace('anidb.app', 'anidb.se'));
  } else if (url.includes('anidb.se')) {
    urlsToTry.push(url.replace('anidb.se', 'anidb.app'));
  }

  const getHeaders = (targetBase: string) => ({
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: headers.Referer || `${targetBase}/`,
    ...headers,
  });

  // 1. Try direct fetch
  for (const targetUrl of urlsToTry) {
    const targetBase = targetUrl.startsWith('https://anidb.se') ? 'https://anidb.se' : 'https://anidb.app';
    try {
      const directRes = await axios.get(targetUrl, {
        headers: getHeaders(targetBase),
        timeout: 4000,
        validateStatus: (status) => status < 400,
      });
      if (directRes.data) {
        const dataStr = typeof directRes.data === 'string' ? directRes.data : JSON.stringify(directRes.data);
        if (!dataStr.includes('cf-browser-verification') && !dataStr.includes('Under Maintenance') && !dataStr.includes('Just a moment...')) {
          return dataStr;
        }
      }
    } catch {}
  }

  // 2. Try proxy workers
  for (const targetUrl of urlsToTry) {
    const targetBase = targetUrl.startsWith('https://anidb.se') ? 'https://anidb.se' : 'https://anidb.app';
    const ref = headers.Referer || `${targetBase}/`;
    for (const proxyBase of PROXY_WORKERS) {
      try {
        const cleanProxy = proxyBase.replace(/\/$/, '');
        const proxyUrl = `${cleanProxy}?url=${encodeURIComponent(targetUrl)}&ref=${encodeURIComponent(ref)}`;
        const res = await axios.get(proxyUrl, {
          headers: { 'User-Agent': UA, Accept: getHeaders(targetBase).Accept },
          timeout: 5000,
        });
        if (res.data) {
          const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          if (!text.includes('Just a moment...') && !text.includes('cf-browser-verification')) {
            return text;
          }
        }
      } catch {}
    }
  }

  // 3. Direct axios fallback
  for (const targetUrl of urlsToTry) {
    const targetBase = targetUrl.startsWith('https://anidb.se') ? 'https://anidb.se' : 'https://anidb.app';
    const ref = headers.Referer || `${targetBase}/`;
    try {
      const res = await axios.get(targetUrl, {
        headers: { 'User-Agent': UA, Referer: ref, ...headers },
        timeout: 8000,
      });
      if (res && res.data) {
        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        if (!text.includes('Just a moment...') && !text.includes('cf-browser-verification')) {
          return text;
        }
      }
    } catch {}
  }
  
  return '';
}

export async function fetchJsonWithFallback<T = any>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const text = await fetchWithFallback(url, {
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      ...headers,
    });
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreTitle(query: string, title: string): number {
  const needle = normalizeTitle(query);
  const hay = normalizeTitle(title);
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 90;
  if (needle.startsWith(hay)) return 85;
  if (hay.includes(needle)) return 75;
  return 0;
}

/**
 * Search AniDB.app by query
 */
export async function searchAnidb(query: string): Promise<AnidbSearchResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const cacheKey = `anidb:search:${cleanQ.toLowerCase()}`;
  const cached = cacheGet<AnidbSearchResult[]>(cacheKey);
  if (cached) return cached;

  const results: AnidbSearchResult[] = [];

  // Suggestions endpoint
  try {
    const html = await fetchWithFallback(`${BASE}/search/suggestions?q=${encodeURIComponent(cleanQ)}`, {
      Referer: `${BASE}/home`,
      'X-Requested-With': 'XMLHttpRequest',
    });
    if (html) {
      for (const m of html.matchAll(/<a\b[^>]*data-search-item\b[^>]*>[\s\S]*?<\/a>/gi)) {
        const full = m[0];
        const href = full.match(/href=["']([^"']+)["']/i)?.[1] || '';
        const path = href.startsWith('http') ? new URL(href).pathname : href;
        const slug = path.match(/^\/anime\/([^/?#]+)/)?.[1];
        if (!slug) continue;
        const title = full.match(/<p\b[^>]*class=["'][^"']*text-sm[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || slug.replace(/-/g, ' ');
        const meta = full.match(/<p\b[^>]*class=["'][^"']*text-xs[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
        const siteId = Number(slug.match(/-(\d+)$/)?.[1]) || 0;
        results.push({ slug, title, meta, siteId });
      }
    }
  } catch {}

  // Browse fallback if suggestions yielded nothing
  if (!results.length) {
    try {
      const browseHtml = await fetchWithFallback(`${BASE}/browse?q=${encodeURIComponent(cleanQ)}`, {
        Referer: `${BASE}/home`,
      });
      if (browseHtml) {
        const seen = new Set<string>();
        for (const m of browseHtml.matchAll(/<a\b[^>]*href=["'](?:https:\/\/anidb\.app)?\/anime\/([^"']+)["'][^>]*class=["'][^"']*\banime-card\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) {
          const slug = m[1];
          if (seen.has(slug)) continue;
          seen.add(slug);
          const full = m[0];
          const title = full.match(/title=["']([^"']+)["']/i)?.[1]
            || full.match(/alt=["']([^"']+)["']/i)?.[1]
            || slug.replace(/-/g, ' ');
          const siteId = Number(slug.match(/-(\d+)$/)?.[1]) || 0;
          results.push({ slug, title: title.replace(/<[^>]+>/g, '').trim(), siteId });
        }
      }
    } catch {}
  }

  if (results.length) {
    cacheSet(cacheKey, results, 60 * 60); // 1 hour
  }
  return results;
}

/**
 * Match anime to AniDB.app slug or siteId
 */
export async function findAnidbId(titles: string[], anilistId?: number | null, malId?: number | null): Promise<AnidbSearchResult | null> {
  const cacheKey = `anidb:match:${anilistId || ''}:${malId || ''}:${titles[0] || ''}`;
  const cached = cacheGet<AnidbSearchResult>(cacheKey);
  if (cached) return cached;

  const candidates: AnidbSearchResult[] = [];
  for (const title of titles.slice(0, 4)) {
    if (!title) continue;
    const res = await searchAnidb(title);
    for (const r of res) {
      if (!candidates.find((c) => c.slug === r.slug)) {
        candidates.push(r);
      }
    }
    if (candidates.length > 5) break;
  }

  if (!candidates.length) return null;

  // If we have anilistId or malId, check candidate page metadata
  if (anilistId || malId) {
    for (const cand of candidates.slice(0, 5)) {
      try {
        const html = await fetchWithFallback(`${BASE}/anime/${cand.slug}`, { Referer: `${BASE}/home` });
        if (html) {
          const pageAnilistId = Number(html.match(/https:\/\/anilist\.co\/anime\/(\d+)/i)?.[1]) || null;
          const pageMalId = Number(html.match(/https:\/\/myanimelist\.net\/anime\/(\d+)/i)?.[1]) || null;
          if (anilistId && pageAnilistId === anilistId) {
            cacheSet(cacheKey, cand, 24 * 60 * 60);
            return cand;
          }
          if (malId && pageMalId === malId) {
            cacheSet(cacheKey, cand, 24 * 60 * 60);
            return cand;
          }
        }
      } catch {}
    }
  }

  // Best title match fallback
  let bestCand: AnidbSearchResult | null = null;
  let bestScore = -1;
  for (const cand of candidates) {
    for (const t of titles) {
      const s = scoreTitle(t, cand.title);
      if (s > bestScore) {
        bestScore = s;
        bestCand = cand;
      }
    }
  }

  const result = bestScore >= 50 ? bestCand : candidates[0];
  if (result) {
    cacheSet(cacheKey, result, 6 * 60 * 60);
  }
  return result;
}

/**
 * Fetch episodes for AniDB.app series
 */
export async function getAnidbEpisodes(
  siteIdOrSlug: string,
  titles: string[] = [],
  siteIds?: any
): Promise<AnidbEpisode[]> {
  const cacheKey = `anidb:episodes:${siteIdOrSlug}`;
  const cached = cacheGet<AnidbEpisode[]>(cacheKey);
  if (cached && cached.length > 0) return cached;

  let cleanSiteId = siteIdOrSlug;
  const numMatch = siteIdOrSlug.match(/-(\d+)$/);
  if (numMatch) {
    cleanSiteId = numMatch[1];
  }

  // 1. Try AniDB frontend episodes API
  const apiUrl = `${BASE}/api/frontend/anime/${cleanSiteId}/episodes`;
  const data = await fetchJsonWithFallback<{ episodes?: any[] }>(apiUrl, {
    Referer: `${BASE}/anime/${siteIdOrSlug}`,
  });

  const eps: AnidbEpisode[] = [];
  if (data?.episodes && Array.isArray(data.episodes) && data.episodes.length > 0) {
    for (const src of data.episodes) {
      const num = Number(src.number);
      if (Number.isFinite(num) && num > 0) {
        eps.push({
          id: `${siteIdOrSlug}:${num}:${src.id || num}`,
          num,
          title: src.title || `Episode ${num}`,
          duration: src.duration,
          isFiller: Boolean(src.filler),
          sourceNumber: num,
          sourceId: src.id || num,
        });
      }
    }
  }

  // 2. If API yielded episodes, cache and return
  if (eps.length > 0) {
    cacheSet(cacheKey, eps, 60 * 30);
    return eps;
  }

  // 3. Fallback: synthesize episodes from siteIds or count
  const expectedTotal = siteIds?.episodes || (siteIds?.media?.episodes as number) || 24;
  for (let i = 1; i <= expectedTotal; i++) {
    eps.push({
      id: `${siteIdOrSlug}:${i}:${i}`,
      num: i,
      title: `Episode ${i}`,
      sourceNumber: i,
      sourceId: i,
    });
  }

  if (eps.length > 0) {
    cacheSet(cacheKey, eps, 60 * 10);
  }
  return eps;
}

/**
 * Fetch servers (Sub / Dub) for an AniDB.app episode
 */
export async function getAnidbServers(episodeCompoundId: string): Promise<AnidbServer[]> {
  const parts = episodeCompoundId.split(':');
  const slug = parts[0] || '';
  const epNum = parts[1] || '1';
  const sourceId = parts[2] || epNum;

  const cacheKey = `anidb:servers:${slug}:${epNum}:${sourceId}`;
  const cached = cacheGet<AnidbServer[]>(cacheKey);
  if (cached && cached.length > 0) return cached;

  const servers: AnidbServer[] = [];

  // Fetch languages from AniDB frontend episode languages API
  if (sourceId && sourceId !== epNum) {
    try {
      const langUrl = `${BASE}/api/frontend/episode/${sourceId}/languages`;
      const data = await fetchJsonWithFallback<{ languages?: any[] }>(langUrl, {
        Referer: `${BASE}/anime/${slug}`,
      });
      if (data?.languages && Array.isArray(data.languages)) {
        for (const lang of data.languages) {
          const code = String(lang.code || lang.name || '').toLowerCase();
          const isDub = code.includes('eng') || code.includes('en') || code.includes('dub');
          const type: 'sub' | 'dub' = isDub ? 'dub' : 'sub';
          const name = isDub ? 'AniDB (DUB)' : 'AniDB (SUB)';
          const embedUrl = lang.embed_url || '';
          servers.push({
            name,
            sourceId: `${slug}:${epNum}:${sourceId}:${type}:${encodeURIComponent(embedUrl)}`,
            type,
          });
        }
      }
    } catch {}
  }

  // If no servers resolved via languages API, provide standard Sub and Dub servers
  if (!servers.length) {
    servers.push({
      name: 'AniDB (SUB)',
      sourceId: `${slug}:${epNum}:${sourceId}:sub:`,
      type: 'sub',
    });
    servers.push({
      name: 'AniDB (DUB)',
      sourceId: `${slug}:${epNum}:${sourceId}:dub:`,
      type: 'dub',
    });
  }

  cacheSet(cacheKey, servers, 60 * 30);
  return servers;
}

/**
 * Extract HLS m3u8 playlist URL from HTML text
 */
export function extractHls(html: string): string | null {
  if (!html) return null;
  const patterns = [
    /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\/master\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /src\s*=\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) {
      const clean = m[1].replace(/\\/g, '').replace(/&amp;/g, '&');
      return clean;
    }
  }
  return null;
}

/**
 * Extract subtitles from embed HTML
 */
export function extractSubtitles(html: string): { label: string; url: string; kind?: string; default?: boolean }[] {
  const subs: { label: string; url: string; kind?: string; default?: boolean }[] = [];
  if (!html) return subs;

  // Track tags
  for (const tm of html.matchAll(/<track\b[^>]*>/gi)) {
    const tag = tm[0];
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    const label = tag.match(/label=["']([^"']+)["']/i)?.[1] || 'English';
    const isDefault = /default\b/i.test(tag);
    if (src) {
      subs.push({
        label,
        url: src.startsWith('http') ? src : `${BASE}${src.startsWith('/') ? '' : '/'}${src}`,
        kind: 'captions',
        default: isDefault,
      });
    }
  }

  // JW Player tracks definition
  const tracksMatch = html.match(/tracks\s*:\s*(\[[^\]]+\])/i);
  if (tracksMatch?.[1]) {
    try {
      const clean = tracksMatch[1]
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
        .replace(/'/g, '"');
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          if (t.file) {
            subs.push({
              label: t.label || 'English',
              url: t.file.startsWith('http') ? t.file : `${BASE}${t.file.startsWith('/') ? '' : '/'}${t.file}`,
              kind: t.kind || 'captions',
              default: Boolean(t.default),
            });
          }
        }
      }
    } catch {}
  }

  return subs;
}

/**
 * Resolve stream (HLS m3u8 or embed URL) from sourceId
 */
export async function getAnidbStream(sourceId: string): Promise<AnidbStream | null> {
  const cacheKey = `anidb:stream:${sourceId}`;
  const cached = cacheGet<AnidbStream>(cacheKey);
  if (cached) return cached;

  // sourceId format: `${slug}:${epNum}:${sourceId}:${type}:${encodedEmbedUrl}`
  const parts = sourceId.split(':');
  const slug = parts[0] || '';
  const epNum = parts[1] || '1';
  const episodeSourceId = parts[2] || epNum;
  const audioType = parts[3] || 'sub';
  let embedUrl = parts[4] ? decodeURIComponent(parts[4]) : '';

  // If no embedUrl in sourceId, query language API
  if (!embedUrl && episodeSourceId && episodeSourceId !== epNum) {
    try {
      const langUrl = `${BASE}/api/frontend/episode/${episodeSourceId}/languages`;
      const data = await fetchJsonWithFallback<{ languages?: any[] }>(langUrl, {
        Referer: `${BASE}/anime/${slug}`,
      });
      if (data?.languages && Array.isArray(data.languages)) {
        const preferred = audioType === 'sub' ? ['jpn', 'ja', 'japanese'] : ['eng', 'en', 'english'];
        const matched = data.languages.find((l) => preferred.includes(String(l.code || l.name || '').toLowerCase()))
          || data.languages[0];
        if (matched?.embed_url) {
          embedUrl = matched.embed_url;
        }
      }
    } catch {}
  }

  // Default fallback embed URL format
  if (!embedUrl) {
    embedUrl = `${BASE}/embed/${slug}/${epNum}`;
  } else if (!embedUrl.startsWith('http')) {
    embedUrl = `${BASE}${embedUrl.startsWith('/') ? '' : '/'}${embedUrl}`;
  }

  // Fetch embed page HTML to extract HLS stream
  let embedHtml = '';
  try {
    embedHtml = await fetchWithFallback(embedUrl, { Referer: `${BASE}/` });
  } catch {}

  const hlsUrl = extractHls(embedHtml);
  const subtitles = extractSubtitles(embedHtml);
  const isHls = Boolean(hlsUrl);

  const directWatchLinks: { quality: string; url: string; type: string }[] = [];
  if (hlsUrl) {
    directWatchLinks.push({
      quality: 'Auto',
      url: hlsUrl,
      type: 'hls',
    });
  }

  const streamResult: AnidbStream = {
    embedUrl,
    streamUrl: hlsUrl || embedUrl,
    m3u8: hlsUrl,
    type: isHls ? 'hls' : 'embed',
    subtitles,
    servers: ['AniDB.app', 'AniDB.app-embed'],
    directWatchLinks,
    referer: `${BASE}/`,
  };

  // HLS tokens may be time-limited; cache for 8 minutes
  cacheSet(cacheKey, streamResult, 8 * 60);
  return streamResult;
}
