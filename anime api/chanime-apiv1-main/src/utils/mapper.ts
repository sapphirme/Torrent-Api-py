import axios from 'axios';
import { anilistClient } from './fetch';
import { cacheGet, cacheSet } from './cache';
import { findAnimeHeavenId } from '../scrapers/animeheaven';
import { findAnikotoSlug } from '../scrapers/anikoto';
import { findLunarxId } from '../scrapers/lunarx';
import { findOtakuvidId } from '../scrapers/otakuvid';
import { findAnimePaheSlug } from '../scrapers/animepahe';
import { findAnidbId } from '../scrapers/anidbapp';
import { findAnimeSaltId } from '../scrapers/animesalt';
import {
  malToAnilist as resolveMalToAnilist,
  jikanToAnilist,
  kitsuToAnilist,
  anilistToMal,
  anilistToKitsu,
  resolveAnyToAnilist,
} from './idMapping';
import { getFallbackTitles, searchAnimeFallback } from './fallbackMetadata';

export {
  jikanToAnilist,
  kitsuToAnilist,
  anilistToMal,
  anilistToKitsu,
  resolveAnyToAnilist,
};

export interface SiteIds {
  anilistId: number;
  malId: number | null;
  title: string;
  titles?: string[];
  siteIds: {
    zoro?: string;
    gogoanime?: string;
    animeheaven?: string;
    anidao?: string;
    anikoto?: string;
    otakuvid?: string;
    lunarx?: string;
    yumezone?: string;
    animepahe?: string;
    animepaheNg?: string;
    anidbapp?: string;
    anidb?: string;
    [key: string]: string | undefined;
  };
}

function withTimeout<T>(p: Promise<T>, ms = 4000): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function enrichAnimeHeaven(result: SiteIds, titles: string[]): Promise<SiteIds> {
  if (!result.siteIds.animeheaven && result.title !== 'Unknown') {
    const id = await findAnimeHeavenId(titles).catch(() => null);
    if (id) result.siteIds.animeheaven = id;
  }
  return result;
}

async function enrichAnikoto(result: SiteIds): Promise<SiteIds> {
  if (!result.siteIds.anikoto && result.title !== 'Unknown') {
    const slug = await findAnikotoSlug(result.title).catch(() => null);
    if (slug) result.siteIds.anikoto = slug;
  }
  return result;
}

async function enrichLunarx(result: SiteIds): Promise<SiteIds> {
  if (!result.siteIds.lunarx && result.title !== 'Unknown') {
    const id = await findLunarxId(result.title).catch(() => null);
    if (id) result.siteIds.lunarx = id;
  }
  return result;
}

async function enrichOtakuvid(result: SiteIds): Promise<SiteIds> {
  if (!result.siteIds.otakuvid && result.title !== 'Unknown') {
    const id = await findOtakuvidId(result.title).catch(() => null);
    if (id) result.siteIds.otakuvid = id;
  }
  return result;
}

async function enrichAnimePahe(result: SiteIds, titles: string[]): Promise<SiteIds> {
  if (!result.siteIds.animepahe && result.title !== 'Unknown') {
    const match = await findAnimePaheSlug(titles, 'animepahe.ch').catch(() => null);
    if (match) result.siteIds.animepahe = match.slug;
  }
  if (!result.siteIds.animepaheNg && result.title !== 'Unknown') {
    const matchNg = await findAnimePaheSlug(titles, 'animepahe.ng').catch(() => null);
    if (matchNg) result.siteIds.animepaheNg = matchNg.slug;
  }
  return result;
}

async function enrichAnidb(result: SiteIds, titles: string[]): Promise<SiteIds> {
  if (!result.siteIds.anidbapp && result.title !== 'Unknown') {
    const match = await findAnidbId(titles, result.anilistId, result.malId).catch(() => null);
    if (match) {
      result.siteIds.anidbapp = match.slug;
      result.siteIds.anidb = match.slug;
    }
  }
  return result;
}

async function enrichAnimeSalt(result: SiteIds, titles: string[]): Promise<SiteIds> {
  if (!result.siteIds.animesalt && result.title !== 'Unknown') {
    const id = await findAnimeSaltId(titles).catch(() => null);
    if (id) {
      result.siteIds.animesalt = id;
    }
  }
  return result;
}

// MAL ID → AniList ID
export async function malToAnilist(malId: number): Promise<number | null> {
  const cacheKey = `mal2al:${malId}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached) return cached;

  // Use offline dataset + Kitsu + Jikan + AniList fallback resolution
  const resolvedId = await resolveMalToAnilist(malId);
  if (resolvedId) {
    cacheSet(cacheKey, resolvedId);
    return resolvedId;
  }

  // Last attempt: AniList GraphQL if online
  try {
    const query = `query ($malId: Int) {
      Media(idMal: $malId, type: ANIME) { id idMal title { romaji english } }
    }`;
    const res = await anilistClient.post('', { query, variables: { malId } });
    const id = res.data?.data?.Media?.id ?? null;
    if (id) {
      cacheSet(cacheKey, id);
      return id;
    }
  } catch {}

  return null;
}

// Fetch title variants from AniList with seamless fallback to Kitsu/MAL/Jikan
async function getAnilistTitle(anilistId: number): Promise<{
  title: string;
  romaji: string;
  english: string;
  synonyms: string[];
  malId: number | null;
}> {
  try {
    const query = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        idMal
        title { romaji english }
        synonyms
      }
    }`;
    const res = await anilistClient.post('', { query, variables: { id: anilistId } });
    const media = res.data?.data?.Media;
    if (media && (media.title?.english || media.title?.romaji)) {
      const english = media?.title?.english || '';
      const romaji = media?.title?.romaji || '';
      const synonyms: string[] = Array.isArray(media?.synonyms) ? media.synonyms : [];
      const primaryTitle = english || romaji || 'Unknown';

      return {
        title: primaryTitle,
        romaji,
        english,
        synonyms,
        malId: media?.idMal ?? null,
      };
    }
  } catch {}

  // Seamless fallback when AniList is down or media not found
  return getFallbackTitles(anilistId);
}

// AniList ID → metadata + site-specific IDs
export async function getSiteIds(anilistId: number): Promise<SiteIds | null> {
  const cacheKey = `siteids:${anilistId}`;
  const cached = cacheGet<SiteIds>(cacheKey);

  // Build list of title variants
  const alInfo = await getAnilistTitle(anilistId).catch(() => ({
    title: 'Unknown',
    romaji: '',
    english: '',
    synonyms: [],
    malId: null,
  }));

  const titles = Array.from(new Set([
    alInfo.english,
    alInfo.romaji,
    ...alInfo.synonyms,
    alInfo.title,
  ].filter(Boolean)));

  if (cached) {
    if (!cached.titles && titles.length) cached.titles = titles;
    const enrichTasks: Promise<any>[] = [];
    if (!cached.siteIds.animeheaven) enrichTasks.push(withTimeout(enrichAnimeHeaven(cached, titles)));
    if (!cached.siteIds.animepahe || !cached.siteIds.animepaheNg) enrichTasks.push(withTimeout(enrichAnimePahe(cached, titles)));
    if (!cached.siteIds.anikoto) enrichTasks.push(withTimeout(enrichAnikoto(cached)));
    if (!cached.siteIds.lunarx) enrichTasks.push(withTimeout(enrichLunarx(cached)));
    if (!cached.siteIds.otakuvid) enrichTasks.push(withTimeout(enrichOtakuvid(cached)));
    if (!cached.siteIds.anidbapp) enrichTasks.push(withTimeout(enrichAnidb(cached, titles)));
    if (!cached.siteIds.animesalt) enrichTasks.push(withTimeout(enrichAnimeSalt(cached, titles)));

    if (enrichTasks.length > 0) {
      await Promise.allSettled(enrichTasks);
      cacheSet(cacheKey, cached);
    }
    return cached;
  }

  const result: SiteIds = {
    anilistId,
    malId: alInfo.malId,
    title: alInfo.title,
    titles,
    siteIds: {
      yumezone: String(anilistId),
    },
  };

  // Try Anify for site mappings
  try {
    const res = await axios.get(`https://api.anify.tv/info/${anilistId}`, {
      params: { fields: 'mappings' },
      timeout: 2000,
    });
    const mappings: any[] = res.data?.mappings ?? [];
    for (const m of mappings) {
      if (m.providerId === 'zoro')      result.siteIds.zoro = m.id;
      if (m.providerId === 'gogoanime') result.siteIds.gogoanime = m.id;
      if (m.providerId === 'mal' && !result.malId) result.malId = parseInt(m.id);
    }
  } catch {
    // Anify down or missing — fall through to direct scraper fallbacks below
  }

  await Promise.allSettled([
    withTimeout(enrichAnimeHeaven(result, titles)),
    withTimeout(enrichAnimePahe(result, titles)),
    withTimeout(enrichAnikoto(result)),
    withTimeout(enrichLunarx(result)),
    withTimeout(enrichOtakuvid(result)),
    withTimeout(enrichAnidb(result, titles)),
    withTimeout(enrichAnimeSalt(result, titles)),
  ]);

  // If still no zoro ID, try a slug guess
  if (!result.siteIds.zoro && result.title !== 'Unknown') {
    const slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    result.siteIds.zoro = `${slug}-${anilistId}`;
  }

  cacheSet(cacheKey, result);
  return result;
}

// Search AniList by title (with automatic fallback to Kitsu/MAL search when AniList is down)
export async function searchAnilist(query: string): Promise<{
  id: number; malId: number | null; title: string; coverImage: string; episodes: number | null; status: string; format: string;
}[]> {
  const cleanQ = query.toLowerCase().trim();
  const cacheKey = `alsearch:${cleanQ}`;
  const cached = cacheGet<any[]>(cacheKey);
  if (cached) return cached;

  try {
    const gql = `query ($search: String) {
      Page(page: 1, perPage: 10) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id idMal episodes
          title { romaji english }
          coverImage { large medium }
          status format
        }
      }
    }`;

    const res = await anilistClient.post('', { query: gql, variables: { search: cleanQ } });
    const list = res.data?.data?.Page?.media ?? [];

    if (list.length > 0) {
      const results = list.map((m: any) => ({
        id: m.id,
        malId: m.idMal ?? null,
        title: m.title?.english ?? m.title?.romaji,
        coverImage: m.coverImage?.large ?? m.coverImage?.medium ?? '',
        episodes: m.episodes ?? null,
        status: m.status,
        format: m.format,
      }));

      cacheSet(cacheKey, results, 'episodes');
      return results;
    }
  } catch {}

  // Fallback search when AniList is down
  const fallbackItems = await searchAnimeFallback(cleanQ, { limit: 10 });
  const results = fallbackItems.map((m) => ({
    id: m.id,
    malId: m.idMal ?? null,
    title: m.title.english || m.title.romaji || m.title.userPreferred,
    coverImage: m.coverImage.large || m.coverImage.medium || '',
    episodes: m.episodes ?? null,
    status: m.status,
    format: m.format,
  }));

  cacheSet(cacheKey, results, 'episodes');
  return results;
}
