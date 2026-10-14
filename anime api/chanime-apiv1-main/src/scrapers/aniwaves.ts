import * as cheerio from 'cheerio';
import { makeClient, makeAjaxClient } from '../utils/fetch';
import { cacheGet, cacheSet } from '../utils/cache';
import axios from 'axios';

const BASE = 'https://aniwaves.ru';
const http = makeClient(BASE, BASE + '/');
const ajax = makeAjaxClient(BASE, BASE + '/');

export interface WaveEpisode {
  num: number;
  id: string;
  title: string;
}

export interface WaveServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub' | 'raw';
}

export interface WaveStream {
  embedUrl: string;
  streamUrl: string;
  m3u8: string | null;
  type: 'hls' | 'embed';
  directWatchLinks: { quality: string; url: string; type: string }[];
  referer: string;
}

function titleSlug(input: string): string {
  return input.replace(/-\d+$/, '').toLowerCase();
}

function serverType(raw: string): 'sub' | 'dub' | 'raw' {
  const value = raw.toLowerCase();
  if (value.includes('dub')) return 'dub';
  if (value.includes('raw')) return 'raw';
  return 'sub';
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

async function resolveWaveWatchId(animeId: string): Promise<string | null> {
  const direct = animeId.match(/-(\d{3,})$/)?.[1];
  if (direct) return direct;

  const query = titleSlug(animeId);
  const res = await http.get('/filter', { params: { keyword: query } });
  const $ = cheerio.load(res.data);
  const wanted = query.replace(/-/g, ' ');

  let fallback = '';
  let exact = '';
  $('a[href^="/watch/"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const id = href.match(/-(\d+)$/)?.[1] ?? '';
    const title = $(el).find('.name, .d-title').first().text().trim().toLowerCase()
      || $(el).attr('data-jp')?.toLowerCase()
      || '';
    if (id && !fallback) fallback = id;
    if (id && (title === wanted || href.includes(`/watch/${query}-`))) exact = id;
  });

  return exact || fallback || null;
}

export async function searchAniWaves(query: string): Promise<{ title: string; id: string; url: string }[]> {
  const clean = query.trim();
  if (!clean) return [];
  const cacheKey = `aniwaves:search:${clean.toLowerCase()}`;
  const cached = cacheGet<{ title: string; id: string; url: string }[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await http.get('/filter', { params: { keyword: clean } });
    const $ = cheerio.load(res.data);
    const results: { title: string; id: string; url: string }[] = [];

    $('.item').each((_, el) => {
      const a = $(el).find('a.name, a.d-title').first();
      const href = a.attr('href') ?? $(el).find('a[href^="/watch/"]').attr('href') ?? '';
      const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
      let title = a.text().trim();
      if (!title) {
        title = $(el).find('img').attr('alt') || '';
        title = title.replace(/\s*Japanese english subbed/gi, '').trim();
      }
      if (title && id && !results.some((r) => r.id === id)) results.push({ title, id, url: BASE + href });
    });

    cacheSet(cacheKey, results, 'episodes');
    return results;
  } catch {
    return [];
  }
}

export async function findAniWavesSlug(
  anilistId: number | string | null | undefined,
  titles: string | string[] = []
): Promise<string | null> {
  const titleList = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
  const candidates = Array.from(new Set([
    ...titleList,
    ...titleList.map((t) => t.split(/[:(|-]/)[0]?.trim()),
  ].filter((t): t is string => Boolean(t && t.length >= 2))));

  for (const q of candidates) {
    const results = await searchAniWaves(q);
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
    if (bestScore >= 85 && bestMatch) return bestMatch.id;
  }
  const fallback = await searchAniWaves(candidates[0]);
  if (fallback && fallback[0]) return fallback[0].id;
  return null;
}

export async function getWaveEpisodes(animeId: string): Promise<WaveEpisode[]> {
  const cacheKey = `wave:eps:${animeId}`;
  const cached = cacheGet<WaveEpisode[]>(cacheKey);
  if (cached) return cached;

  const watchId = await resolveWaveWatchId(animeId);
  if (!watchId) return [];

  try {
    const res = await ajax.get(`/ajax/episode/list/${watchId}`, {
      headers: { Referer: `${BASE}/watch/${animeId}` },
    });
    const html = res.data?.result ?? res.data?.html ?? (typeof res.data === 'string' ? res.data : '');
    const $ = cheerio.load(html);

    const episodes: WaveEpisode[] = [];
    $('a[data-ids][data-num]').each((_, el) => {
      const id = $(el).attr('data-ids') ?? '';
      const num = Number($(el).attr('data-num') ?? 0);
      const title = $(el).attr('title') ?? ($(el).text().replace(/\s+/g, ' ').trim() || `Episode ${num}`);
      if (id && num > 0) episodes.push({ num, id, title });
    });

    if (episodes.length > 0) cacheSet(cacheKey, episodes, 'episodes');
    return episodes;
  } catch {
    return [];
  }
}

export async function getWaveServers(episodeId: string): Promise<WaveServer[]> {
  const cacheKey = `wave:servers:${episodeId}`;
  const cached = cacheGet<WaveServer[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await ajax.get(`/ajax/server/list?servers=${episodeId}`);
    const html = res.data?.result ?? res.data?.html ?? '';
    const $ = cheerio.load(html);
    const servers: WaveServer[] = [];

    $('[data-link-id]').each((_, el) => {
      const sourceId = $(el).attr('data-link-id') ?? '';
      const group = $(el).closest('[data-type]').attr('data-type') ?? '';
      const name = $(el).text().replace(/\s+/g, ' ').trim() || `Server ${$(el).attr('data-sv-id') ?? ''}`.trim();
      if (sourceId) servers.push({ name, sourceId, type: serverType(group || name) });
    });

    if (servers.length > 0) cacheSet(cacheKey, servers, 60);
    return servers;
  } catch {
    return [];
  }
}

export async function getWaveEmbedUrl(sourceId: string): Promise<{ embedUrl: string; serverName: string } | null> {
  if (/^https?:\/\//i.test(sourceId)) return { embedUrl: sourceId, serverName: new URL(sourceId).hostname };

  try {
    const res = await ajax.get('/ajax/sources', {
      params: { id: sourceId, asi: 0, autoPlay: 0 },
    });
    const data = res.data?.result ?? res.data;
    if (data?.url) return { embedUrl: data.url, serverName: String(data.server ?? 'server') };
    if (data?.link) return { embedUrl: data.link, serverName: data.server ?? 'server' };
    return null;
  } catch {
    return null;
  }
}

export async function getAniWavesStream(sourceId: string): Promise<WaveStream | null> {
  const cacheKey = `aniwaves:stream:${sourceId}`;
  const cached = cacheGet<WaveStream>(cacheKey);
  if (cached) return cached;

  try {
    const resolved = await getWaveEmbedUrl(sourceId);
    if (!resolved?.embedUrl) return null;

    const embedUrl = resolved.embedUrl;
    let m3u8Url: string | null = null;

    // Check if embedUrl itself is m3u8
    if (embedUrl.includes('.m3u8')) {
      m3u8Url = embedUrl;
    } else {
      // Attempt to inspect embed page for m3u8
      try {
        const pageRes = await axios.get(embedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: `${BASE}/` },
          timeout: 5000,
        });
        const match = (pageRes.data || '').match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
        if (match && match[0]) m3u8Url = match[0];
      } catch {}
    }

    const result: WaveStream = {
      embedUrl,
      streamUrl: m3u8Url || embedUrl,
      m3u8: m3u8Url,
      type: m3u8Url ? 'hls' : 'embed',
      directWatchLinks: m3u8Url ? [{ quality: 'Auto', url: m3u8Url, type: 'hls' }] : [],
      referer: `${BASE}/`,
    };

    cacheSet(cacheKey, result, 60);
    return result;
  } catch {
    return null;
  }
}
