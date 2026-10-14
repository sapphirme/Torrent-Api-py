import axios from 'axios';
import { Buffer } from 'buffer';
import zlib from 'zlib';
import { cacheGet, cacheSet } from '../utils/cache';
import { getProxyUrl, anilistClient } from '../utils/fetch';
import { getAnikotoEpisodes, getAnikotoServers, getAnikotoEmbedUrl } from './anikoto';
import { getEpisodes as getSenshiEpisodes, getServers as getSenshiServers, getSenshiEmbedUrl } from './senshi';
import { getSiteIds } from '../utils/mapper';

// ══════════════════════════════════════════════════════════════
// MIRURO PIPE CONFIGURATION
// ══════════════════════════════════════════════════════════════

const MIRURO_PIPE_URL = 'https://www.miruro.tv/api/secure/pipe';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  Referer: 'https://www.miruro.tv/',
  Origin: 'https://www.miruro.tv',
};

const PROVIDER_PRIORITY = ['bonk', 'kiwi', 'bee', 'bun', 'twin', 'ally', 'moo', 'cog', 'pewe', 'nun', 'telli', 'hop'];

export interface MiruroEpisode {
  num: number;
  id: string;
  title: string;
}

export interface MiruroServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub' | 'raw';
}

export interface MiruroEmbedResult {
  embedUrl: string;
  m3u8?: string;
  serverName: string;
  type: string;
  referer?: string;
}

interface PipeEpisode {
  id: string;
  number: number;
  title?: string;
}

interface PipeProviderData {
  meta?: { id?: string; title?: string; type?: string };
  episodes?: { sub?: PipeEpisode[]; dub?: PipeEpisode[]; raw?: PipeEpisode[] } | PipeEpisode[];
}

interface PipeData {
  providers?: Record<string, PipeProviderData>;
  malId?: number;
  kitsuId?: number;
  headers?: Record<string, string>;
  streams?: any[];
}

function encodePipeRequest(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePipeResponse(encodedStr: string): PipeData {
  const padded = encodedStr + '='.repeat((4 - (encodedStr.length % 4)) % 4);
  const compressed = Buffer.from(padded, 'base64url');
  const decompressed = zlib.gunzipSync(compressed);
  return JSON.parse(decompressed.toString('utf-8'));
}

function translateId(encodedId: string): string {
  try {
    const padded = encodedId + '='.repeat((4 - (encodedId.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64url').toString('utf-8');
    if (decoded.includes(':')) return decoded;
    return encodedId;
  } catch {
    return encodedId;
  }
}

function deepTranslate(obj: any): any {
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key === 'id' && typeof obj[key] === 'string') {
        obj[key] = translateId(obj[key]);
      } else if (typeof obj[key] === 'object') {
        deepTranslate(obj[key]);
      }
    }
  }
  return obj;
}

// ══════════════════════════════════════════════════════════════
// PIPE API CALLS WITH PRIMARY PROXY FALLBACK
// ══════════════════════════════════════════════════════════════

async function fetchRawEpisodes(anilistId: number): Promise<PipeData | null> {
  const cacheKey = `miruro:raw:${anilistId}`;
  const cached = cacheGet<PipeData>(cacheKey);
  if (cached) return cached;

  const payload = { path: 'episodes', method: 'GET', query: { anilistId }, body: null, version: '0.1.0' };
  const encodedReq = encodePipeRequest(payload);
  const url = `${MIRURO_PIPE_URL}?e=${encodedReq}`;

  // Direct fetch attempt
  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 8000,
      responseType: 'text',
      transformResponse: (d) => d,
    });
    const data = deepTranslate(decodePipeResponse(res.data));
    if (data?.providers && Object.keys(data.providers).length > 0) {
      cacheSet(cacheKey, data, 'episodes');
      return data;
    }
  } catch {}

  // Proxy fetch attempt via primary Cloudflare Worker proxy
  try {
    const proxyUrl = getProxyUrl(url);
    const res = await axios.get(proxyUrl, {
      timeout: 10000,
      responseType: 'text',
      transformResponse: (d) => d,
    });
    const data = deepTranslate(decodePipeResponse(res.data));
    if (data?.providers && Object.keys(data.providers).length > 0) {
      cacheSet(cacheKey, data, 'episodes');
      return data;
    }
  } catch {}

  return null;
}

async function fetchSources(rawEpisodeId: string, provider: string, anilistId: number, category: string): Promise<any> {
  const encId = Buffer.from(rawEpisodeId).toString('base64url');
  const payload = {
    path: 'sources',
    method: 'GET',
    query: { episodeId: encId, provider, category, anilistId },
    body: null,
    version: '0.1.0',
  };
  const encodedReq = encodePipeRequest(payload);
  const url = `${MIRURO_PIPE_URL}?e=${encodedReq}`;

  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 8000,
      responseType: 'text',
      transformResponse: (d) => d,
    });
    return deepTranslate(decodePipeResponse(res.data));
  } catch {}

  try {
    const proxyUrl = getProxyUrl(url);
    const res = await axios.get(proxyUrl, {
      timeout: 10000,
      responseType: 'text',
      transformResponse: (d) => d,
    });
    return deepTranslate(decodePipeResponse(res.data));
  } catch {}

  return null;
}

function episodesFor(provData: PipeProviderData, category: 'sub' | 'dub' | 'raw'): PipeEpisode[] {
  const episodes = provData.episodes;
  if (!episodes) return [];
  if (Array.isArray(episodes)) return category === 'sub' ? episodes : [];
  return episodes[category] ?? [];
}

// ══════════════════════════════════════════════════════════════
// PUBLIC SCRAPER API WITH GUARANTEED FALLBACKS
// ══════════════════════════════════════════════════════════════

export async function getMiruroEpisodes(anilistId: number): Promise<MiruroEpisode[]> {
  const data = await fetchRawEpisodes(anilistId);
  if (data?.providers) {
    const providers = data.providers;
    const order = [...PROVIDER_PRIORITY, ...Object.keys(providers).filter((p) => !PROVIDER_PRIORITY.includes(p))];
    let chosen: PipeEpisode[] = [];

    for (const provName of order) {
      const provData = providers[provName];
      if (!provData) continue;
      const eps = episodesFor(provData, 'sub');
      if (eps.length > 0) {
        chosen = eps;
        break;
      }
    }

    if (chosen.length > 0) {
      return chosen
        .filter((ep) => typeof ep.number === 'number' && ep.number > 0)
        .map((ep) => ({
          num: ep.number,
          id: `${anilistId}:${ep.number}`,
          title: ep.title || `Episode ${ep.number}`,
        }))
        .sort((a, b) => a.num - b.num);
    }
  }

  // FALLBACK: Query AniList GraphQL for episode count / metadata
  try {
    const query = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        episodes
        streamingEpisodes { title thumbnail url site }
      }
    }`;
    const res = await anilistClient.post('', { query, variables: { id: anilistId } });
    const media = res.data?.data?.Media;
    const count = media?.episodes || media?.streamingEpisodes?.length || 0;
    if (count > 0) {
      const eps: MiruroEpisode[] = [];
      for (let i = 1; i <= count; i++) {
        const streamTitle = media?.streamingEpisodes?.[i - 1]?.title;
        eps.push({
          num: i,
          id: `${anilistId}:${i}`,
          title: streamTitle || `Episode ${i}`,
        });
      }
      return eps;
    }
  } catch {}

  // Secondary fallback: AniZip API
  try {
    const res = await axios.get(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, { timeout: 5000 });
    const episodesObj = res.data?.episodes;
    if (episodesObj && typeof episodesObj === 'object') {
      const keys = Object.keys(episodesObj).map(Number).filter((n) => !isNaN(n) && n > 0);
      if (keys.length > 0) {
        keys.sort((a, b) => a - b);
        return keys.map((n) => ({
          num: n,
          id: `${anilistId}:${n}`,
          title: episodesObj[n]?.title?.en || episodesObj[n]?.title?.ja || `Episode ${n}`,
        }));
      }
    }
  } catch {}

  // Default fallback if no episode count available
  return [{ num: 1, id: `${anilistId}:1`, title: 'Episode 1' }];
}

export async function getMiruroServers(episodeId: string): Promise<MiruroServer[]> {
  const [anilistIdStr, numStr] = episodeId.split(':');
  const anilistId = parseInt(anilistIdStr);
  const num = parseInt(numStr) || 1;
  if (isNaN(anilistId)) return [];

  const data = await fetchRawEpisodes(anilistId);
  if (data?.providers) {
    const providers = data.providers;
    const servers: MiruroServer[] = [];

    for (const [provName, provData] of Object.entries(providers)) {
      for (const category of ['sub', 'dub', 'raw'] as const) {
        const eps = episodesFor(provData, category);
        const ep = eps.find((e) => e.number === num);
        if (ep) {
          servers.push({
            name: `${provName}-${category}`,
            sourceId: `${anilistId}::${provName}::${category}::${ep.id}`,
            type: category,
          });
        }
      }
    }

    if (servers.length > 0) return servers;
  }

  // FALLBACK: Provide Miruro provider server slots
  return [
    { name: 'kiwi-sub', sourceId: `${anilistId}::kiwi::sub::${num}`, type: 'sub' },
    { name: 'bonk-sub', sourceId: `${anilistId}::bonk::sub::${num}`, type: 'sub' },
    { name: 'bee-sub', sourceId: `${anilistId}::bee::sub::${num}`, type: 'sub' },
    { name: 'pewe-sub', sourceId: `${anilistId}::pewe::sub::${num}`, type: 'sub' },
    { name: 'anikoto-sub', sourceId: `${anilistId}::anikoto::sub::${num}`, type: 'sub' },
    { name: 'senshi-sub', sourceId: `${anilistId}::senshi::sub::${num}`, type: 'sub' },
  ];
}

export async function getMiruroEmbedUrl(sourceId: string): Promise<MiruroEmbedResult | null> {
  const parts = sourceId.split('::');
  if (parts.length < 4) return null;
  const [anilistIdStr, provider, category, ...rest] = parts;
  const rawEpisodeId = rest.join('::');
  const anilistId = parseInt(anilistIdStr);
  if (isNaN(anilistId)) return null;

  // Try direct Pipe sources if rawEpisodeId looks like a pipe ID
  if (rawEpisodeId.length > 8 && !/^\d+$/.test(rawEpisodeId)) {
    try {
      const data = await fetchSources(rawEpisodeId, provider, anilistId, category);
      const streams = data?.streams;
      if (Array.isArray(streams) && streams.length > 0) {
        const hlsStreams = streams.filter(
          (s) => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url) && s?.type === 'hls'
        );
        const candidates = hlsStreams.length > 0
          ? hlsStreams
          : streams.filter((s) => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url));

        const sorted = [...candidates].sort((a, b) => {
          if (a.default && !b.default) return -1;
          if (!a.default && b.default) return 1;
          if (a.isActive && !b.isActive) return -1;
          if (!a.isActive && b.isActive) return 1;
          const qa = parseInt(String(a.quality ?? '').replace(/\D/g, '')) || 0;
          const qb = parseInt(String(b.quality ?? '').replace(/\D/g, '')) || 0;
          return qb - qa;
        });

        const best = sorted[0];
        if (best) {
          const headerReferer =
            data?.headers?.Referer ?? data?.headers?.referer ?? data?.headers?.Origin ?? data?.headers?.origin;
          const referer =
            (typeof best.referer === 'string' && best.referer) ||
            (typeof headerReferer === 'string' && headerReferer) ||
            undefined;

          return {
            embedUrl: best.url,
            m3u8: best.type === 'hls' ? best.url : undefined,
            serverName: provider,
            type: best.type === 'hls' ? 'hls' : 'embed',
            referer,
          };
        }
      }
    } catch {}
  }

  // FALLBACK: Cross-resolve stream using mapped site providers (Anikoto or Senshi)
  const epNum = parseInt(rawEpisodeId) || 1;
  try {
    const siteIds = await getSiteIds(anilistId);
    if (siteIds) {
      // Try Anikoto first
      const anikotoSlug = siteIds.siteIds?.anikoto;
      if (anikotoSlug) {
        const episodes = await getAnikotoEpisodes(anikotoSlug);
        const episode = episodes.find((e) => Math.round(e.num) === epNum);
        if (episode) {
          const servers = await getAnikotoServers(episode.id);
          if (servers.length > 0) {
            const embed = await getAnikotoEmbedUrl(servers[0].sourceId);
            if (embed?.embedUrl) {
              const m3u8 = embed.m3u8 || undefined;
              return {
                embedUrl: embed.embedUrl,
                m3u8,
                serverName: provider || 'Miruro-Anikoto',
                type: m3u8 ? 'hls' : 'embed',
                referer: embed.referer || 'https://anikoto.net/',
              };
            }
          }
        }
      }

      // Try Senshi second
      if (siteIds.malId) {
        const senshiId = String(siteIds.malId);
        const episodes = await getSenshiEpisodes(senshiId);
        const episode = episodes.find((e) => Math.round(e.num) === epNum);
        if (episode) {
          const servers = await getSenshiServers(episode.id);
          if (servers.length > 0) {
            const embed = await getSenshiEmbedUrl(servers[0].sourceId);
            if (embed?.embedUrl) {
              const m3u8 = embed.type === 'hls' ? embed.embedUrl : undefined;
              return {
                embedUrl: embed.embedUrl,
                m3u8,
                serverName: provider || 'Miruro-Senshi',
                type: m3u8 ? 'hls' : 'embed',
                referer: embed.referer || 'https://senshi.live/',
              };
            }
          }
        }
      }
    }
  } catch {}

  return null;
}
