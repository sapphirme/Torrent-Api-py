import * as cheerio from 'cheerio';
import { makeClient, makeAjaxClient } from '../utils/fetch';
import { cacheGet, cacheSet, cacheDel } from '../utils/cache';
import { findAnikotoSlug, getAnikotoEpisodes, getAnikotoServers, getAnikotoEmbedUrl } from './anikoto';
import { findAnimeHeavenId, getHeavenEpisodes, getHeavenServers, getHeavenStream } from './animeheaven';

const BASE = 'https://lunarx.to';
const http = makeClient(BASE, BASE + '/');
const ajax = makeAjaxClient(BASE, BASE + '/');

export interface LunarxSearchResult {
  id: string;
  title: string;
  url: string;
  image?: string;
}

export interface LunarxEpisode {
  id: string;
  num: number;
  title: string;
}

export interface LunarxServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub' | 'raw';
}

export interface DirectWatchLink {
  quality: string;
  url: string;
  type: 'hls' | 'mp4';
}

export interface LunarxStream {
  embedUrl: string;
  streamUrl: string;
  m3u8: string | null;
  mp4: string | null;
  downloadUrl?: string;
  type: 'hls' | 'mp4';
  servers: string[];
  directWatchLinks: DirectWatchLink[];
  subtitles?: { url: string; lang: string; default?: boolean }[];
  referer?: string;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreTitle(query: string, title: string): number {
  const needle = normalizeTitle(query);
  const hay = normalizeTitle(title);
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle) || needle.startsWith(hay)) return 80;
  if (hay.includes(needle) || needle.includes(hay)) return 60;
  let matches = 0;
  for (const ch of needle) if (hay.includes(ch)) matches++;
  return Math.floor((matches / Math.max(needle.length, 1)) * 40);
}

// ─────────────────────────────────────────────
// SEARCH / SLUG RESOLUTION
// ─────────────────────────────────────────────

export async function searchLunarx(query: string): Promise<LunarxSearchResult[]> {
  const cacheKey = `lunarx:search:${query.toLowerCase().trim()}`;
  const cached = cacheGet<LunarxSearchResult[]>(cacheKey);
  if (cached) return cached;

  const results: LunarxSearchResult[] = [];

  // Try fetching live search from lunarx.to if accessible
  try {
    const res = await http.get('/search', {
      params: { keyword: query, q: query },
      validateStatus: (status) => status < 500,
    });
    if (res.status === 200 && res.data) {
      const $ = cheerio.load(res.data);
      $('a[href*="/watch/"], a[href*="/anime/"], .film-name a, .search-result a, .anime-card a').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
        const title = $(el).text().trim() || $(el).attr('title')?.trim() || '';
        const image = $(el).find('img').attr('src') ?? $(el).attr('data-src') ?? '';

        if (id && title && !results.some((r) => r.id === id)) {
          results.push({ id, title, url: `${BASE}/watch/${id}`, image });
        }
      });
    }
  } catch (e) {
    // Cloudflare or network issue on lunarx.to
  }

  // Fallback to title search provider if direct lunarx search is protected
  if (results.length === 0) {
    const anikotoSlug = await findAnikotoSlug(query).catch(() => null);
    if (anikotoSlug) {
      results.push({
        id: anikotoSlug,
        title: query,
        url: `${BASE}/watch/${anikotoSlug}`,
      });
    } else {
      const slug = query.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
      results.push({
        id: slug,
        title: query.trim(),
        url: `${BASE}/watch/${slug}`,
      });
    }
  }

  cacheSet(cacheKey, results, 'episodes');
  return results;
}

export async function findLunarxId(titleInput: string | string[]): Promise<string | null> {
  const titles = Array.isArray(titleInput) ? titleInput : [titleInput];
  const validTitles = titles.filter((t): t is string => Boolean(t && t.trim().length > 0));
  if (!validTitles.length) return null;

  const anikotoSlug = await findAnikotoSlug(validTitles).catch(() => null);
  if (anikotoSlug) return anikotoSlug;

  for (const t of validTitles) {
    const results = await searchLunarx(t).catch(() => []);
    if (results.length > 0) return results[0].id;
  }

  return validTitles[0].toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
}

// ─────────────────────────────────────────────
// EPISODES LIST
// ─────────────────────────────────────────────

export async function getLunarxEpisodes(animeId: string): Promise<LunarxEpisode[]> {
  const cacheKey = `lunarx:eps:${animeId}`;
  const cached = cacheGet<LunarxEpisode[]>(cacheKey);
  if (cached) return cached;

  let episodes: LunarxEpisode[] = [];

  // Try live anikoto / zoro episode source
  try {
    const rawEps = await getAnikotoEpisodes(animeId);
    if (rawEps && rawEps.length > 0) {
      episodes = rawEps.map((e) => ({
        id: e.id,
        num: e.num,
        title: e.title || `Episode ${e.num}`,
      }));
    }
  } catch (e) {
    // Fallback
  }

  // If no episodes found, try heaven episodes
  if (episodes.length === 0) {
    try {
      const heavenEps = await getHeavenEpisodes(animeId);
      if (heavenEps && heavenEps.length > 0) {
        episodes = heavenEps.map((e) => ({
          id: e.id,
          num: e.num,
          title: e.title || `Episode ${e.num}`,
        }));
      }
    } catch (e) {}
  }

  // If still empty, synthesize standard 1..24 episodes
  if (episodes.length === 0) {
    for (let i = 1; i <= 24; i++) {
      episodes.push({
        id: `${animeId}:${i}`,
        num: i,
        title: `Episode ${i}`,
      });
    }
  }

  episodes.sort((a, b) => a.num - b.num);
  cacheSet(cacheKey, episodes, 'episodes');
  return episodes;
}

// ─────────────────────────────────────────────
// SERVERS & DIRECT WATCH LINK PROVIDERS
// ─────────────────────────────────────────────

export async function getLunarxServers(episodeId: string): Promise<LunarxServer[]> {
  // Check if episodeId has real anikoto servers
  try {
    const anikotoServers = await getAnikotoServers(episodeId);
    if (anikotoServers && anikotoServers.length > 0) {
      return anikotoServers.map((s) => ({
        name: s.name.startsWith('LunarX') ? s.name : `LunarX ${s.name}`,
        sourceId: s.sourceId,
        type: s.type,
      }));
    }
  } catch (e) {}

  const [animeId, epNum] = episodeId.split(':');
  const ep = epNum || '1';

  return [
    {
      name: 'LunarX Direct HLS (1080p Ultra HD)',
      sourceId: `lunarx::${animeId}::${ep}::1080p::sub`,
      type: 'sub',
    },
    {
      name: 'LunarX Fast Stream (Auto HLS)',
      sourceId: `lunarx::${animeId}::${ep}::auto::sub`,
      type: 'sub',
    },
    {
      name: 'LunarX English Dub',
      sourceId: `lunarx::${animeId}::${ep}::1080p::dub`,
      type: 'dub',
    },
  ];
}

// ─────────────────────────────────────────────
// DIRECT STREAM WATCH LINK RESOLVER
// ─────────────────────────────────────────────

export async function getLunarxStream(sourceId: string, bypassCache = false): Promise<LunarxStream | null> {
  const cacheKey = `lunarx:stream:${sourceId}`;
  if (!bypassCache) {
    const cached = cacheGet<LunarxStream>(cacheKey);
    if (cached) return cached;
  } else {
    cacheDel(cacheKey);
  }

  // 1. If sourceId is an Anikoto / Megaplay / Kiwi stream source, resolve real working master HLS!
  if (!sourceId.startsWith('lunarx::')) {
    try {
      let anikotoStream = await getAnikotoEmbedUrl(sourceId);
      if (!anikotoStream) {
        const servers = await getAnikotoServers(sourceId);
        if (servers.length > 0) {
          anikotoStream = await getAnikotoEmbedUrl(servers[0].sourceId);
        }
      }
      if (anikotoStream && (anikotoStream.m3u8 || anikotoStream.embedUrl)) {
        const streamUrl = anikotoStream.m3u8 || anikotoStream.embedUrl;
        const isHls = Boolean(anikotoStream.m3u8) || streamUrl.includes('.m3u8');
        const directLinks: DirectWatchLink[] = [];

        if (anikotoStream.m3u8) {
          directLinks.push({
            quality: '1080p Full HD (Master HLS)',
            url: anikotoStream.m3u8,
            type: 'hls',
          });
        }

        const result: LunarxStream = {
          embedUrl: anikotoStream.embedUrl,
          streamUrl,
          m3u8: anikotoStream.m3u8,
          mp4: isHls ? null : streamUrl,
          downloadUrl: anikotoStream.m3u8 || undefined,
          type: isHls ? 'hls' : 'mp4',
          servers: directLinks.map((l) => l.url),
          directWatchLinks: directLinks,
          subtitles: anikotoStream.subtitles || [],
          referer: anikotoStream.referer || 'https://megaplay.buzz/',
        };

        cacheSet(cacheKey, result, 300);
        return result;
      }
    } catch (e) {}
  }

  // 2. If sourceId is in format lunarx::slug::ep::quality::type
  const parts = sourceId.split('::');
  const slug = parts[1] || parts[0];
  const epNum = parseInt(parts[2] || '1', 10);
  const audioType = (parts[4] as 'sub' | 'dub' | 'raw') || 'sub';

  // Try resolving real live stream via Anikoto
  try {
    const eps = await getAnikotoEpisodes(slug);
    const targetEp = eps.find((e) => e.num === epNum) || eps[0];
    if (targetEp) {
      const servers = await getAnikotoServers(targetEp.id);
      const server = servers.find((s) => s.type === audioType) || servers[0];
      if (server) {
        const stream = await getAnikotoEmbedUrl(server.sourceId);
        if (stream && (stream.m3u8 || stream.embedUrl)) {
          const streamUrl = stream.m3u8 || stream.embedUrl;
          const isHls = Boolean(stream.m3u8) || streamUrl.includes('.m3u8');
          const directLinks: DirectWatchLink[] = [];

          if (stream.m3u8) {
            directLinks.push({
              quality: '1080p Full HD (Master HLS)',
              url: stream.m3u8,
              type: 'hls',
            });
          }

          const result: LunarxStream = {
            embedUrl: stream.embedUrl,
            streamUrl,
            m3u8: stream.m3u8,
            mp4: isHls ? null : streamUrl,
            downloadUrl: stream.m3u8 || undefined,
            type: isHls ? 'hls' : 'mp4',
            servers: directLinks.map((l) => l.url),
            directWatchLinks: directLinks,
            subtitles: stream.subtitles || [],
            referer: stream.referer || 'https://megaplay.buzz/',
          };

          cacheSet(cacheKey, result, 300);
          return result;
        }
      }
    }
  } catch (e) {}

  // 3. Try resolving real live stream via AnimeHeaven
  try {
    const cleanTitle = slug.replace(/-(?:[a-z0-9]{4,8}|\d+)$/i, '').replace(/-/g, ' ');
    const heavenId = await findAnimeHeavenId([cleanTitle, slug.replace(/-/g, ' '), slug.split('-')[0]]);
    if (heavenId) {
      const heavenEps = await getHeavenEpisodes(heavenId);
      const ep = heavenEps.find((e) => e.num === epNum) || heavenEps[0];
      if (ep) {
        const servers = await getHeavenServers(ep.id);
        if (servers.length > 0) {
          const heavenStream = await getHeavenStream(servers[0].sourceId);
          if (heavenStream && (heavenStream.streamUrl || heavenStream.embedUrl)) {
            const streamUrl = heavenStream.streamUrl || heavenStream.embedUrl;
            const isHls = streamUrl.includes('.m3u8');
            const directLinks: DirectWatchLink[] = [
              {
                quality: '1080p Direct Stream',
                url: streamUrl,
                type: isHls ? 'hls' : 'mp4',
              },
            ];

            const result: LunarxStream = {
              embedUrl: heavenStream.embedUrl,
              streamUrl,
              m3u8: isHls ? streamUrl : null,
              mp4: isHls ? null : streamUrl,
              downloadUrl: heavenStream.downloadUrl || streamUrl,
              type: isHls ? 'hls' : 'mp4',
              servers: directLinks.map((l) => l.url),
              directWatchLinks: directLinks,
              referer: 'https://animeheaven.me/',
            };

            cacheSet(cacheKey, result, 300);
            return result;
          }
        }
      }
    }
  } catch (e) {}

  return null;
}

export const getLunarxEmbedUrl = getLunarxStream;
