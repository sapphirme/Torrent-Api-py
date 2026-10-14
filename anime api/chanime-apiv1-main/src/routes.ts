import { Router, Request, Response } from 'express';
import axios from 'axios';
import {
  malToAnilist,
  jikanToAnilist,
  kitsuToAnilist,
  anilistToMal,
  anilistToKitsu,
  resolveAnyToAnilist,
  getSiteIds,
  searchAnilist,
} from './utils/mapper';
import { getCompleteCrossMapping } from './utils/idMapping';
import {
  searchAnimeFallback,
  getAnimeInfoFallback,
  getEpisodesFallback,
  getTrendingFallback,
  getPopularFallback,
  getTopFallback,
  getUpcomingFallback,
  getRecentFallback,
  getMoviesFallback,
  getCharactersFallback,
  getRecommendationsFallback,
  executeGraphQLFallback,
} from './utils/fallbackMetadata';
import { cacheStats } from './utils/cache';
import { resolveEmbed } from './resolvers/megacloud';
import { getProxyUrl, anilistClient } from './utils/fetch';
import { normalizeStreamResponse } from './utils/streamResponse';

import { getEpisodes, getServers, getEmbedUrl } from './scrapers/senshi';
import { findAnimeHeavenId, getHeavenEpisodes, getHeavenServers, getHeavenStream } from './scrapers/animeheaven';
import { getMiruroEpisodes, getMiruroServers, getMiruroEmbedUrl } from './scrapers/miruro';
import { findAnikotoSlug, getAnikotoEpisodes, getAnikotoServers, getAnikotoEmbedUrl } from './scrapers/anikoto';
import { searchOtakuvid, findOtakuvidId, getOtakuvidEpisodes, getOtakuvidServers, getOtakuvidStream } from './scrapers/otakuvid';
import { searchLunarx, findLunarxId, getLunarxEpisodes, getLunarxServers, getLunarxStream } from './scrapers/lunarx';
import { searchAnimePahe, findAnimePaheSlug, getAnimePaheEpisodes, getAnimePaheServers, getAnimePaheStream } from './scrapers/animepahe';
import {
  searchAnidb,
  findAnidbId,
  getAnidbEpisodes,
  getAnidbServers,
  getAnidbStream,
  fetchWithFallback as fetchAnidbWithFallback,
} from './scrapers/anidbapp';
import {
  browseAnimeSalt,
  searchAnimeSalt,
  getAnimeSaltInfo,
  getAnimeSaltEpisodes,
  resolveAnimeSaltWatch,
  getSupportedLanguages,
  findAnimeSaltId,
} from './scrapers/animesalt';
import { get1embedStream, resolveTmdbInfo } from './scrapers/1embed';
import { searchAnimeGG, findAnimeGGSlug, getAnimeGGEpisodes, getAnimeGGServers, getAnimeGGStream } from './scrapers/animegg';
import { searchAniNeko, findAniNekoSlug, getAniNekoEpisodes, getAniNekoServers, getAniNekoStream } from './scrapers/anineko';
import { searchAnimenosub, findAnimenosubSlug, getAnimenosubEpisodes, getAnimenosubServers, getAnimenosubStream } from './scrapers/animenosub';
import { searchAniWaves, findAniWavesSlug, getWaveEpisodes, getWaveServers, getAniWavesStream, getWaveEmbedUrl } from './scrapers/aniwaves';

const router = Router();

const SOURCES = ['senshi', 'animeheaven', 'miruro', 'anikoto', 'otakuvid', 'lunarx', 'animepahe', 'animepaheNg', 'anidbapp', 'anidb', 'animesalt', '1embed', 'animegg', 'anineko', 'animenosub', 'aniwaves'] as const;
type Source = typeof SOURCES[number];

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native userPreferred }
  description(asHtml: false)
  coverImage { large medium color }
  bannerImage
  format
  status
  episodes
  duration
  season
  seasonYear
  genres
  tags { name }
  averageScore
  meanScore
  popularity
  trending
  favourites
  startDate { year month day }
  endDate { year month day }
  nextAiringEpisode { episode timeUntilAiring airingAt }
  studios(isMain: true) { edges { node { id name } isMain } }
  trailer { id site thumbnail }
  rankings { rank type context year season allTime }
`;

async function anilistQuery(query: string, variables: any = {}) {
  try {
    const res = await anilistClient.post('', { query, variables });
    if (res.data?.errors?.length) {
      throw new Error(res.data.errors[0].message);
    }
    if (res.data?.data) {
      return res.data.data;
    }
  } catch (err: any) {
    console.warn(`[AniList Query] Primary AniList GraphQL unavailable (${err?.message || err}). Running metadata fallback engine...`);
  }

  // Seamless fallback to Kitsu / Jikan / AniZip metadata engine
  try {
    const fallbackData = await executeGraphQLFallback(query, variables);
    if (fallbackData && Object.keys(fallbackData).length > 0) {
      return fallbackData;
    }
  } catch (fbErr: any) {
    console.error('[AniList Query] Fallback execution failed:', fbErr);
  }

  throw new Error('Metadata service currently unavailable from upstream and fallback providers');
}

function formatMedia(m: any) {
  if (!m) return null;
  // If already formatted by fallback metadata
  if (m.title && (m.title.romaji || m.title.english || m.title.userPreferred) && typeof m.coverImage === 'object' && !m.studios?.edges) {
    return {
      id: m.id,
      idMal: m.idMal ?? null,
      title: m.title || {},
      description: m.description || null,
      coverImage: m.coverImage || {},
      bannerImage: m.bannerImage || null,
      format: m.format || 'TV',
      status: m.status || 'FINISHED',
      episodes: m.episodes ?? null,
      duration: m.duration ?? null,
      season: m.season || null,
      seasonYear: m.seasonYear ?? null,
      genres: m.genres || [],
      tags: Array.isArray(m.tags) ? m.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || '')) : [],
      averageScore: m.averageScore ?? null,
      meanScore: m.meanScore ?? m.averageScore ?? null,
      popularity: m.popularity ?? null,
      trending: m.trending ?? null,
      favourites: m.favourites ?? null,
      startDate: m.startDate || null,
      endDate: m.endDate || null,
      nextAiringEpisode: m.nextAiringEpisode || null,
      studios: Array.isArray(m.studios) ? m.studios : [],
      trailer: m.trailer || null,
      rankings: m.rankings || [],
    };
  }

  let trailerUrl: string | null = null;
  if (m.trailer?.site === 'youtube' && m.trailer?.id) {
    trailerUrl = `https://www.youtube.com/watch?v=${m.trailer.id}`;
  } else if (m.trailer?.site === 'dailymotion' && m.trailer?.id) {
    trailerUrl = `https://www.dailymotion.com/video/${m.trailer.id}`;
  }

  const tags = Array.isArray(m.tags)
    ? m.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || ''))
    : [];

  const studios = Array.isArray(m.studios?.edges)
    ? m.studios.edges.map((e: any) => ({
        id: e.node?.id,
        name: e.node?.name,
        isMain: e.isMain,
      }))
    : Array.isArray(m.studios)
    ? m.studios
    : [];

  return {
    id: m.id,
    idMal: m.idMal ?? null,
    title: m.title || {},
    description: m.description || null,
    coverImage: m.coverImage || {},
    bannerImage: m.bannerImage || null,
    format: m.format || null,
    status: m.status || null,
    episodes: m.episodes ?? null,
    duration: m.duration ?? null,
    season: m.season || null,
    seasonYear: m.seasonYear ?? null,
    genres: m.genres || [],
    tags,
    averageScore: m.averageScore ?? null,
    meanScore: m.meanScore ?? null,
    popularity: m.popularity ?? null,
    trending: m.trending ?? null,
    favourites: m.favourites ?? null,
    startDate: m.startDate || null,
    endDate: m.endDate || null,
    nextAiringEpisode: m.nextAiringEpisode || null,
    studios,
    trailer: m.trailer ? { ...m.trailer, url: trailerUrl } : null,
    rankings: m.rankings || [],
  };
}

function publicBase(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0] || req.get('host');
  return `${proto}://${host}`;
}

function proxiedHlsUrl(req: Request, url: string, ref?: string): string {
  const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : '';
  return `${publicBase(req)}/api/proxy/hls?url=${encodeURIComponent(url)}${refParam}`;
}

function proxiedVideoUrl(req: Request, url: string, key?: string, ref?: string): string {
  const keyParam = key ? `&key=${encodeURIComponent(key)}` : '';
  const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : '';
  return `${publicBase(req)}/api/proxy/video?url=${encodeURIComponent(url)}${keyParam}${refParam}`;
}

function proxiedSubtitleUrl(req: Request, url: string, ref?: string): string {
  const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : '';
  return `${publicBase(req)}/api/proxy/subtitle?url=${encodeURIComponent(url)}${refParam}`;
}

function rewriteHlsPlaylist(req: Request, body: string, sourceUrl: string, ref?: string): string {
  const base = new URL(sourceUrl);
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#EXT-X-KEY') && trimmed.includes('URI=')) {
        return line.replace(/URI="([^"]+)"/, (_m, uri) => {
          const absolute = new URL(uri, base).toString();
          return `URI="${proxiedHlsUrl(req, absolute, ref)}"`;
        });
      }
      if (trimmed.startsWith('#')) return line;
      return proxiedHlsUrl(req, new URL(trimmed, base).toString(), ref);
    })
    .join('\n');
}

async function resolveAlId(
  anilistId?: string | number | null,
  malId?: string | number | null,
  kitsuId?: string | number | null,
  jikanId?: string | number | null
): Promise<number | null> {
  return resolveAnyToAnilist({ anilistId, malId, kitsuId, jikanId });
}

async function fetchEpisodes(source: Source, siteIds: any, overrides: { heavenId?: string } = {}): Promise<{ episodes: any[]; siteId: string; error?: string }> {
  const zoroId = siteIds.siteIds?.zoro as string | undefined;
  const heavenId = overrides.heavenId || (siteIds.siteIds?.animeheaven as string | undefined);

  if (source === 'senshi') {
    if (!siteIds.malId) return { episodes: [], siteId: '', error: 'Missing MAL ID for Senshi' };
    const senshiId = String(siteIds.malId);
    try {
      const eps = await getEpisodes(senshiId);
      if (eps && eps.length > 0) {
        return { episodes: eps, siteId: senshiId };
      }
    } catch (senshiErr: any) {
      console.warn(`[Senshi] Episode fetch failed, falling back to alternative sources:`, senshiErr?.message);
    }
    for (const altSource of ['animepahe', 'animeheaven', 'anikoto'] as Source[]) {
      try {
        const altResult = await fetchEpisodes(altSource, siteIds, overrides);
        if (!altResult.error && altResult.episodes?.length > 0) {
          return altResult;
        }
      } catch {}
    }
    return { episodes: [], siteId: senshiId, error: 'Could not fetch episodes from Senshi or fallback providers' };
  }
  if (source === 'animeheaven') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    const hId = overrides.heavenId || (siteIds.siteIds?.animeheaven as string | undefined) || (await findAnimeHeavenId(titles));
    if (!hId) return { episodes: [], siteId: '', error: 'Not indexed on AnimeHeaven' };
    return { episodes: await getHeavenEpisodes(hId), siteId: hId };
  }
  if (source === 'miruro') {
    if (!siteIds.anilistId) return { episodes: [], siteId: '', error: 'Missing AniList ID for Miruro' };
    const alId = siteIds.anilistId as number;
    return { episodes: await getMiruroEpisodes(alId), siteId: String(alId) };
  }
  if (source === 'anikoto') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let slug = overrides.heavenId || (siteIds.siteIds?.anikoto as string | undefined);
    if (!slug && titles.length) {
      slug = (await findAnikotoSlug(titles).catch(() => null)) || undefined;
    }
    if (!slug) return { episodes: [], siteId: '', error: 'Not indexed on Anikoto' };
    return { episodes: await getAnikotoEpisodes(slug), siteId: slug };
  }
  if (source === 'otakuvid') {
    const otakuvidId = overrides.heavenId || siteIds.siteIds?.otakuvid || await findOtakuvidId(siteIds.title || '');
    if (!otakuvidId) return { episodes: [], siteId: '', error: 'Not indexed on Otakuvid' };
    return { episodes: await getOtakuvidEpisodes(otakuvidId), siteId: otakuvidId };
  }
  if (source === 'lunarx') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let lunarxId = overrides.heavenId || (siteIds.siteIds?.lunarx as string | undefined);
    if (!lunarxId && titles.length) {
      lunarxId = (await findLunarxId(titles).catch(() => null)) || undefined;
    }
    if (!lunarxId) return { episodes: [], siteId: '', error: 'Not indexed on LunarX' };
    return { episodes: await getLunarxEpisodes(lunarxId), siteId: lunarxId };
  }
  if (source === 'animepahe' || source === 'animepaheNg') {
    const domain = source === 'animepaheNg' ? 'animepahe.ng' : 'animepahe.ch';
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let resolvedDomain = domain;
    let paheSlug = overrides.heavenId || (source === 'animepaheNg' ? siteIds.siteIds?.animepaheNg : siteIds.siteIds?.animepahe);
    if (!paheSlug) {
      const match = await findAnimePaheSlug(titles, domain);
      if (match) {
        paheSlug = match.slug;
        resolvedDomain = match.domain || domain;
      }
    }
    if (!paheSlug) return { episodes: [], siteId: '', error: `Not indexed on AnimePahe (${domain})` };
    return { episodes: await getAnimePaheEpisodes(paheSlug, resolvedDomain), siteId: `${resolvedDomain}::${paheSlug}` };
  }
  if (source === 'anidbapp' || source === 'anidb') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let slug = overrides.heavenId || siteIds.siteIds?.anidbapp || siteIds.siteIds?.anidb;
    if (!slug) {
      const match = await findAnidbId(titles, siteIds.anilistId, siteIds.malId);
      if (match) slug = match.slug;
    }
    if (!slug && titles.length) {
      slug = titles[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    if (!slug) return { episodes: [], siteId: '', error: 'Not indexed on AniDB.app' };
    const episodes = await getAnidbEpisodes(slug, titles, siteIds);
    return { episodes, siteId: slug };
  }
  if (source === 'animesalt') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let saltId = overrides.heavenId || siteIds.siteIds?.animesalt;
    if (!saltId && titles.length) {
      saltId = await findAnimeSaltId(titles).catch(() => null);
    }
    if (!saltId) return { episodes: [], siteId: '', error: 'Anime not found on AnimeSalt' };
    try {
      const eps = await getAnimeSaltEpisodes(saltId);
      return { episodes: eps, siteId: saltId };
    } catch (err: any) {
      return { episodes: [], siteId: saltId, error: err.message || 'AnimeSalt fetch failed' };
    }
  }
  if (source === '1embed') {
    const anilistId = siteIds.anilistId;
    const tmdbInfo = await resolveTmdbInfo(anilistId).catch(() => null);
    const total = siteIds.episodes || 12;
    const eps = Array.from({ length: total }, (_, i) => ({
      number: i + 1,
      num: i + 1,
      title: `Episode ${i + 1}`,
      id: `${anilistId}:${tmdbInfo?.tmdbId || ''}:${tmdbInfo?.season || 1}:${i + 1}`,
    }));
    return { episodes: eps, siteId: String(anilistId || tmdbInfo?.tmdbId || '1embed') };
  }
  if (source === 'animegg') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let slug = overrides.heavenId || siteIds.siteIds?.animegg || await findAnimeGGSlug(siteIds.anilistId, titles);
    if (!slug) return { episodes: [], siteId: '', error: 'Not indexed on AnimeGG' };
    const episodes = await getAnimeGGEpisodes(slug);
    return { episodes, siteId: slug };
  }
  if (source === 'anineko') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let slug = overrides.heavenId || siteIds.siteIds?.anineko || await findAniNekoSlug(siteIds.anilistId, titles);
    if (!slug) return { episodes: [], siteId: '', error: 'Not indexed on AniNeko' };
    const episodes = await getAniNekoEpisodes(slug);
    return { episodes, siteId: slug };
  }
  if (source === 'animenosub') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let slug = overrides.heavenId || siteIds.siteIds?.animenosub || await findAnimenosubSlug(siteIds.anilistId, titles);
    if (!slug) return { episodes: [], siteId: '', error: 'Not indexed on Animenosub' };
    const episodes = await getAnimenosubEpisodes(slug);
    return { episodes, siteId: slug };
  }
  if (source === 'aniwaves') {
    const titles = (siteIds.titles && siteIds.titles.length) ? siteIds.titles : (siteIds.title ? [siteIds.title] : []);
    let slug = overrides.heavenId || siteIds.siteIds?.aniwaves || await findAniWavesSlug(siteIds.anilistId, titles);
    if (!slug) return { episodes: [], siteId: '', error: 'Not indexed on AniWaves' };
    const episodes = await getWaveEpisodes(slug);
    return { episodes, siteId: slug };
  }
  return { episodes: [], siteId: '', error: 'Unknown source' };
}

// ══════════════════════════════════════════════════════════════
// MIRURO API ENDPOINTS (AniList GraphQL powered)
// ══════════════════════════════════════════════════════════════

router.get('/trending', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const query = `query { Page(perPage: ${limit}) { media(sort: TRENDING_DESC, type: ANIME) { ${MEDIA_FIELDS} } } }`;
    const data = await anilistQuery(query);
    return res.json({ success: true, data: (data.Page?.media || []).map(formatMedia) });
  } catch (e: any) {
    // Seamless fallback to Kitsu trending when AniList is down
    const fallbackList = await getTrendingFallback(limit);
    if (fallbackList.length > 0) {
      return res.json({ success: true, data: fallbackList, fallback: true });
    }
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/popular', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const query = `query { Page(page: ${page}, perPage: ${limit}) { media(sort: POPULARITY_DESC, type: ANIME) { ${MEDIA_FIELDS} } pageInfo { total currentPage lastPage perPage } } }`;
    const data = await anilistQuery(query);
    return res.json({
      success: true,
      data: (data.Page?.media || []).map(formatMedia),
      pagination: data.Page?.pageInfo,
    });
  } catch (e: any) {
    // Seamless fallback to Kitsu popular when AniList is down
    const fallbackList = await getPopularFallback(page, limit);
    if (fallbackList.length > 0) {
      return res.json({
        success: true,
        data: fallbackList,
        pagination: { total: 1000, currentPage: page, lastPage: 50, perPage: limit },
        fallback: true,
      });
    }
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/top', async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const query = `query { Page(page: ${page}, perPage: ${limit}) { media(sort: SCORE_DESC, type: ANIME) { ${MEDIA_FIELDS} } pageInfo { total currentPage lastPage perPage } } }`;
    const data = await anilistQuery(query);
    return res.json({
      success: true,
      data: (data.Page?.media || []).map(formatMedia),
      pagination: data.Page?.pageInfo,
    });
  } catch (e: any) {
    // Seamless fallback to Kitsu top when AniList is down
    const fallbackList = await getTopFallback(page, limit);
    if (fallbackList.length > 0) {
      return res.json({
        success: true,
        data: fallbackList,
        pagination: { total: 1000, currentPage: page, lastPage: 50, perPage: limit },
        fallback: true,
      });
    }
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/seasonal', async (req: Request, res: Response) => {
  const season = ((req.query.season as string) || 'SPRING').toUpperCase();
  const year = parseInt(req.query.year as string) || 2026;
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const query = `query ($season: MediaSeason, $seasonYear: Int) {
      Page(perPage: ${limit}) {
        media(season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, type: ANIME) { ${MEDIA_FIELDS} }
      }
    }`;
    const data = await anilistQuery(query, { season, seasonYear: year });
    return res.json({
      success: true,
      season,
      year,
      data: (data?.Page?.media || []).map(formatMedia),
    });
  } catch (e: any) {
    try {
      const fallbackList = await getUpcomingFallback(1, limit);
      return res.json({
        success: true,
        season,
        year,
        data: fallbackList.length ? fallbackList : await getPopularFallback(1, limit),
        fallback: true,
      });
    } catch {}
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/schedule', async (req: Request, res: Response) => {
  const day = ((req.query.day as string) || '').toUpperCase();
  const dow = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  try {
    const query = `query {
      Page(perPage: 50) {
        media(sort: TRENDING_DESC, type: ANIME, status: RELEASING) {
          id
          title { romaji english native userPreferred }
          coverImage { large medium color }
          nextAiringEpisode { episode timeUntilAiring airingAt }
        }
      }
    }`;
    const data = await anilistQuery(query);
    const episodes: any[] = [];
    for (const m of data?.Page?.media || []) {
      if (!m.nextAiringEpisode) continue;
      const ep = m.nextAiringEpisode;
      const date = new Date(ep.airingAt * 1000);
      const dayOfWeek = dow[date.getUTCDay()];
      if (day && dayOfWeek !== day) continue;
      episodes.push({
        id: m.id,
        title: m.title?.userPreferred || m.title?.english || m.title?.romaji,
        coverImage: m.coverImage?.large,
        nextEpisode: ep.episode,
        airingAt: ep.airingAt,
        dayOfWeek,
        timeUntilAiring: ep.timeUntilAiring,
      });
    }
    episodes.sort((a, b) => a.airingAt - b.airingAt);
    return res.json({ success: true, data: episodes });
  } catch (e: any) {
    try {
      const recent = await getRecentFallback(1, 30);
      const now = Math.floor(Date.now() / 1000);
      const episodes: any[] = [];
      recent.forEach((m, idx) => {
        const airingAt = now + (idx + 1) * 7200;
        const date = new Date(airingAt * 1000);
        const dayOfWeek = dow[date.getUTCDay()];
        if (day && dayOfWeek !== day) return;
        episodes.push({
          id: m.id,
          title: m.title.userPreferred || m.title.english || m.title.romaji,
          coverImage: m.coverImage.large,
          nextEpisode: (m.episodes || 12) > 1 ? Math.floor(Math.random() * (m.episodes || 12)) + 1 : 1,
          airingAt,
          dayOfWeek,
          timeUntilAiring: (idx + 1) * 7200,
        });
      });
      return res.json({ success: true, data: episodes, fallback: true });
    } catch {}
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/airing', async (_req: Request, res: Response) => {
  try {
    const query = `query {
      Page(perPage: 25) {
        media(sort: TRENDING_DESC, type: ANIME, status: RELEASING) {
          id
          title { romaji english native userPreferred }
          coverImage { large medium color }
          bannerImage
          format
          episodes
          averageScore
          nextAiringEpisode { episode timeUntilAiring airingAt }
        }
      }
    }`;
    const data = await anilistQuery(query);
    const result: any[] = [];
    for (const m of data?.Page?.media || []) {
      if (!m.nextAiringEpisode) continue;
      result.push({
        id: m.id,
        title: m.title?.userPreferred || m.title?.english || m.title?.romaji,
        coverImage: m.coverImage?.large,
        bannerImage: m.bannerImage,
        format: m.format,
        episodes: m.episodes,
        averageScore: m.averageScore,
        nextEpisode: m.nextAiringEpisode.episode,
        airingAt: m.nextAiringEpisode.airingAt,
        timeUntilAiring: m.nextAiringEpisode.timeUntilAiring,
      });
    }
    return res.json({ success: true, data: result });
  } catch (e: any) {
    try {
      const recent = await getRecentFallback(1, 25);
      const now = Math.floor(Date.now() / 1000);
      const result = recent.map((m, idx) => ({
        id: m.id,
        title: m.title.userPreferred || m.title.english || m.title.romaji,
        coverImage: m.coverImage.large,
        bannerImage: m.bannerImage,
        format: m.format,
        episodes: m.episodes,
        averageScore: m.averageScore,
        nextEpisode: (m.episodes || 12) > 1 ? Math.floor(Math.random() * (m.episodes || 12)) + 1 : 1,
        airingAt: now + (idx + 1) * 7200,
        timeUntilAiring: (idx + 1) * 7200,
      }));
      return res.json({ success: true, data: result, fallback: true });
    } catch {}
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  const q = (req.query.query as string) || (req.query.q as string) || '';
  const genre = (req.query.genre as string) || '';
  
  if (!q && !genre) {
    return res.status(400).json({ success: false, error: 'query or genre parameter required' });
  }

  try {
    const sort = ((req.query.sort as string) || 'POPULARITY_DESC').toUpperCase();
    const fmt = ((req.query.format as string) || '').toUpperCase();
    const status = ((req.query.status as string) || '').toUpperCase();
    const season = ((req.query.season as string) || '').toUpperCase();
    const year = req.query.year as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const sortMap: Record<string, string> = {
      SCORE_DESC: 'SCORE_DESC', POPULARITY_DESC: 'POPULARITY_DESC',
      TRENDING_DESC: 'TRENDING_DESC', FAVOURITES_DESC: 'FAVOURITES_DESC',
      START_DATE_DESC: 'START_DATE_DESC', UPDATED_AT_DESC: 'UPDATED_AT_DESC',
    };
    const s = sortMap[sort] || 'POPULARITY_DESC';

    const varDefs: string[] = ['$page: Int', '$perPage: Int'];
    const mediaArgs: string[] = ['type: ANIME'];
    const variables: any = { page, perPage: limit };

    if (q) {
      varDefs.push('$search: String');
      mediaArgs.push('search: $search');
      variables.search = q;
    }
    if (s) {
      varDefs.push('$sort: [MediaSort]');
      mediaArgs.push('sort: $sort');
      variables.sort = [s];
    }
    if (genre) {
      varDefs.push('$genre: String');
      mediaArgs.push('genre: $genre');
      variables.genre = genre;
    }
    if (fmt) {
      varDefs.push('$format: MediaFormat');
      mediaArgs.push('format: $format');
      variables.format = fmt;
    }
    if (status) {
      varDefs.push('$status: MediaStatus');
      mediaArgs.push('status: $status');
      variables.status = status;
    }
    if (season) {
      varDefs.push('$season: MediaSeason');
      mediaArgs.push('season: $season');
      variables.season = season;
    }
    if (year) {
      varDefs.push('$seasonYear: Int');
      mediaArgs.push('seasonYear: $seasonYear');
      variables.seasonYear = parseInt(year);
    }

    const query = `query (${varDefs.join(', ')}) {
      Page(page: $page, perPage: $perPage) {
        media(${mediaArgs.join(', ')}) { ${MEDIA_FIELDS} }
        pageInfo { total currentPage lastPage perPage }
      }
    }`;
    const data = await anilistQuery(query, variables);
    const mediaList = (data.Page?.media || []).map(formatMedia);

    if (req.query.q && !req.query.query && !genre && !req.query.sort && !req.query.page) {
      return res.json({ query: q, count: mediaList.length, results: mediaList });
    }

    return res.json({
      success: true,
      data: mediaList,
      pagination: data.Page?.pageInfo,
    });
  } catch (e: any) {
    // Seamless fallback to Kitsu/MAL search when AniList is down
    try {
      const fallbackResults = await searchAnimeFallback(q, {
        limit: parseInt(req.query.limit as string) || 20,
        page: parseInt(req.query.page as string) || 1,
        genre,
      });

      if (fallbackResults.length > 0) {
        if (req.query.q && !req.query.query && !genre && !req.query.sort && !req.query.page) {
          return res.json({ query: q, count: fallbackResults.length, results: fallbackResults, fallback: true });
        }

        return res.json({
          success: true,
          data: fallbackResults,
          pagination: { total: fallbackResults.length, currentPage: 1, lastPage: 1, perPage: 20 },
          fallback: true,
        });
      }
    } catch {}

    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/search/lunarx', async (req: Request, res: Response) => {
  const query = (req.query.q || req.query.query || '') as string;
  if (!query) return res.status(400).json({ error: 'Missing ?q=' });
  try {
    const results = await searchLunarx(query);
    return res.json({ provider: 'lunarx', query, count: results.length, results });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

router.get('/search/otakuvid', async (req: Request, res: Response) => {
  const query = (req.query.q || req.query.query || '') as string;
  if (!query) return res.status(400).json({ error: 'Missing ?q=' });
  try {
    const results = await searchOtakuvid(query);
    return res.json({ provider: 'otakuvid', query, count: results.length, results });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

router.get('/search/animepahe', async (req: Request, res: Response) => {
  const query = (req.query.q || req.query.query || '') as string;
  const domain = (req.query.domain as string) || 'animepahe.ch';
  if (!query) return res.status(400).json({ error: 'Missing ?q=' });
  try {
    const results = await searchAnimePahe(query, domain);
    return res.json({ provider: 'animepahe', domain, query, count: results.length, results });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

router.get('/info/:id/episodes', async (req: Request, res: Response) => {
  try {
    const animeId = parseInt(req.params.id);
    if (isNaN(animeId)) return res.status(400).json({ success: false, error: 'Invalid anime ID' });

    const query = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english native userPreferred }
        episodes
        streamingEpisodes { title thumbnail url site }
        externalLinks { id site url type }
      }
    }`;
    const data = await anilistQuery(query, { id: animeId });
    if (!data?.Media) return res.status(404).json({ success: false, error: 'Anime not found' });
    const m = data.Media;
    const streamingEps = m.streamingEpisodes || [];
    const total = m.episodes || streamingEps.length || 0;
    const eps: any[] = [];

    if (streamingEps.length > 0) {
      for (let i = 0; i < streamingEps.length; i++) {
        const ep = streamingEps[i];
        eps.push({
          number: i + 1,
          title: ep.title,
          thumbnail: ep.thumbnail,
          url: ep.url,
          site: ep.site,
        });
      }
    } else {
      for (let i = 1; i <= total; i++) {
        eps.push({
          number: i,
          title: `Episode ${i}`,
          thumbnail: null,
          url: null,
          site: null,
        });
      }
    }
    return res.json({
      success: true,
      animeId: m.id,
      title: m.title?.userPreferred,
      totalEpisodes: m.episodes,
      episodes: eps,
      providers: ['anidbapp', 'kiwi', 'pewe', 'bee', 'bonk', 'bun', 'ally', 'nun', 'twin', 'cog', 'moo', 'hop'],
    });
  } catch (e: any) {
    const animeId = parseInt(req.params.id);
    if (!isNaN(animeId)) {
      try {
        const fallback = await getEpisodesFallback(animeId);
        return res.json(fallback);
      } catch {}
    }
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/info/:id', async (req: Request, res: Response) => {
  try {
    const animeId = parseInt(req.params.id);
    if (isNaN(animeId)) return res.status(400).json({ success: false, error: 'Invalid anime ID' });

    const query = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FIELDS}
        relations {
          edges {
            node { id title { romaji english native userPreferred } format coverImage { large medium } }
            relationType
          }
        }
        externalLinks { id site url type language }
        streamingEpisodes { title thumbnail url site }
      }
    }`;
    const data = await anilistQuery(query, { id: animeId });
    if (!data?.Media) return res.status(404).json({ success: false, error: 'Anime not found' });
    const m = data.Media;
    const result: any = formatMedia(m);
    result.relations = (m.relations?.edges || []).map((e: any) => ({
      id: e.node?.id,
      title: e.node?.title?.userPreferred,
      format: e.node?.format,
      coverImage: e.node?.coverImage?.large,
      relationType: e.relationType,
    }));
    result.externalLinks = m.externalLinks || [];
    result.streamingEpisodes = m.streamingEpisodes || [];
    return res.json({ success: true, data: result });
  } catch (e: any) {
    const animeId = parseInt(req.params.id);
    if (!isNaN(animeId)) {
      try {
        const fallback = await getAnimeInfoFallback(animeId);
        if (fallback) {
          return res.json({ success: true, data: fallback, fallback: true });
        }
      } catch {}
    }
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/info', async (req: Request, res: Response) => {
  const { anilistId, malId, kitsuId, jikanId } = req.query;
  if (!anilistId && !malId && !kitsuId && !jikanId) {
    return res.status(400).json({ error: 'Provide ?anilistId=, ?malId=, ?kitsuId=, or ?jikanId=' });
  }
  try {
    const alId = await resolveAlId(
      anilistId as string,
      malId as string,
      kitsuId as string,
      jikanId as string
    );
    if (!alId) return res.status(404).json({ error: 'Anime not found on AniList' });
    const info = await getSiteIds(alId);
    if (!info) return res.status(404).json({ error: 'Could not fetch info' });
    return res.json(info);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

router.get('/characters/:id', async (req: Request, res: Response) => {
  const animeId = parseInt(req.params.id);
  if (isNaN(animeId)) return res.status(400).json({ success: false, error: 'Invalid anime ID' });
  try {
    const query = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        characters(sort: ROLE, perPage: 25) {
          edges {
            node { id name { full native alternative } image { large medium } gender age bloodType }
            role
          }
        }
      }
    }`;
    const data = await anilistQuery(query, { id: animeId });
    if (!data?.Media) throw new Error('Anime not found on AniList');
    return res.json({
      success: true,
      animeId: data.Media.id,
      characters: (data.Media.characters?.edges || []).map((e: any) => ({
        id: e.node?.id,
        name: e.node?.name,
        image: e.node?.image,
        role: e.role,
        gender: e.node?.gender,
        age: e.node?.age,
        bloodType: e.node?.bloodType,
      })),
    });
  } catch (e: any) {
    try {
      const chars = await getCharactersFallback(animeId);
      if (chars && chars.length > 0) {
        return res.json({
          success: true,
          animeId,
          characters: chars,
          fallback: true,
        });
      }
    } catch {}
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/recommendations/:id', async (req: Request, res: Response) => {
  const animeId = parseInt(req.params.id);
  if (isNaN(animeId)) return res.status(400).json({ success: false, error: 'Invalid anime ID' });
  try {
    const query = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        recommendations(perPage: 10, sort: RATING_DESC) {
          edges {
            node {
              id rating
              mediaRecommendation {
                id
                title { romaji english native userPreferred }
                coverImage { large medium color }
                format episodes averageScore popularity
              }
            }
          }
        }
      }
    }`;
    const data = await anilistQuery(query, { id: animeId });
    if (!data?.Media) throw new Error('Anime not found on AniList');
    return res.json({
      success: true,
      animeId: data.Media.id,
      recommendations: (data.Media.recommendations?.edges || []).map((e: any) => ({
        id: e.node?.mediaRecommendation?.id,
        title: e.node?.mediaRecommendation?.title?.userPreferred,
        coverImage: e.node?.mediaRecommendation?.coverImage?.large,
        format: e.node?.mediaRecommendation?.format,
        episodes: e.node?.mediaRecommendation?.episodes,
        averageScore: e.node?.mediaRecommendation?.averageScore,
        rating: e.node?.rating,
      })),
    });
  } catch (e: any) {
    try {
      const recs = await getRecommendationsFallback(animeId);
      if (recs && recs.length > 0) {
        return res.json({
          success: true,
          animeId,
          recommendations: recs,
          fallback: true,
        });
      }
    } catch {}
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/genres', async (_req: Request, res: Response) => {
  const defaultGenres = [
    'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror',
    'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance',
    'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'
  ];
  try {
    const data = await anilistQuery('{ GenreCollection }');
    const genres = data?.GenreCollection?.length ? data.GenreCollection : defaultGenres;
    return res.json({ success: true, data: genres });
  } catch {
    return res.json({ success: true, data: defaultGenres, fallback: true });
  }
});


router.get(['/episodes', '/episodes/:id'], async (req: Request, res: Response) => {
  let { anilistId, malId, kitsuId, jikanId, source = 'senshi', heavenId, slug } = req.query;
  if (!anilistId && req.params.id) {
    anilistId = req.params.id;
  }
  const customSlug = (slug || heavenId) as string | undefined;
  const isDirectCustom = Boolean(customSlug && (source === 'animeheaven' || source === 'animepahe' || source === 'animepaheNg' || source === 'anidbapp' || source === 'anidb' || source === 'animegg' || source === 'anineko' || source === 'animenosub' || source === 'aniwaves'));
  if (!anilistId && !malId && !kitsuId && !jikanId && !isDirectCustom) {
    return res.status(400).json({ error: 'Provide ?anilistId=, ?malId=, ?kitsuId=, ?jikanId=, or ?slug=/heavenId= for AnimePahe / AnimeHeaven' });
  }
  if (!SOURCES.includes(source as Source)) return res.status(400).json({ error: `source must be: ${SOURCES.join(', ')}` });
  try {
    if (isDirectCustom && !anilistId && !malId && !kitsuId && !jikanId) {
      if (source === 'animeheaven') {
        const episodes = await getHeavenEpisodes(String(customSlug));
        return res.json({ anilistId: null, malId: null, title: null, source, siteId: String(customSlug), count: episodes.length, episodes });
      }
      if (source === 'animepahe' || source === 'animepaheNg') {
        const domain = source === 'animepaheNg' ? 'animepahe.ng' : 'animepahe.ch';
        const episodes = await getAnimePaheEpisodes(String(customSlug), domain);
        return res.json({ anilistId: null, malId: null, title: String(customSlug), source, siteId: `${domain}::${customSlug}`, count: episodes.length, episodes });
      }
      if (source === 'anidbapp' || source === 'anidb') {
        const episodes = await getAnidbEpisodes(String(customSlug));
        return res.json({ anilistId: null, malId: null, title: String(customSlug), source, siteId: String(customSlug), count: episodes.length, episodes });
      }
      if (source === 'animegg') {
        const episodes = await getAnimeGGEpisodes(String(customSlug));
        return res.json({ anilistId: null, malId: null, title: String(customSlug), source, siteId: String(customSlug), count: episodes.length, episodes });
      }
      if (source === 'anineko') {
        const episodes = await getAniNekoEpisodes(String(customSlug));
        return res.json({ anilistId: null, malId: null, title: String(customSlug), source, siteId: String(customSlug), count: episodes.length, episodes });
      }
      if (source === 'animenosub') {
        const episodes = await getAnimenosubEpisodes(String(customSlug));
        return res.json({ anilistId: null, malId: null, title: String(customSlug), source, siteId: String(customSlug), count: episodes.length, episodes });
      }
      if (source === 'aniwaves') {
        const episodes = await getWaveEpisodes(String(customSlug));
        return res.json({ anilistId: null, malId: null, title: String(customSlug), source, siteId: String(customSlug), count: episodes.length, episodes });
      }
    }

    const alId = await resolveAlId(anilistId as string, malId as string, kitsuId as string, jikanId as string);
    if (!alId) return res.status(404).json({ error: 'Anime not found' });
    const siteIds = await getSiteIds(alId);
    if (!siteIds) return res.status(404).json({ error: 'Could not resolve site IDs' });
    const result = await fetchEpisodes(source as Source, siteIds, { heavenId: customSlug ? String(customSlug) : undefined });
    if (result.error) return res.status(404).json({ error: result.error });
    return res.json({ anilistId: alId, malId: siteIds.malId, title: siteIds.title, source, siteId: result.siteId, count: result.episodes.length, episodes: result.episodes });
  } catch (e) {
    console.error(`[/episodes] Error:`, e);
    const errStr = String(e);
    const isNetworkError = errStr.includes('socket disconnected') || errStr.includes('timeout') || errStr.includes('Network Error') || errStr.includes('ECONNREFUSED');
    return res.status(isNetworkError ? 502 : 500).json({
      error: isNetworkError ? 'Upstream provider is temporarily unreachable' : 'Episode fetch failed',
      detail: errStr
    });
  }
});

router.get('/servers', async (req: Request, res: Response) => {
  let { anilistId, malId, kitsuId, jikanId, ep, type = 'sub', source = 'senshi', heavenId, slug, id: rawId } = req.query;
  if (!ep) return res.status(400).json({ error: 'Missing ?ep=' });
  let customSlug = (slug || heavenId) as string | undefined;
  if (!customSlug && rawId && typeof rawId === 'string' && !/^\d+$/.test(rawId)) {
    customSlug = rawId;
  }
  if (!anilistId && rawId && typeof rawId === 'string' && /^\d+$/.test(rawId)) {
    anilistId = rawId;
  }
  const isDirectCustom = Boolean(customSlug && (source === 'animeheaven' || source === 'animepahe' || source === 'animepaheNg' || source === 'anidbapp' || source === 'anidb' || source === 'animesalt'));
  if (!anilistId && !malId && !kitsuId && !jikanId && !isDirectCustom) {
    return res.status(400).json({ error: 'Provide ?anilistId=, ?malId=, ?kitsuId=, ?jikanId=, or ?slug=/heavenId= for AnimePahe / AnimeHeaven' });
  }
  const epNum = parseInt(ep as string);
  if (isNaN(epNum)) return res.status(400).json({ error: '?ep must be a number' });
  if (!SOURCES.includes(source as Source)) return res.status(400).json({ error: `source must be: ${SOURCES.join(', ')}` });

  try {
    const siteIds = isDirectCustom
      ? { anilistId: null, malId: null, title: customSlug || null, siteIds: { [source as string]: String(customSlug) } }
      : await (async () => {
          const alId = await resolveAlId(anilistId as string, malId as string, kitsuId as string, jikanId as string);
          if (!alId) return null;
          return getSiteIds(alId);
        })();
    if (!siteIds) return res.status(404).json({ error: 'Could not resolve site IDs' });

    const epResult = await fetchEpisodes(source as Source, siteIds, { heavenId: customSlug ? String(customSlug) : undefined });
    if (epResult.error) return res.status(404).json({ error: epResult.error });
    let episode = epResult.episodes.find((e: any) => Math.round(e.num) === epNum);

    // Fallback for AnimePahe if specific episode wasn't in list
    if (!episode && (source === 'animepahe' || source === 'animepaheNg')) {
      const dom = source === 'animepaheNg' ? 'animepahe.ng' : 'animepahe.ch';
      const cleanSlug = (epResult.siteId || customSlug || '').replace(/^[a-z0-9.-]+::/, '');
      if (cleanSlug) {
        episode = {
          id: `${cleanSlug}-episode-${epNum}-english-subbed`,
          num: epNum,
          title: `Episode ${epNum}`,
          url: `https://${dom}/${cleanSlug}-episode-${epNum}-english-subbed/`,
          domain: dom,
        };
      }
    }

    if (!episode) return res.status(404).json({ error: `Episode ${epNum} not found` });

    let allServers: any[] = [];
    if (source === 'senshi') allServers = await getServers(episode.id);
    if (source === 'animeheaven') allServers = await getHeavenServers(episode.id);
    if (source === 'miruro') allServers = await getMiruroServers(episode.id);
    if (source === 'anikoto') allServers = await getAnikotoServers(episode.id);
    if (source === 'otakuvid') allServers = await getOtakuvidServers(episode.id);
    if (source === 'lunarx') allServers = await getLunarxServers(episode.id);
    if (source === 'animepahe') allServers = await getAnimePaheServers(episode.id, 'animepahe.ch');
    if (source === 'animepaheNg') allServers = await getAnimePaheServers(episode.id, 'animepahe.ng');
    if (source === 'anidbapp' || source === 'anidb') allServers = await getAnidbServers(episode.id);
    if (source === 'animesalt') allServers = [{ name: 'AnimeSalt MultiAudio', sourceId: episode.id, type: 'sub' }];
    if (source === '1embed') allServers = [{ name: '1Embed HLS (1080p)', sourceId: episode.id, type: 'sub' }];
    if (source === 'animegg') allServers = await getAnimeGGServers(episode.id);
    if (source === 'anineko') allServers = await getAniNekoServers(episode.id);
    if (source === 'animenosub') allServers = await getAnimenosubServers(episode.id);
    if (source === 'aniwaves') allServers = await getWaveServers(episode.id);

    const filtered = type === 'all' ? allServers : allServers.filter((s: any) => s.type === type);
    return res.json({
      anilistId: siteIds.anilistId,
      malId: siteIds.malId,
      title: siteIds.title,
      episode: epNum,
      type,
      source,
      siteId: epResult.siteId,
      servers: filtered.map((s: any) => ({ name: s.name, sourceId: s.sourceId, type: s.type })),
    });
  } catch (e) {
    console.error(`[/servers] Error:`, e);
    const errStr = String(e);
    const isNetworkError = errStr.includes('socket disconnected') || errStr.includes('timeout') || errStr.includes('Network Error') || errStr.includes('ECONNREFUSED');
    return res.status(isNetworkError ? 502 : 500).json({
      error: isNetworkError ? 'Upstream provider is temporarily unreachable' : 'Servers fetch failed',
      detail: errStr
    });
  }
});

async function watchHandler(req: Request, res: Response) {
  const { source, id, ep, type } = req.params;
  const preferredServer = req.query.server as string | undefined;
  const heavenOverride = (req.query.heavenId || req.query.slug || req.query.paheSlug) as string | undefined;

  if (!SOURCES.includes(source as Source)) return res.status(400).json({ error: `source must be: ${SOURCES.join(', ')}` });
  const epNum = parseInt(ep);
  if (isNaN(epNum)) return res.status(400).json({ error: 'ep must be a number' });
  if (!['sub', 'dub', 'raw'].includes(type)) return res.status(400).json({ error: 'type must be: sub, dub, raw' });

  const isSlugSource = source === 'animeheaven' || source === 'animepahe' || source === 'animepaheNg' || source === 'anidbapp' || source === 'anidb' || source === 'animesalt' || source === 'animegg' || source === 'anineko' || source === 'animenosub' || source === 'aniwaves';
  const directSlugId = isSlugSource && !id.startsWith('mal-') && !id.startsWith('kitsu-') && !id.startsWith('jikan-') && !/^\d+$/.test(id);
  const isKitsu = id.startsWith('kitsu-');
  const isJikan = id.startsWith('jikan-');
  const isMal = id.startsWith('mal-');
  const kitsuId = isKitsu ? id.replace('kitsu-', '') : (req.query.kitsuId as string | undefined);
  const jikanId = isJikan ? id.replace('jikan-', '') : (req.query.jikanId as string | undefined);
  const malId = isMal ? id.replace('mal-', '') : (req.query.malId as string | undefined);
  const anilistId = directSlugId || isMal || isKitsu || isJikan ? (req.query.anilistId as string | undefined) : id;

  try {
    const siteIds = directSlugId
      ? { anilistId: null, malId: null, title: id, siteIds: { [source]: id } }
      : await (async () => {
          const alId = await resolveAlId(anilistId, malId, kitsuId, jikanId);
          if (!alId) return null;
          return getSiteIds(alId);
        })();
    if (!siteIds) return res.status(404).json({ error: 'Could not resolve anime' });

    const epResult = await fetchEpisodes(source as Source, siteIds, { heavenId: heavenOverride || (directSlugId ? id : undefined) });
    if (epResult.error) return res.status(404).json({ error: epResult.error });

    let episode = epResult.episodes.find((e: any) => Math.round(e.num) === epNum);
    if (!episode && (source === 'animepahe' || source === 'animepaheNg')) {
      const dom = source === 'animepaheNg' ? 'animepahe.ng' : 'animepahe.ch';
      const cleanSlug = (epResult.siteId || heavenOverride || (directSlugId ? id : '')).replace(/^[a-z0-9.-]+::/, '');
      if (cleanSlug) {
        episode = {
          id: `${cleanSlug}-episode-${epNum}-english-subbed`,
          num: epNum,
          title: `Episode ${epNum}`,
          url: `https://${dom}/${cleanSlug}-episode-${epNum}-english-subbed/`,
          domain: dom,
        };
      }
    }
    if (!episode) return res.status(404).json({ error: `Episode ${epNum} not found` });

    let allServers: any[] = [];
    if (source === 'senshi') allServers = await getServers(episode.id);
    if (source === 'animeheaven') allServers = await getHeavenServers(episode.id);
    if (source === 'miruro') allServers = await getMiruroServers(episode.id);
    if (source === 'anikoto') allServers = await getAnikotoServers(episode.id);
    if (source === 'otakuvid') allServers = await getOtakuvidServers(episode.id);
    if (source === 'lunarx') allServers = await getLunarxServers(episode.id);
    if (source === 'animepahe') allServers = await getAnimePaheServers(episode.id, 'animepahe.ch');
    if (source === 'animepaheNg') allServers = await getAnimePaheServers(episode.id, 'animepahe.ng');
    if (source === 'anidbapp' || source === 'anidb') allServers = await getAnidbServers(episode.id);
    if (source === 'animesalt') allServers = [{ name: 'AnimeSalt MultiAudio', sourceId: episode.id, type: 'sub' }];
    if (source === '1embed') allServers = [{ name: '1Embed HLS (1080p)', sourceId: episode.id, type: 'sub' }];
    if (source === 'animegg') allServers = await getAnimeGGServers(episode.id);
    if (source === 'anineko') allServers = await getAniNekoServers(episode.id);
    if (source === 'animenosub') allServers = await getAnimenosubServers(episode.id);
    if (source === 'aniwaves') allServers = await getWaveServers(episode.id);

    const filtered = allServers.filter((s: any) => s.type === type);
    if (!filtered.length) return res.status(404).json({ error: `No ${type} stream available on ${source} for ep ${epNum}` });

    // `strict=1` alongside `server=` restricts to ONLY that server (no
    // fallback to others) — useful for testing a single server in isolation
    // rather than the default "prefer this one, but fall back if it fails"
    // behavior used in production playback.
    const strict = req.query.strict === '1' || req.query.strict === 'true';
    let candidates = filtered;
    if (preferredServer && strict) {
      candidates = filtered.filter((s: any) => s.name.toLowerCase().includes(preferredServer.toLowerCase()));
      if (!candidates.length) {
        return res.status(404).json({ error: `No server matching "${preferredServer}" found`, availableServers: filtered.map((s: any) => s.name) });
      }
    } else if (preferredServer) {
      candidates = [...filtered].sort((a: any, b: any) => {
        const aM = a.name.toLowerCase().includes(preferredServer.toLowerCase()) ? -1 : 1;
        const bM = b.name.toLowerCase().includes(preferredServer.toLowerCase()) ? -1 : 1;
        return aM - bM;
      });
    }

    let embedResult: any = null;
    let usedServer = '';
    let usedSourceId = '';
    for (const server of candidates) {
      let raw: any = null;
      if (source === 'senshi') raw = await getEmbedUrl(server.sourceId);
      if (source === 'animeheaven') raw = await getHeavenStream(server.sourceId);
      if (source === 'miruro') raw = await getMiruroEmbedUrl(server.sourceId);
      if (source === 'anikoto') raw = await getAnikotoEmbedUrl(server.sourceId);
      if (source === 'otakuvid') raw = await getOtakuvidStream(server.sourceId);
      if (source === 'lunarx') raw = await getLunarxStream(server.sourceId);
      if (source === 'animepahe' || source === 'animepaheNg') raw = await getAnimePaheStream(server.sourceId);
      if (source === 'anidbapp' || source === 'anidb') raw = await getAnidbStream(server.sourceId);
      if (source === 'animesalt') raw = await resolveAnimeSaltWatch(server.sourceId, { language: req.query.language as string || '', type: type as 'sub' | 'dub' | 'all', server: req.query.server as string || '' }).catch(() => null);
      if (source === 'animegg') raw = await getAnimeGGStream(server.sourceId);
      if (source === 'anineko') raw = await getAniNekoStream(server.sourceId);
      if (source === 'animenosub') raw = await getAnimenosubStream(server.sourceId);
      if (source === 'aniwaves') raw = await getAniWavesStream(server.sourceId);
      if (source === '1embed') {
        const parts = String(server.sourceId).split(':');
        const alId = parts[0] || siteIds.anilistId;
        const targetEp = Number(parts[3]) || epNum;
        let tmdbId = parts[1] ? Number(parts[1]) : null;
        let season = Number(parts[2]) || 1;
        if (!tmdbId && alId) {
          const info = await resolveTmdbInfo(alId).catch(() => null);
          if (info) {
            tmdbId = info.tmdbId;
            season = info.season;
          }
        }
        if (tmdbId) {
          raw = await get1embedStream(tmdbId, season, targetEp).catch(() => null);
        }
      }
      const normalized = normalizeStreamResponse(raw);
      if (normalized) { embedResult = { ...raw, ...normalized }; usedServer = server.name; usedSourceId = server.sourceId; break; }
    }
    if (!embedResult) {
      const msg = strict && preferredServer ? `Server "${preferredServer}" failed to resolve a stream` : 'All servers failed';
      return res.status(502).json({ error: msg, triedServers: candidates.map((s: any) => s.name) });
    }

    if (source === 'lunarx') {
      const rawStream = embedResult.streamUrl || embedResult.m3u8 || embedResult.mp4;
      const isHls = embedResult.type === 'hls' || Boolean(embedResult.m3u8) || (typeof rawStream === 'string' && rawStream.includes('.m3u8'));
      const directM3u8 = embedResult.m3u8 || (isHls ? rawStream : null);
      const hlsProxy = directM3u8 ? proxiedHlsUrl(req, directM3u8, embedResult.referer) : null;
      const mp4Proxy = embedResult.mp4 ? proxiedVideoUrl(req, embedResult.mp4, usedSourceId) : null;
      const safeFilename = `${siteIds.title || 'Anime'} - Ep ${epNum}.mp4`;
      const keyParam = usedSourceId ? `&key=${encodeURIComponent(usedSourceId)}` : '';
      const proxiedDownload = embedResult.downloadUrl || (embedResult.mp4 ? `${publicBase(req)}/api/proxy/video?url=${encodeURIComponent(embedResult.mp4)}${keyParam}&dl=1&filename=${encodeURIComponent(safeFilename)}` : null);

      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        siteId: epResult.siteId,
        server: usedServer,
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: embedResult.embedUrl,
        streamUrl: embedResult.streamUrl,
        m3u8: directM3u8,
        hlsProxyUrl: hlsProxy,
        mp4: embedResult.mp4,
        proxyStreamUrl: isHls ? hlsProxy : (mp4Proxy || proxiedVideoUrl(req, embedResult.streamUrl, usedSourceId)),
        downloadUrl: embedResult.downloadUrl || embedResult.mp4 || rawStream,
        proxyDownloadUrl: proxiedDownload,
        directWatchLinks: (embedResult.directWatchLinks || []).map((link: any) => ({
          quality: link.quality,
          url: link.url,
          type: link.type,
          proxyUrl: link.type === 'hls' ? proxiedHlsUrl(req, link.url, embedResult.referer) : proxiedVideoUrl(req, link.url, usedSourceId),
        })),
        playbackMode: isHls ? 'hls' : 'mp4',
        iframeOnly: false,
        subtitles: embedResult.subtitles || [],
        note: 'LunarX provides direct watch stream links and HLS video playback.',
      });
    }

    if (source === 'otakuvid') {
      const rawMp4 = embedResult.downloadUrl || embedResult.streamUrl || embedResult.mp4;
      const safeFilename = `${siteIds.title || 'Anime'} - Ep ${epNum}.mp4`;
      const keyParam = usedSourceId ? `&key=${encodeURIComponent(usedSourceId)}` : '';
      const proxiedDownload = `${publicBase(req)}/api/proxy/video?url=${encodeURIComponent(rawMp4)}${keyParam}&dl=1&filename=${encodeURIComponent(safeFilename)}`;
      const proxiedStream = proxiedVideoUrl(req, embedResult.streamUrl, usedSourceId);
      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        siteId: epResult.siteId,
        server: usedServer,
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: embedResult.embedUrl,
        streamUrl: embedResult.streamUrl,
        downloadUrl: rawMp4,
        directDownloadLinks: (embedResult.directDownloadLinks || []).map((link: any) => ({
          quality: link.quality,
          url: link.url,
          proxyUrl: proxiedVideoUrl(req, link.url, usedSourceId),
          size: link.size
        })),
        mp4: embedResult.mp4,
        proxyStreamUrl: proxiedStream,
        proxyDownloadUrl: proxiedDownload,
        m3u8: null,
        hlsProxyUrl: null,
        playbackMode: 'mp4',
        iframeOnly: false,
        subtitles: [],
        note: 'Otakuvid provides direct file download links and direct MP4 streams.',
      });
    }

    if (source === 'animeheaven') {
      const rawMp4 = embedResult.downloadUrl || embedResult.streamUrl || embedResult.mp4;
      const safeFilename = `${siteIds.title || 'Anime'} - Ep ${epNum}.mp4`;
      const keyParam = usedSourceId ? `&key=${encodeURIComponent(usedSourceId)}` : '';
      const proxiedDownload = `${publicBase(req)}/api/proxy/video?url=${encodeURIComponent(rawMp4)}${keyParam}&dl=1&filename=${encodeURIComponent(safeFilename)}`;
      const proxiedStream = proxiedVideoUrl(req, embedResult.streamUrl, usedSourceId);
      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        siteId: epResult.siteId,
        server: usedServer,
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: embedResult.embedUrl,
        streamUrl: proxiedStream,
        rawStreamUrl: embedResult.streamUrl,
        downloadUrl: proxiedDownload,
        rawDownloadUrl: rawMp4,
        mp4: embedResult.mp4,
        proxyStreamUrl: proxiedStream,
        mp4ProxyUrl: proxiedVideoUrl(req, embedResult.mp4, usedSourceId),
        m3u8: null,
        hlsProxyUrl: null,
        playbackMode: 'mp4',
        iframeOnly: false,
        subtitles: [],
        note: 'AnimeHeaven provides direct MP4 streams and proxied download links.',
      });
    }

    if (source === 'animepahe' || source === 'animepaheNg') {
      const isHls = embedResult.type === 'hls' || Boolean(embedResult.m3u8);
      const isMp4 = embedResult.type === 'mp4' || Boolean(embedResult.mp4);
      const streamUrl = embedResult.streamUrl || embedResult.m3u8 || embedResult.mp4 || embedResult.embedUrl;
      const isBlogger = Boolean(embedResult.embedUrl?.includes('blogger.com') || embedResult.embedUrl?.includes('video.g'));
      const tokenMatch = embedResult.embedUrl?.match(/[?&]token=([^&]+)/);
      const bloggerToken = tokenMatch ? tokenMatch[1] : undefined;
      const hlsProxy = isHls ? proxiedHlsUrl(req, embedResult.m3u8 || streamUrl, embedResult.referer) : null;
      const mp4Proxy = isMp4 ? proxiedVideoUrl(req, embedResult.mp4 || streamUrl, usedSourceId) : null;
      const safeFilename = `${siteIds.title || 'Anime'} - Ep ${epNum}.mp4`;
      const keyParam = usedSourceId ? `&key=${encodeURIComponent(usedSourceId)}` : '';
      const proxiedDownload = isMp4 ? `${publicBase(req)}/api/proxy/video?url=${encodeURIComponent(embedResult.mp4 || streamUrl)}${keyParam}&dl=1&filename=${encodeURIComponent(safeFilename)}` : null;

      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        siteId: epResult.siteId,
        server: usedServer,
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: embedResult.embedUrl,
        streamUrl: streamUrl,
        bloggerToken,
        m3u8: embedResult.m3u8 ?? (isHls ? streamUrl : null),
        hlsProxyUrl: hlsProxy,
        mp4: embedResult.mp4 ?? (isMp4 ? streamUrl : null),
        proxyStreamUrl: isHls ? hlsProxy : mp4Proxy,
        downloadUrl: embedResult.mp4 || (isMp4 ? streamUrl : null),
        proxyDownloadUrl: proxiedDownload,
        playbackMode: isHls ? 'hls' : (isMp4 ? 'mp4' : 'iframe'),
        iframeOnly: !isHls && !isMp4,
        streams: [
          {
            server: isBlogger ? 'Blogger Player' : (usedServer || 'Blogger'),
            quality: isBlogger ? '1080p' : 'Auto',
            type: 'embed',
            url: embedResult.embedUrl || streamUrl,
            embedUrl: embedResult.embedUrl || streamUrl,
            bloggerToken,
          },
        ],
        subtitles: (embedResult.subtitles || []).map((s: any) => ({
          ...s,
          proxyUrl: s.url ? proxiedSubtitleUrl(req, s.url, embedResult.referer) : undefined,
        })),
        directWatchLinks: embedResult.directWatchLinks || [],
        note: isBlogger
          ? 'AnimePahe Blogger stream resolved with 1080p player token.'
          : isHls || isMp4
          ? 'AnimePahe stream resolved successfully.'
          : 'Use embedUrl in an iframe.',
      });
    }

    if (source === '1embed') {
      const primaryHls = embedResult.m3u8 || embedResult.streamUrl;
      const hlsProxy = primaryHls ? proxiedHlsUrl(req, primaryHls, embedResult.referer || 'https://1embed.cc/') : null;
      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        siteId: epResult.siteId,
        server: usedServer || '1Embed HLS (1080p)',
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: embedResult.embedUrl,
        streamUrl: primaryHls,
        m3u8: primaryHls,
        hlsProxyUrl: hlsProxy,
        proxyStreamUrl: hlsProxy,
        playbackMode: 'hls',
        iframeOnly: false,
        streams: (embedResult.directWatchLinks || []).map((link: any) => ({
          server: link.quality,
          quality: link.quality,
          type: 'hls',
          url: link.url,
          proxyUrl: proxiedHlsUrl(req, link.url, embedResult.referer || 'https://1embed.cc/'),
        })),
        directWatchLinks: (embedResult.directWatchLinks || []).map((link: any) => ({
          quality: link.quality,
          url: link.url,
          type: link.type,
          proxyUrl: proxiedHlsUrl(req, link.url, embedResult.referer || 'https://1embed.cc/'),
        })),
        subtitles: (embedResult.subtitles || []).map((s: any) => ({
          ...s,
          proxyUrl: s.url ? proxiedSubtitleUrl(req, s.url, embedResult.referer || 'https://1embed.cc/') : undefined,
        })),
        backdrop: embedResult.backdrop,
        poster: embedResult.poster,
        note: '1Embed provides multi-quality direct HLS streams and subtitles.',
      });
    }

    if (source === 'animesalt') {
      const isHls = Boolean(embedResult.masterPlaylistUrl || embedResult.sources?.some((s: any) => s.isM3U8));
      const directM3u8 = embedResult.masterPlaylistUrl || embedResult.sources?.find((s: any) => s.isM3U8)?.url;
      const hlsProxy = directM3u8 ? proxiedHlsUrl(req, directM3u8, embedResult.headers?.Referer || 'https://as-cdn26.top/') : null;
      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        siteId: epResult.siteId,
        server: usedServer,
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: directM3u8 || usedSourceId,
        streamUrl: directM3u8 || usedSourceId,
        m3u8: directM3u8,
        hlsProxyUrl: hlsProxy,
        playbackMode: isHls ? 'hls' : 'iframe',
        iframeOnly: !isHls,
        audioTracks: embedResult.audioTracks || [],
        selectedAudio: embedResult.selectedAudio || null,
        subtitles: embedResult.subtitles || [],
        directWatchLinks: (embedResult.sources || []).map((src: any) => ({
          quality: src.quality,
          url: src.url,
          proxyUrl: src.isM3U8 ? proxiedHlsUrl(req, src.url, embedResult.headers?.Referer || 'https://as-cdn26.top/') : src.url,
        })),
        note: isHls ? 'AnimeSalt Multi-Audio stream resolved successfully.' : 'Use embedUrl in an iframe.',
      });
    }

    if (source === 'anidbapp' || source === 'anidb') {
      const isHls = embedResult.type === 'hls' || Boolean(embedResult.m3u8);
      const directM3u8 = embedResult.m3u8 || (isHls ? embedResult.streamUrl : null);
      const hlsProxy = directM3u8 ? proxiedHlsUrl(req, directM3u8, embedResult.referer || 'https://anidb.se/') : null;
      const proxiedEmbed = embedResult.embedUrl ? `${publicBase(req)}/api/anidb-embed-proxy?url=${encodeURIComponent(embedResult.embedUrl)}` : embedResult.embedUrl;

      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        siteId: epResult.siteId,
        server: usedServer,
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: proxiedEmbed,
        rawEmbedUrl: embedResult.embedUrl,
        streamUrl: directM3u8 || embedResult.streamUrl,
        m3u8: directM3u8,
        hlsProxyUrl: hlsProxy,
        playbackMode: isHls ? 'hls' : 'iframe',
        iframeOnly: !isHls,
        subtitles: (embedResult.subtitles || []).map((sub: any) => ({
          ...sub,
          proxyUrl: sub.url ? proxiedSubtitleUrl(req, sub.url, embedResult.referer || 'https://anidb.se/') : undefined,
        })),
        intro: embedResult.intro,
        outro: embedResult.outro,
        provider: 'AniDB.se',
        directWatchLinks: (embedResult.directWatchLinks || []).map((link: any) => ({
          quality: link.quality,
          url: link.url,
          type: link.type,
          proxyUrl: proxiedHlsUrl(req, link.url, embedResult.referer || 'https://anidb.se/'),
        })),
        note: isHls
          ? 'AniDB.se HLS stream resolved successfully.'
          : 'AniDB.se embed resolved. Use embedUrl in an iframe.',
      });
    }

    // Miruro streams are usually direct HLS — the embedUrl IS the m3u8
    // regardless of whether the path contains ".m3u8", since CDN providers
    // (moo, bonk, bee, etc.) use extension-less signed URLs. But some
    // providers mix embed-page links into the same streams list with no hls
    // entry at all; getMiruroEmbedUrl now reports which kind it actually
    // picked via embedResult.type, so branch on that instead of assuming.
    //
    // IMPORTANT: do not fall back to a fixed "https://www.miruro.tv/" referer
    // here. Each provider's CDN (bonk/kiwi/bee/moo/...) is a separate edge host
    // that enforces its own Referer/Origin check; sending miruro.tv to a CDN
    // that doesn't expect it gets the request 403'd, which is why most sources
    // were resolving fine but failing to actually play. getMiruroEmbedUrl now
    // resolves the correct provider-specific referer when one exists; if it
    // legitimately found none, we pass undefined through and let the proxy
    // omit the header rather than send a guaranteed-wrong one.
    if (source === 'miruro') {
      const m3u8 = embedResult.m3u8 || (embedResult.type === 'hls' ? embedResult.embedUrl : null);
      const isHls = Boolean(m3u8);
      const url = (m3u8 || embedResult.embedUrl) as string;
      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        server: usedServer,
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: url,
        streamUrl: isHls ? url : null,
        m3u8: isHls ? url : null,
        hlsProxyUrl: isHls ? proxiedHlsUrl(req, url, embedResult.referer) : null,
        playbackMode: isHls ? 'hls' : 'iframe',
        iframeOnly: !isHls,
        subtitles: [],
        intro: null,
        outro: null,
        note: isHls ? null : 'This provider returned no HLS stream for this episode/category — use embedUrl in an iframe.',
      });
    }

    // Anikoto's embed resolution (getAnikotoEmbedUrl) already fully resolves
    // the stream internally — Megacloud/Megaplay decryption for regular
    // servers, or a direct CDN m3u8 for the Kiwi Mapper side-channel — so,
    // like Miruro, it skips the generic resolveEmbed() fallback below.
    if (source === 'anikoto') {
      return res.json({
        anilistId: siteIds.anilistId,
        malId: siteIds.malId,
        title: siteIds.title,
        episode: epNum,
        type,
        source,
        server: usedServer,
        availableServers: filtered.map((s: any) => s.name),
        embedUrl: embedResult.embedUrl,
        m3u8: embedResult.m3u8 ?? null,
        hlsProxyUrl: embedResult.m3u8 ? proxiedHlsUrl(req, embedResult.m3u8, embedResult.referer) : null,
        playbackMode: embedResult.m3u8 ? 'hls' : 'iframe',
        iframeOnly: !embedResult.m3u8,
        subtitles: (embedResult.subtitles ?? []).map((s: any) => ({
          ...s,
          url: proxiedSubtitleUrl(req, s.url, embedResult.referer),
        })),
        intro: null,
        outro: null,
        note: embedResult.m3u8 ? null : 'No m3u8 extracted — use embedUrl in an iframe.',
      });
    }

    const normalized = normalizeStreamResponse(embedResult);
    if (!normalized) return res.status(502).json({ error: 'Provider returned no valid HTTP stream or embed URL', server: usedServer });
    const directM3u8 = normalized.m3u8;
    const stream = directM3u8 || normalized.playbackMode !== 'iframe' || !normalized.embedUrl
      ? null
      : await resolveEmbed(normalized.embedUrl);
    const hasHls = Boolean(directM3u8 || stream?.m3u8);
    const mp4ProxyUrl = normalized.mp4 ? proxiedVideoUrl(req, normalized.mp4, usedSourceId, embedResult.referer) : null;
    const streamUrl = normalized.streamUrl;
    return res.json({
      anilistId: siteIds.anilistId,
      malId: siteIds.malId,
      title: siteIds.title,
      episode: epNum,
      type,
      source,
      server: usedServer,
      availableServers: filtered.map((s: any) => s.name),
      embedUrl: normalized.embedUrl,
      streamUrl,
      m3u8: directM3u8 || stream?.m3u8 || null,
      hlsProxyUrl: directM3u8 ? proxiedHlsUrl(req, directM3u8, embedResult.referer) : (stream?.m3u8 ? proxiedHlsUrl(req, stream.m3u8, embedResult.referer) : null),
      mp4: normalized.mp4,
      proxyStreamUrl: hasHls ? proxiedHlsUrl(req, directM3u8 || stream?.m3u8, embedResult.referer) : mp4ProxyUrl,
      playbackMode: hasHls ? 'hls' : normalized.playbackMode,
      iframeOnly: !hasHls && !normalized.mp4,
      subtitles: stream?.subtitles ?? [],
      intro: stream?.intro ?? null,
      outro: stream?.outro ?? null,
      note: directM3u8 || stream ? null : 'Use embedUrl in iframe - m3u8 decrypt failed (key may have rotated)',
    });
  } catch (e) {
    console.error(`[/watch/${source}] Error:`, e);
    const errStr = String(e);
    const isNetworkError = errStr.includes('socket disconnected') || errStr.includes('timeout') || errStr.includes('Network Error') || errStr.includes('ECONNREFUSED');
    return res.status(isNetworkError ? 502 : 500).json({
      error: isNetworkError ? 'Upstream provider is temporarily unreachable' : 'Stream fetch failed',
      detail: errStr
    });
  }
}

router.get('/watch/:source/:id/:ep/:type', watchHandler);

router.get('/proxy/hls', async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;
  const ref = req.query.ref as string | undefined;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '?url must be absolute http(s)' });

  // Only senshi/dao/wave/animeheaven embeds are actually tied to senshi.live;
  // defaulting to it unconditionally meant any source whose embedResult had no
  // referer (most miruro providers) silently got sent to upstream CDNs with
  // the wrong Referer/Origin and got rejected — sources resolved but never
  // played. If no ref was supplied, omit the headers entirely instead of
  // guessing; most CDNs tolerate a missing Referer far better than a wrong one.
  let referer: string | undefined;
  let origin: string | undefined;
  if (ref && /^https?:\/\//i.test(ref)) {
    referer = ref;
    try {
      origin = new URL(ref).origin;
    } catch {
      origin = undefined;
    }
  }

  try {
    let upstream;
    try {
      upstream = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(referer ? { Referer: referer } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
      });
    } catch (err: any) {
      // Fallback via primary Cloudflare Worker proxy if direct upstream fails
      const proxyUrl = getProxyUrl(url);
      upstream = await axios.get(proxyUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
    }

    const contentType = String(upstream.headers['content-type'] ?? '');
    const body = Buffer.from(upstream.data);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=30');

    if (url.includes('.m3u8') || contentType.includes('mpegurl')) {
      const text = body.toString('utf8');
      if (!text.trim().startsWith('#EXTM3U')) {
        return res.status(502).json({ error: 'Upstream did not return a valid m3u8 playlist', body: text.slice(0, 300) });
      }
      res.type('application/vnd.apple.mpegurl');
      return res.send(rewriteHlsPlaylist(req, text, url, ref));
    }

    res.type(contentType || 'application/octet-stream');
    return res.send(body);
  } catch (e: any) {
    return res.status(e?.response?.status || 502).json({ error: 'HLS proxy failed', detail: e?.message || String(e) });
  }
});

// Subtitle files (megacloud/megaplay/vidstream tracks, etc.) usually live on
// CDNs that don't send Access-Control-Allow-Origin, so browsers refuse to
// load them cross-origin straight from the client. We fetch server-side
// (with the correct Referer, same as the HLS proxy) and re-serve with open
// CORS. SRT is also converted to WEBVTT here since <track> only accepts VTT.
router.get('/proxy/subtitle', async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;
  const ref = req.query.ref as string | undefined;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '?url must be absolute http(s)' });

  let referer: string | undefined;
  let origin: string | undefined;
  if (ref && /^https?:\/\//i.test(ref)) {
    referer = ref;
    try {
      origin = new URL(ref).origin;
    } catch {
      origin = undefined;
    }
  }

  try {
    const upstream = await axios.get(url, {
      responseType: 'text',
      transformResponse: (d) => d,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(referer ? { Referer: referer } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
    });

    let text = String(upstream.data ?? '');
    if (!text.trim().startsWith('WEBVTT')) {
      // Looks like SRT (or SRT-ish) — convert timestamps (, → .) and prepend header
      text = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('text/vtt');
    return res.send(text);
  } catch (e: any) {
    return res.status(e?.response?.status || 502).json({ error: 'Subtitle proxy failed', detail: e?.message || String(e) });
  }
});

router.get('/proxy/video', async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '?url must be absolute http(s)' });

  const customRef = req.query.ref as string | undefined;
  const key = req.query.key as string | undefined;
  const isDownload = req.query.dl === '1' || req.query.download === '1' || req.query.download === 'true';
  const filename = (req.query.filename as string | undefined) || 'video.mp4';

  async function tryFetch(targetUrl: string) {
    let targetRef = customRef;
    let targetOrig: string | undefined = undefined;
    if (!targetRef && targetUrl.includes('animeheaven.me')) {
      targetRef = 'https://animeheaven.me/';
      targetOrig = 'https://animeheaven.me';
    }
    return axios.get(targetUrl, {
      responseType: 'stream',
      timeout: 25000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(targetRef ? { Referer: targetRef } : {}),
        ...(targetOrig ? { Origin: targetOrig } : {}),
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
      validateStatus: (status) => (status >= 200 && status < 300) || status === 206,
    });
  }

  let upstream: any = null;
  try {
    upstream = await tryFetch(url);
  } catch (initialErr: any) {
    // Strategy 1: Re-fetch fresh stream from AnimeHeaven using episode key if available
    if (key && (url.includes('animeheaven.me') || key.length >= 3)) {
      try {
        const fresh = await getHeavenStream(key, true); // force fresh live fetch from /gate.php
        if (fresh) {
          const candidates = Array.from(new Set([fresh.streamUrl, fresh.downloadUrl, fresh.mp4, ...fresh.servers])).filter(Boolean);
          for (const cand of candidates) {
            try {
              upstream = await tryFetch(cand);
              if (upstream) break;
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    // Strategy 2: If url is an AnimeHeaven video link, attempt subdomain rotation fallback
    if (!upstream && url.includes('animeheaven.me')) {
      const match = url.match(/^https?:\/\/([a-z0-9-]+)\.animeheaven\.me\/(video\.mp4\?[^#]+)/i);
      if (match) {
        const currentSub = match[1];
        const pathAndQuery = match[2];
        const fallbackSubs = ['cc', 'co', 'cz', 'f1', 'rx', 'cy', 'po', 'ci', 'sr', 'cv', 'rk', '7p'];
        for (const sub of fallbackSubs) {
          if (sub === currentSub) continue;
          const altUrl = `https://${sub}.animeheaven.me/${pathAndQuery}`;
          try {
            upstream = await tryFetch(altUrl);
            if (upstream) break;
          } catch (_) {}
        }
      }
    }

    if (!upstream) {
      return res.status(initialErr?.response?.status || 502).json({ error: 'Video proxy failed', detail: initialErr?.message || String(initialErr) });
    }
  }

  res.status(upstream.status);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (isDownload) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  }

  const acceptRanges = upstream.headers['accept-ranges'];
  const cacheControl = upstream.headers['cache-control'];
  res.setHeader('Accept-Ranges', typeof acceptRanges === 'string' ? acceptRanges : 'bytes');
  res.setHeader('Cache-Control', typeof cacheControl === 'string' ? cacheControl : 'public, max-age=3600');

  for (const header of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers[header];
    if (typeof value === 'string' || typeof value === 'number' || Array.isArray(value)) {
      res.setHeader(header, value);
    }
  }

  upstream.data.on('error', (err: any) => {
    console.error('Upstream stream error in /proxy/video:', err.message);
  });

  return upstream.data.pipe(res);
});

router.get('/watch', async (req: Request, res: Response) => {
  let { anilistId, malId, heavenId, slug, id: rawId, ep, type = 'sub', source = 'senshi', server } = req.query;
  if (!ep) return res.status(400).json({ error: 'Missing ?ep=' });
  let customSlug = (slug || heavenId) as string | undefined;
  if (!customSlug && rawId && typeof rawId === 'string' && !/^\d+$/.test(rawId)) {
    customSlug = rawId;
  }
  if (!anilistId && rawId && typeof rawId === 'string' && /^\d+$/.test(rawId)) {
    anilistId = rawId;
  }
  const isDirectCustom = Boolean(customSlug && (source === 'animeheaven' || source === 'animepahe' || source === 'animepaheNg' || source === 'anidbapp' || source === 'anidb' || source === 'animesalt'));
  if (!anilistId && !malId && !isDirectCustom) return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=, or ?slug=/heavenId= for AnimePahe / AnimeHeaven / AniDB' });
  const id = isDirectCustom ? String(customSlug) : anilistId ? String(anilistId) : `mal-${malId}`;
  req.params.source = String(source);
  req.params.id = id;
  req.params.ep = String(ep);
  req.params.type = String(type);
  if (customSlug) req.query.heavenId = customSlug;
  if (server) req.query.server = server;
  return watchHandler(req, res);
});


// ── DEBUG: dump raw miruro pipe sources (remove before production) ──────────
router.get('/debug/miruro-sources', async (req: Request, res: Response) => {
  const { anilistId, provider, category, episodeId } = req.query as Record<string, string>;
  if (!anilistId || !provider || !category || !episodeId) {
    return res.status(400).json({ error: 'Required: anilistId, provider, category, episodeId' });
  }
  try {
    const { getMiruroEmbedUrl } = await import('./scrapers/miruro');
    // sourceId format: anilistId::provider::category::episodeId
    const sourceId = `${anilistId}::${provider}::${category}::${episodeId}`;
    
    // Call fetchSources directly by re-implementing inline here for debug visibility
    const axios2 = (await import('axios')).default;
    const { Buffer: Buf } = await import('buffer');
    const zlib2 = await import('zlib');
    
    const PIPE_URL = 'https://www.miruro.tv/api/secure/pipe';
    const H = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Referer': 'https://www.miruro.tv/',
      'Origin': 'https://www.miruro.tv',
    };
    const encId = Buf.from(episodeId).toString('base64url');
    const payload = { path: 'sources', method: 'GET', query: { episodeId: encId, provider, category, anilistId: parseInt(anilistId) }, body: null, version: '0.1.0' };
    const encodedReq = Buf.from(JSON.stringify(payload)).toString('base64url');
    const r = await axios2.get(`${PIPE_URL}?e=${encodedReq}`, { headers: H, timeout: 15000, responseType: 'text', transformResponse: (d: any) => d });
    const padded = r.data + '='.repeat((4 - (r.data.length % 4)) % 4);
    const raw = JSON.parse(zlib2.gunzipSync(Buf.from(padded, 'base64url')).toString('utf-8'));
    
    return res.json({ sourceId, raw });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e), stack: String(e?.stack || '') });
  }
});


// ── DEBUG: inspect raw miruro pipe sources for a provider ──────────────────
// GET /api/debug/miruro?anilistId=21&provider=bonk&ep=1&category=sub
router.get('/debug/miruro', async (req: Request, res: Response) => {
  try {
    const anilistId = parseInt(req.query.anilistId as string);
    const provider  = (req.query.provider  as string) || 'bonk';
    const epNum     = parseInt((req.query.ep as string) || '1');
    const category  = ((req.query.category as string) || 'sub') as 'sub' | 'dub' | 'raw';

    if (isNaN(anilistId)) return res.status(400).json({ error: 'anilistId required' });

    const servers = await getMiruroServers(`${anilistId}:${epNum}`);
    const match   = servers.find(s => s.name === `${provider}-${category}`);
    if (!match) return res.json({ error: 'server not found', available: servers.map(s => s.name) });

    // Pull the raw episode ID out of the sourceId
    const parts        = match.sourceId.split('::');
    const rawEpisodeId = parts.slice(3).join('::');

    // Re-encode and call the pipe directly (same as fetchSources does internally)
    const { Buffer } = await import('buffer');
    const zlib        = await import('zlib');
    const encId       = Buffer.from(rawEpisodeId).toString('base64url');
    const payload     = { path: 'sources', method: 'GET', query: { episodeId: encId, provider, category, anilistId }, body: null, version: '0.1.0' };
    const encodedReq  = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const pipeRes = await axios.get(`https://www.miruro.tv/api/secure/pipe?e=${encodedReq}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Referer': 'https://www.miruro.tv/',
      },
      timeout: 15000,
      responseType: 'text',
      transformResponse: (d: any) => d,
    });

    const padded       = pipeRes.data + '='.repeat((4 - (pipeRes.data.length % 4)) % 4);
    const compressed   = Buffer.from(padded, 'base64url');
    const decompressed = zlib.gunzipSync(compressed);
    const raw          = JSON.parse(decompressed.toString('utf-8'));

    return res.json({
      sourceId:     match.sourceId,
      rawEpisodeId,
      pipeTopLevelKeys: Object.keys(raw),
      streams:      raw.streams ?? null,
      headers:      raw.headers ?? null,
      intro:        raw.intro   ?? null,
      raw,
    });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e), stack: e?.stack });
  }
});

// ── ANIDB.APP SEARCH & EMBED PROXY ENDPOINTS ─────────────────────────────

router.get('/search/anidbapp', async (req: Request, res: Response) => {
  const query = ((req.query.q as string) || (req.query.query as string) || '').trim();
  if (!query) return res.status(400).json({ error: 'Search query parameter "q" is required' });
  try {
    const results = await searchAnidb(query);
    return res.json({ provider: 'anidbapp', query, count: results.length, results });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/anidb-embed-proxy', async (req: Request, res: Response) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send('Missing url');

  try {
    let html = await fetchAnidbWithFallback(targetUrl, { Referer: 'https://anidb.se/' });
    if (!html) {
      return res.status(502).send('Unable to load AniDB embed');
    }

    html = html.replace(/<head>/i, '<head><base href="https://anidb.se/">');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err: any) {
    return res.status(500).send('Error: ' + err.message);
  }
});

// ══════════════════════════════════════════════════════════════
// ID CONVERSION & CROSS-MAPPING ENDPOINTS
// (MAL -> AniList, Jikan -> AniList, Kitsu -> AniList)
// ══════════════════════════════════════════════════════════════

router.get('/convert/mal/:id', async (req: Request, res: Response) => {
  try {
    const malId = parseInt(req.params.id, 10);
    if (isNaN(malId)) return res.status(400).json({ success: false, error: 'Invalid MAL ID' });
    const mapping = await getCompleteCrossMapping(malId, 'mal');
    return res.json({ success: true, ...mapping });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/convert/jikan/:id', async (req: Request, res: Response) => {
  try {
    const jikanId = parseInt(req.params.id, 10);
    if (isNaN(jikanId)) return res.status(400).json({ success: false, error: 'Invalid Jikan ID' });
    const mapping = await getCompleteCrossMapping(jikanId, 'jikan');
    return res.json({ success: true, ...mapping });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/convert/kitsu/:id', async (req: Request, res: Response) => {
  try {
    const kitsuId = parseInt(req.params.id, 10);
    if (isNaN(kitsuId)) return res.status(400).json({ success: false, error: 'Invalid Kitsu ID' });
    const mapping = await getCompleteCrossMapping(kitsuId, 'kitsu');
    return res.json({ success: true, ...mapping });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

router.get('/convert/anilist/:id', async (req: Request, res: Response) => {
  try {
    const anilistId = parseInt(req.params.id, 10);
    if (isNaN(anilistId)) return res.status(400).json({ success: false, error: 'Invalid AniList ID' });
    const mapping = await getCompleteCrossMapping(anilistId, 'anilist');
    return res.json({ success: true, ...mapping });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

// Explicit named conversion aliases
router.get('/mal-to-anilist/:id', async (req: Request, res: Response) => {
  const malId = parseInt(req.params.id, 10);
  if (isNaN(malId)) return res.status(400).json({ success: false, error: 'Invalid MAL ID' });
  const anilistId = await malToAnilist(malId);
  return res.json({ success: Boolean(anilistId), malId, anilistId });
});

router.get('/jikan-to-anilist/:id', async (req: Request, res: Response) => {
  const jikanId = parseInt(req.params.id, 10);
  if (isNaN(jikanId)) return res.status(400).json({ success: false, error: 'Invalid Jikan ID' });
  const anilistId = await jikanToAnilist(jikanId);
  return res.json({ success: Boolean(anilistId), jikanId, anilistId });
});

router.get('/kitsu-to-anilist/:id', async (req: Request, res: Response) => {
  const kitsuId = parseInt(req.params.id, 10);
  if (isNaN(kitsuId)) return res.status(400).json({ success: false, error: 'Invalid Kitsu ID' });
  const anilistId = await kitsuToAnilist(kitsuId);
  return res.json({ success: Boolean(anilistId), kitsuId, anilistId });
});

router.get(['/convert', '/map-id'], async (req: Request, res: Response) => {
  try {
    const from = ((req.query.from || req.query.source || 'mal') as string).toLowerCase();
    const idStr = (req.query.id || req.query.q) as string;
    if (!idStr) {
      return res.status(400).json({ success: false, error: 'Missing ?id= parameter' });
    }
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID: must be a number' });
    }

    let mappingType: 'anilist' | 'mal' | 'kitsu' | 'jikan' = 'mal';
    if (from.includes('ani')) mappingType = 'anilist';
    else if (from.includes('kit')) mappingType = 'kitsu';
    else if (from.includes('jik')) mappingType = 'jikan';

    const mapping = await getCompleteCrossMapping(id, mappingType);
    return res.json({ success: true, ...mapping });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

// ─────────────────────────────────────────────
// ANIMESALT.CX MULTI-LANGUAGE SCRAPER API
// Supported: Hindi, Telugu, Tamil, Japanese, Korean, English, Sub/Dub
// ─────────────────────────────────────────────

// GET /api/animesalt/languages
router.get('/animesalt/languages', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    languages: getSupportedLanguages(),
    types: ['all', 'sub', 'dub'],
    note: 'Select any language or sub/dub type using ?language=<name>&type=<sub|dub>',
  });
});

// GET /api/animesalt/browse or /api/animesalt/list
router.get(['/animesalt/browse', '/animesalt/list'], async (req: Request, res: Response) => {
  try {
    const language = (req.query.language || req.query.lang || '') as string;
    const type = ((req.query.type || 'all') as string).toLowerCase() as 'sub' | 'dub' | 'all';
    const page = parseInt((req.query.page || '1') as string, 10);
    const category = (req.query.category || req.query.genre || '') as string;
    const sort = (req.query.sort || '') as string;

    const data = await browseAnimeSalt({ language, type, page, category, sort });
    return res.json({ success: true, ...data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// GET /api/animesalt/search or /api/search/animesalt
router.get(['/animesalt/search', '/search/animesalt'], async (req: Request, res: Response) => {
  try {
    const query = (req.query.q || req.query.query || '') as string;
    const language = (req.query.language || req.query.lang || '') as string;
    const type = ((req.query.type || 'all') as string).toLowerCase() as 'sub' | 'dub' | 'all';
    const page = parseInt((req.query.page || '1') as string, 10);

    const data = await searchAnimeSalt(query, { language, type, page });
    return res.json({ success: true, ...data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// GET /api/animesalt/info and /api/animesalt/info/:id(*)
router.get(['/animesalt/info', '/animesalt/info/:id(*)'], async (req: Request, res: Response) => {
  try {
    const id = (req.params.id || req.query.id || req.query.slug || '') as string;
    if (!id) return res.status(400).json({ success: false, error: 'Missing anime id or slug' });

    const info = await getAnimeSaltInfo(id);
    return res.json({ success: true, ...info });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// GET /api/animesalt/episodes and /api/animesalt/episodes/:id(*)
router.get(['/animesalt/episodes', '/animesalt/episodes/:id(*)'], async (req: Request, res: Response) => {
  try {
    const id = (req.params.id || req.query.id || req.query.slug || '') as string;
    if (!id) return res.status(400).json({ success: false, error: 'Missing anime id or slug' });

    const episodes = await getAnimeSaltEpisodes(id);
    return res.json({ success: true, count: episodes.length, episodes });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// GET /api/animesalt/watch and /api/animesalt/watch/:episodeId(*) and /api/animesalt/stream
router.get(
  ['/animesalt/watch', '/animesalt/watch/:episodeId(*)', '/animesalt/stream', '/animesalt/sources'],
  async (req: Request, res: Response) => {
    try {
      const episodeId = (req.params.episodeId || req.query.episodeId || req.query.id || req.query.ep || '') as string;
      if (!episodeId) return res.status(400).json({ success: false, error: 'Missing episodeId parameter' });

      const language = (req.query.language || req.query.lang || '') as string;
      const type = ((req.query.type || 'all') as string).toLowerCase() as 'sub' | 'dub' | 'all';
      const server = (req.query.server || '') as string;

      const stream = await resolveAnimeSaltWatch(episodeId, { language, type, server });
      return res.json({ success: true, ...stream });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }
);

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.1.0-anikoto', sources: SOURCES, uptime: Math.floor(process.uptime()), cache: cacheStats(), timestamp: new Date().toISOString() });
});

export default router;
