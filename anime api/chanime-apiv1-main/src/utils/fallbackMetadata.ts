import axios from 'axios';
import {
  malToAnilist,
  kitsuToAnilist,
  anilistToMal,
  anilistToKitsu,
} from './idMapping';
import { cacheGet, cacheSet } from './cache';

export interface FallbackMedia {
  id: number;
  idMal?: number | null;
  title: {
    romaji: string;
    english: string;
    native: string;
    userPreferred: string;
  };
  coverImage: {
    large: string;
    medium: string;
    extraLarge?: string;
  };
  bannerImage: string | null;
  format: string;
  status: string;
  episodes: number | null;
  duration: number | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  meanScore?: number | null;
  popularity?: number | null;
  trending?: number | null;
  favourites?: number | null;
  genres: string[];
  description: string;
  startDate?: { year: number | null; month: number | null; day: number | null };
  endDate?: { year: number | null; month: number | null; day: number | null };
  trailer?: { id: string; site: string; url: string } | null;
  relations?: any[];
  externalLinks?: any[];
  streamingEpisodes?: any[];
}

function parseDate(dStr?: string) {
  if (!dStr) return { year: null, month: null, day: null };
  const parts = dStr.split('-').map((p) => parseInt(p, 10));
  return {
    year: parts[0] || null,
    month: parts[1] || null,
    day: parts[2] || null,
  };
}

function getSeasonFromDate(dStr?: string): { season: string | null; seasonYear: number | null } {
  if (!dStr) return { season: null, seasonYear: null };
  const parts = dStr.split('-').map((p) => parseInt(p, 10));
  const year = parts[0] || null;
  const month = parts[1] || 1;
  let season: string = 'WINTER';
  if (month >= 3 && month <= 5) season = 'SPRING';
  else if (month >= 6 && month <= 8) season = 'SUMMER';
  else if (month >= 9 && month <= 11) season = 'FALL';
  return { season, seasonYear: year };
}

function formatKitsuToMedia(kitsuItem: any, anilistId: number, malId?: number | null): FallbackMedia {
  const attr = kitsuItem.attributes || {};
  const enTitle = attr.titles?.en || attr.titles?.en_jp || attr.canonicalTitle || '';
  const romajiTitle = attr.titles?.en_jp || attr.canonicalTitle || '';
  const nativeTitle = attr.titles?.ja_jp || '';
  const userPreferred = attr.canonicalTitle || enTitle || romajiTitle;

  const poster = attr.posterImage || {};
  const cover = attr.coverImage || {};

  const { season, seasonYear } = getSeasonFromDate(attr.startDate);

  let status = 'FINISHED';
  if (attr.status === 'current') status = 'RELEASING';
  else if (attr.status === 'unreleased' || attr.status === 'upcoming') status = 'NOT_YET_RELEASED';

  let format = 'TV';
  const sub = (attr.subtype || '').toUpperCase();
  if (sub === 'MOVIE') format = 'MOVIE';
  else if (sub === 'OVA') format = 'OVA';
  else if (sub === 'ONA') format = 'ONA';
  else if (sub === 'SPECIAL') format = 'SPECIAL';

  let score: number | null = null;
  if (attr.averageRating) {
    score = Math.round(parseFloat(attr.averageRating));
  }

  return {
    id: anilistId,
    idMal: malId || null,
    title: {
      romaji: romajiTitle,
      english: enTitle,
      native: nativeTitle,
      userPreferred,
    },
    coverImage: {
      large: poster.large || poster.original || poster.medium || '',
      medium: poster.medium || poster.small || '',
      extraLarge: poster.original || poster.large || '',
    },
    bannerImage: cover.large || cover.original || null,
    format,
    status,
    episodes: attr.episodeCount || null,
    duration: attr.episodeLength || null,
    season,
    seasonYear,
    averageScore: score,
    meanScore: score,
    popularity: attr.userCount || null,
    favourites: attr.favoritesCount || null,
    genres: [],
    description: (attr.synopsis || attr.description || '').replace(/\r\n/g, '\n'),
    startDate: parseDate(attr.startDate),
    endDate: parseDate(attr.endDate),
    trailer: attr.youtubeVideoId
      ? {
          id: attr.youtubeVideoId,
          site: 'youtube',
          url: `https://www.youtube.com/watch?v=${attr.youtubeVideoId}`,
        }
      : null,
  };
}

/**
 * Fallback search using Kitsu + MyAnimeList
 */
export async function searchAnimeFallback(
  query: string,
  options: {
    limit?: number;
    page?: number;
    genre?: string;
  } = {}
): Promise<FallbackMedia[]> {
  const limit = options.limit || 20;
  const page = options.page || 1;
  const offset = (page - 1) * limit;

  const results: FallbackMedia[] = [];
  const seenIds = new Set<number>();

  // 1. Kitsu search
  try {
    const kitsuParams = new URLSearchParams();
    if (query) kitsuParams.set('filter[text]', query);
    if (options.genre) kitsuParams.set('filter[categories]', options.genre);
    kitsuParams.set('page[limit]', String(limit));
    kitsuParams.set('page[offset]', String(offset));

    const res = await axios.get(`https://kitsu.io/api/edge/anime?${kitsuParams.toString()}`, { timeout: 7000 });
    const items = res.data?.data || [];

    const mapped = await Promise.all(
      items.map(async (item: any) => {
        const kitsuId = Number(item.id);
        const anilistId = await kitsuToAnilist(kitsuId);
        const malId = await anilistToMal(anilistId || 0);
        const finalId = anilistId || (1000000 + kitsuId);
        return { item, finalId, malId };
      })
    );

    for (const { item, finalId, malId } of mapped) {
      if (!seenIds.has(finalId)) {
        seenIds.add(finalId);
        results.push(formatKitsuToMedia(item, finalId, malId));
      }
    }
  } catch (err: any) {
    console.warn('[FallbackSearch] Kitsu search warning:', err?.message || err);
  }

  // 2. If results are still few and query exists, query MAL prefix search
  if (results.length < 5 && query) {
    try {
      const malRes = await axios.get(
        `https://myanimelist.net/search/prefix.json?type=anime&keyword=${encodeURIComponent(query)}`,
        {
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        }
      );
      const items = malRes.data?.categories?.[0]?.items || [];
      for (const item of items) {
        const malId = Number(item.id);
        const anilistId = await malToAnilist(malId);
        const finalId = anilistId || (2000000 + malId);

        if (!seenIds.has(finalId)) {
          seenIds.add(finalId);
          results.push({
            id: finalId,
            idMal: malId,
            title: {
              romaji: item.name,
              english: item.name,
              native: '',
              userPreferred: item.name,
            },
            coverImage: {
              large: item.image_url,
              medium: item.thumbnail_url || item.image_url,
            },
            bannerImage: null,
            format: (item.payload?.media_type || 'TV').toUpperCase(),
            status: item.payload?.status === 'Finished Airing' ? 'FINISHED' : 'RELEASING',
            episodes: null,
            duration: null,
            averageScore: item.payload?.score ? Math.round(parseFloat(item.payload.score) * 10) : null,
            genres: [],
            description: '',
          });
        }
      }
    } catch {}
  }

  return results;
}

/**
 * Fallback metadata info for a given AniList ID
 */
export async function getAnimeInfoFallback(anilistId: number): Promise<FallbackMedia | null> {
  const cacheKey = `fb:info:${anilistId}`;
  const cached = cacheGet<FallbackMedia>(cacheKey);
  if (cached) return cached;

  const kitsuId = await anilistToKitsu(anilistId);
  const malId = await anilistToMal(anilistId);

  let media: FallbackMedia | null = null;

  // Try Kitsu first
  if (kitsuId) {
    try {
      const res = await axios.get(
        `https://kitsu.io/api/edge/anime/${kitsuId}?include=categories,mediaRelationships.destination`,
        { timeout: 7000 }
      );
      const data = res.data?.data;
      if (data) {
        media = formatKitsuToMedia(data, anilistId, malId);

        // Parse included categories
        const included = res.data?.included || [];
        const genres = included
          .filter((x: any) => x.type === 'categories')
          .map((x: any) => x.attributes?.title)
          .filter(Boolean);
        media.genres = genres;

        // Parse relations in parallel
        const animeIncs = included.filter((x: any) => x.type === 'anime');
        const relations = await Promise.all(
          animeIncs.map(async (inc: any) => {
            const relKitsuId = Number(inc.id);
            const relAlId = await kitsuToAnilist(relKitsuId);
            return {
              id: relAlId || (1000000 + relKitsuId),
              title: inc.attributes?.canonicalTitle || inc.attributes?.titles?.en,
              format: (inc.attributes?.subtype || 'TV').toUpperCase(),
              coverImage: inc.attributes?.posterImage?.large || inc.attributes?.posterImage?.medium,
              relationType: 'OTHER',
            };
          })
        );
        media.relations = relations;
      }
    } catch (err: any) {
      console.warn('[FallbackInfo] Kitsu fetch error:', err?.message);
    }
  }

  // If Kitsu didn't succeed or we have MAL ID, try Jikan
  if (!media && malId) {
    try {
      const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime/${malId}`, { timeout: 6000 });
      const d = jikanRes.data?.data;
      if (d) {
        media = {
          id: anilistId,
          idMal: malId,
          title: {
            romaji: d.title || d.title_japanese || '',
            english: d.title_english || d.title || '',
            native: d.title_japanese || '',
            userPreferred: d.title_english || d.title || '',
          },
          coverImage: {
            large: d.images?.jpg?.large_image_url || d.images?.jpg?.image_url || '',
            medium: d.images?.jpg?.image_url || '',
          },
          bannerImage: null,
          format: (d.type || 'TV').toUpperCase(),
          status: d.status === 'Finished Airing' ? 'FINISHED' : 'RELEASING',
          episodes: d.episodes || null,
          duration: d.duration ? parseInt(d.duration) || null : null,
          season: d.season ? d.season.toUpperCase() : null,
          seasonYear: d.year || null,
          averageScore: d.score ? Math.round(d.score * 10) : null,
          genres: (d.genres || []).map((g: any) => g.name),
          description: d.synopsis || '',
          startDate: parseDate(d.aired?.from?.split('T')?.[0]),
          endDate: parseDate(d.aired?.to?.split('T')?.[0]),
          trailer: d.trailer?.youtube_id
            ? {
                id: d.trailer.youtube_id,
                site: 'youtube',
                url: d.trailer.url || `https://www.youtube.com/watch?v=${d.trailer.youtube_id}`,
              }
            : null,
        };
      }
    } catch {}
  }

  if (media) {
    media.externalLinks = [
      malId ? { site: 'MyAnimeList', url: `https://myanimelist.net/anime/${malId}` } : null,
      kitsuId ? { site: 'Kitsu', url: `https://kitsu.io/anime/${kitsuId}` } : null,
      { site: 'AniList', url: `https://anilist.co/anime/${anilistId}` },
    ].filter(Boolean);

    cacheSet(cacheKey, media, 1800); // 30 min cache
  }

  return media;
}

/**
 * Fallback titles for provider mapping (used by getAnilistTitle in mapper.ts)
 */
export async function getFallbackTitles(anilistId: number): Promise<{
  title: string;
  romaji: string;
  english: string;
  synonyms: string[];
  malId: number | null;
}> {
  const kitsuId = await anilistToKitsu(anilistId);
  const malId = await anilistToMal(anilistId);

  if (kitsuId) {
    try {
      const res = await axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, { timeout: 5000 });
      const attr = res.data?.data?.attributes;
      if (attr) {
        const canonical = attr.canonicalTitle || '';
        const en = attr.titles?.en || '';
        const enJp = attr.titles?.en_jp || '';
        const jaJp = attr.titles?.ja_jp || '';
        const abbrev = attr.abbreviatedTitles || [];

        const synonyms = Array.from(
          new Set([en, enJp, jaJp, ...abbrev, canonical].filter((t): t is string => Boolean(t && t !== canonical)))
        );

        return {
          title: en || canonical || enJp || 'Unknown',
          romaji: enJp || canonical,
          english: en || canonical,
          synonyms,
          malId: malId || null,
        };
      }
    } catch {}
  }

  if (malId) {
    try {
      const res = await axios.get(`https://api.jikan.moe/v4/anime/${malId}`, { timeout: 5000 });
      const d = res.data?.data;
      if (d) {
        const titles = [d.title_english, d.title, d.title_japanese, ...(d.title_synonyms || [])].filter(Boolean);
        return {
          title: d.title_english || d.title || 'Unknown',
          romaji: d.title || '',
          english: d.title_english || d.title || '',
          synonyms: titles,
          malId,
        };
      }
    } catch {}
  }

  return {
    title: 'Unknown',
    romaji: '',
    english: '',
    synonyms: [],
    malId: malId || null,
  };
}

/**
 * Fallback trending anime from Kitsu
 */
export async function getTrendingFallback(limit: number = 20): Promise<FallbackMedia[]> {
  try {
    const res = await axios.get(`https://kitsu.io/api/edge/trending/anime?limit=${limit}`, { timeout: 6000 });
    const items = res.data?.data || [];
    return await Promise.all(
      items.map(async (item: any) => {
        const kitsuId = Number(item.id);
        const anilistId = await kitsuToAnilist(kitsuId);
        const malId = await anilistToMal(anilistId || 0);
        return formatKitsuToMedia(item, anilistId || (1000000 + kitsuId), malId);
      })
    );
  } catch {
    return [];
  }
}

/**
 * Fallback popular anime from Kitsu
 */
export async function getPopularFallback(page: number = 1, limit: number = 20): Promise<FallbackMedia[]> {
  try {
    const offset = (page - 1) * limit;
    const res = await axios.get(
      `https://kitsu.io/api/edge/anime?sort=-user_count&page[limit]=${limit}&page[offset]=${offset}`,
      { timeout: 6000 }
    );
    const items = res.data?.data || [];
    return await Promise.all(
      items.map(async (item: any) => {
        const kitsuId = Number(item.id);
        const anilistId = await kitsuToAnilist(kitsuId);
        const malId = await anilistToMal(anilistId || 0);
        return formatKitsuToMedia(item, anilistId || (1000000 + kitsuId), malId);
      })
    );
  } catch {
    return [];
  }
}

/**
 * Fallback top scored anime from Kitsu
 */
export async function getTopFallback(page: number = 1, limit: number = 20): Promise<FallbackMedia[]> {
  try {
    const offset = (page - 1) * limit;
    const res = await axios.get(
      `https://kitsu.io/api/edge/anime?sort=-average_rating&page[limit]=${limit}&page[offset]=${offset}`,
      { timeout: 6000 }
    );
    const items = res.data?.data || [];
    return await Promise.all(
      items.map(async (item: any) => {
        const kitsuId = Number(item.id);
        const anilistId = await kitsuToAnilist(kitsuId);
        const malId = await anilistToMal(anilistId || 0);
        return formatKitsuToMedia(item, anilistId || (1000000 + kitsuId), malId);
      })
    );
  } catch {
    return [];
  }
}

/**
 * Fallback episodes for /info/:id/episodes
 */
export async function getEpisodesFallback(anilistId: number): Promise<{
  success: boolean;
  animeId: number;
  title: string;
  totalEpisodes: number | null;
  episodes: any[];
  providers: string[];
}> {
  const kitsuId = await anilistToKitsu(anilistId);
  let title = 'Anime';
  let totalEpisodes: number | null = null;
  const eps: any[] = [];

  if (kitsuId) {
    try {
      const [animeRes, epRes] = await Promise.all([
        axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, { timeout: 5000 }),
        axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}/episodes?page[limit]=50`, { timeout: 5000 }),
      ]);

      const attr = animeRes.data?.data?.attributes;
      if (attr) {
        title = attr.canonicalTitle || attr.titles?.en || title;
        totalEpisodes = attr.episodeCount || null;
      }

      const epItems = epRes.data?.data || [];
      if (epItems.length > 0) {
        for (const ep of epItems) {
          const epAttr = ep.attributes || {};
          eps.push({
            number: epAttr.number,
            title: epAttr.canonicalTitle || `Episode ${epAttr.number}`,
            thumbnail: epAttr.thumbnail?.original || epAttr.thumbnail?.medium || null,
            url: null,
            site: 'Kitsu',
          });
        }
      }
    } catch {}
  }

  // If no episode objects were found but totalEpisodes exists, generate them
  if (eps.length === 0 && totalEpisodes) {
    for (let i = 1; i <= totalEpisodes; i++) {
      eps.push({
        number: i,
        title: `Episode ${i}`,
        thumbnail: null,
        url: null,
        site: null,
      });
    }
  }

  return {
    success: true,
    animeId: anilistId,
    title,
    totalEpisodes: totalEpisodes || eps.length,
    episodes: eps,
    providers: ['anidbapp', 'kiwi', 'pewe', 'bee', 'bonk', 'bun', 'ally', 'nun', 'twin', 'cog', 'moo', 'hop'],
  };
}

/**
 * Fallback upcoming anime from Kitsu
 */
export async function getUpcomingFallback(page: number = 1, limit: number = 20): Promise<FallbackMedia[]> {
  const offset = (page - 1) * limit;
  try {
    const res = await axios.get(
      `https://kitsu.io/api/edge/anime?filter[status]=upcoming&sort=-user_count&page[limit]=${limit}&page[offset]=${offset}`,
      { headers: { Accept: 'application/vnd.api+json' }, timeout: 6000 }
    );
    const items = res.data?.data || [];
    return await Promise.all(
      items.map(async (item: any) => {
        const kitsuId = Number(item.id);
        const anilistId = (await kitsuToAnilist(kitsuId)) || kitsuId;
        const malId = await anilistToMal(anilistId);
        return formatKitsuToMedia(item, anilistId, malId);
      })
    );
  } catch {
    return [];
  }
}

/**
 * Fallback recent/current airing anime from Kitsu
 */
export async function getRecentFallback(page: number = 1, limit: number = 20): Promise<FallbackMedia[]> {
  const offset = (page - 1) * limit;
  try {
    const res = await axios.get(
      `https://kitsu.io/api/edge/anime?filter[status]=current&sort=-user_count&page[limit]=${limit}&page[offset]=${offset}`,
      { headers: { Accept: 'application/vnd.api+json' }, timeout: 6000 }
    );
    const items = res.data?.data || [];
    return await Promise.all(
      items.map(async (item: any) => {
        const kitsuId = Number(item.id);
        const anilistId = (await kitsuToAnilist(kitsuId)) || kitsuId;
        const malId = await anilistToMal(anilistId);
        return formatKitsuToMedia(item, anilistId, malId);
      })
    );
  } catch {
    return [];
  }
}

/**
 * Fallback movies from Kitsu
 */
export async function getMoviesFallback(page: number = 1, limit: number = 20): Promise<FallbackMedia[]> {
  const offset = (page - 1) * limit;
  try {
    const res = await axios.get(
      `https://kitsu.io/api/edge/anime?filter[subtype]=movie&sort=-user_count&page[limit]=${limit}&page[offset]=${offset}`,
      { headers: { Accept: 'application/vnd.api+json' }, timeout: 6000 }
    );
    const items = res.data?.data || [];
    return await Promise.all(
      items.map(async (item: any) => {
        const kitsuId = Number(item.id);
        const anilistId = (await kitsuToAnilist(kitsuId)) || kitsuId;
        const malId = await anilistToMal(anilistId);
        return formatKitsuToMedia(item, anilistId, malId);
      })
    );
  } catch {
    return [];
  }
}

/**
 * Fallback characters from Jikan (MAL)
 */
export async function getCharactersFallback(anilistId: number): Promise<any[]> {
  const malId = await anilistToMal(anilistId);
  if (!malId) return [];
  try {
    const jRes = await axios.get(`https://api.jikan.moe/v4/anime/${malId}/characters`, { timeout: 5000 });
    const items = jRes.data?.data || [];
    return items.slice(0, 25).map((c: any) => ({
      id: c.character?.mal_id,
      name: {
        full: c.character?.name,
        native: null,
        alternative: [],
        userPreferred: c.character?.name,
      },
      image: {
        large: c.character?.images?.jpg?.image_url,
        medium: c.character?.images?.jpg?.image_url,
      },
      role: c.role || 'MAIN',
      gender: null,
      age: null,
      bloodType: null,
    }));
  } catch {
    return [];
  }
}

/**
 * Fallback recommendations from Jikan (MAL)
 */
export async function getRecommendationsFallback(anilistId: number): Promise<any[]> {
  const malId = await anilistToMal(anilistId);
  if (!malId) return [];
  try {
    const jRes = await axios.get(`https://api.jikan.moe/v4/anime/${malId}/recommendations`, { timeout: 5000 });
    const items = jRes.data?.data || [];
    return await Promise.all(
      items.slice(0, 15).map(async (r: any) => {
        const recMalId = r.entry?.mal_id;
        const recAlId = (await malToAnilist(recMalId)) || recMalId;
        return {
          id: recAlId,
          title: r.entry?.title || 'Unknown',
          coverImage: r.entry?.images?.jpg?.large_image_url || r.entry?.images?.jpg?.image_url || '',
          format: 'TV',
          episodes: null,
          averageScore: 80,
          rating: r.votes || 10,
        };
      })
    );
  } catch {
    return [];
  }
}

/**
 * Executes a simulated GraphQL response when AniList GraphQL is unavailable
 */
export async function executeGraphQLFallback(query: string, variables: any = {}): Promise<any> {
  const q = (query || '').toLowerCase();
  const page = variables?.page ? parseInt(variables.page, 10) : 1;
  const perPage = variables?.perPage ? parseInt(variables.perPage, 10) : 20;

  // 1. Single Media Query: Media(id: $id)
  if (q.includes('media(') && (q.includes('id:') || variables?.id)) {
    const id = variables?.id || (q.match(/id:\s*(\d+)/)?.[1] ? parseInt(q.match(/id:\s*(\d+)/)![1], 10) : null);
    if (id) {
      const media = await getAnimeInfoFallback(id);
      return { Media: media };
    }
  }

  // 2. Character Query
  if (q.includes('characters(')) {
    const id = variables?.id || (q.match(/id:\s*(\d+)/)?.[1] ? parseInt(q.match(/id:\s*(\d+)/)![1], 10) : null);
    const chars = id ? await getCharactersFallback(id) : [];
    return {
      Media: {
        id,
        characters: {
          edges: chars.map((c) => ({
            role: c.role,
            node: c,
          })),
        },
      },
    };
  }

  // 3. Recommendations Query
  if (q.includes('recommendations(')) {
    const id = variables?.id || (q.match(/id:\s*(\d+)/)?.[1] ? parseInt(q.match(/id:\s*(\d+)/)![1], 10) : null);
    const recs = id ? await getRecommendationsFallback(id) : [];
    return {
      Media: {
        id,
        recommendations: {
          edges: recs.map((r) => ({
            node: {
              id: r.id,
              rating: r.rating,
              mediaRecommendation: {
                id: r.id,
                title: { romaji: r.title, english: r.title, native: '', userPreferred: r.title },
                coverImage: { large: r.coverImage, medium: r.coverImage, color: null },
                format: r.format,
                episodes: r.episodes,
                averageScore: r.averageScore,
                popularity: 1000,
              },
            },
          })),
        },
      },
    };
  }

  // 4. Search Query
  if (variables?.search || variables?.q || q.includes('search:')) {
    const searchText = String(variables?.search || variables?.q || '').trim();
    const media = await searchAnimeFallback(searchText, { limit: perPage, page });
    return {
      Page: {
        pageInfo: {
          total: media.length,
          currentPage: page,
          lastPage: 1,
          perPage,
          hasNextPage: media.length >= perPage,
        },
        media,
      },
    };
  }

  // 5. Airing schedule query
  if (q.includes('airingschedules(') || q.includes('airing') || q.includes('status: releasing') || q.includes('status:releasing')) {
    const recent = await getRecentFallback(1, Math.min(perPage, 50));
    const now = Math.floor(Date.now() / 1000);
    const mediaList = recent.map((m, idx) => ({
      ...m,
      nextAiringEpisode: {
        episode: (m.episodes || 12) > 1 ? Math.floor(Math.random() * (m.episodes || 12)) + 1 : 1,
        timeUntilAiring: (idx + 1) * 7200,
        airingAt: now + (idx + 1) * 7200,
      },
    }));
    return {
      Page: {
        pageInfo: { total: mediaList.length, currentPage: 1, lastPage: 1, perPage, hasNextPage: false },
        media: mediaList,
      },
    };
  }

  // 6. Seasonal / Upcoming query
  if (q.includes('season:') || q.includes('not_yet_released') || variables?.status === 'NOT_YET_RELEASED') {
    const media = await getUpcomingFallback(page, perPage);
    return {
      Page: {
        pageInfo: { total: media.length, currentPage: page, lastPage: 1, perPage, hasNextPage: media.length >= perPage },
        media: media.length ? media : await getPopularFallback(page, perPage),
      },
    };
  }

  // 7. Popularity query
  if (q.includes('popularity_desc') || q.includes('popularity')) {
    const media = await getPopularFallback(page, perPage);
    return {
      Page: {
        pageInfo: { total: media.length, currentPage: page, lastPage: 1, perPage, hasNextPage: media.length >= perPage },
        media,
      },
    };
  }

  // 8. Top rated query
  if (q.includes('score_desc')) {
    const media = await getTopFallback(page, perPage);
    return {
      Page: {
        pageInfo: { total: media.length, currentPage: page, lastPage: 1, perPage, hasNextPage: media.length >= perPage },
        media,
      },
    };
  }

  // 9. Default: Trending
  const media = await getTrendingFallback(perPage);
  return {
    Page: {
      pageInfo: { total: media.length, currentPage: page, lastPage: 1, perPage, hasNextPage: media.length >= perPage },
      media,
    },
  };
}
