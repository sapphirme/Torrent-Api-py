import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { cacheGet, cacheSet } from './cache';

// In-memory bidirectional ID lookup maps
const malToAl = new Map<number, number>();
const kitsuToAl = new Map<number, number>();
const alToMal = new Map<number, number>();
const alToKitsu = new Map<number, number>();
const titleToAl = new Map<string, number>();

let initialized = false;

// Initialize datasets on module load
export function initIdMapping(): void {
  if (initialized) return;
  initialized = true;

  try {
    const dataPath = path.join(process.cwd(), 'chanime-apiv1-main', 'data', 'anime-list-mini.json');
    const altDataPath = path.join(process.cwd(), 'data', 'anime-list-mini.json');
    const targetPath = fs.existsSync(dataPath) ? dataPath : fs.existsSync(altDataPath) ? altDataPath : null;

    if (targetPath) {
      const content = fs.readFileSync(targetPath, 'utf8');
      const list = JSON.parse(content);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item.anilist_id) {
            const alId = Number(item.anilist_id);
            if (item.mal_id) {
              const malId = Number(item.mal_id);
              malToAl.set(malId, alId);
              alToMal.set(alId, malId);
            }
            if (item.kitsu_id) {
              const kitsuId = Number(item.kitsu_id);
              kitsuToAl.set(kitsuId, alId);
              alToKitsu.set(alId, kitsuId);
            }
          }
        }
        console.log(`[IDMapping] Loaded ${malToAl.size} MAL and ${kitsuToAl.size} Kitsu mappings into memory.`);
      }
    } else {
      console.warn('[IDMapping] anime-list-mini.json not found locally; will fetch online as needed.');
    }
  } catch (err: any) {
    console.error('[IDMapping] Failed to load offline mapping dataset:', err?.message || err);
  }
}

// Ensure init runs
initIdMapping();

/**
 * Convert MyAnimeList ID -> AniList ID
 */
export async function malToAnilist(malId: number): Promise<number | null> {
  if (!malId || isNaN(malId)) return null;

  // 1. O(1) in-memory dataset lookup
  if (malToAl.has(malId)) {
    return malToAl.get(malId)!;
  }

  // 2. Runtime cache check
  const cacheKey = `mal2al:${malId}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached) return cached;

  // 3. Kitsu Mappings API lookup
  try {
    const res = await axios.get(`https://kitsu.io/api/edge/mappings?filter[external_site]=myanimelist/anime&filter[external_id]=${malId}&include=item`, {
      timeout: 5000,
    });
    const mappings = res.data?.data || [];
    const itemId = mappings[0]?.relationships?.item?.data?.id;
    if (itemId) {
      const kitsuId = Number(itemId);
      // Check if Kitsu ID has an AniList mapping in memory
      if (kitsuToAl.has(kitsuId)) {
        const alId = kitsuToAl.get(kitsuId)!;
        malToAl.set(malId, alId);
        alToMal.set(alId, malId);
        cacheSet(cacheKey, alId);
        return alId;
      }

      // Fetch Kitsu item mappings
      const itemMappingsRes = await axios.get(`https://kitsu.io/api/edge/anime/${itemId}/mappings`, { timeout: 5000 });
      for (const m of itemMappingsRes.data?.data || []) {
        if (m.attributes?.externalSite === 'anilist/anime' && m.attributes?.externalId) {
          const alId = parseInt(m.attributes.externalId, 10);
          if (!isNaN(alId)) {
            malToAl.set(malId, alId);
            alToMal.set(alId, malId);
            kitsuToAl.set(kitsuId, alId);
            cacheSet(cacheKey, alId);
            return alId;
          }
        }
      }
    }
  } catch {}

  // 4. Jikan external links fallback
  try {
    const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime/${malId}/external`, { timeout: 5000 });
    const links = jikanRes.data?.data || [];
    for (const l of links) {
      if (l.name?.toLowerCase().includes('anilist') || l.url?.includes('anilist.co/anime/')) {
        const match = l.url.match(/anilist\.co\/anime\/(\d+)/);
        if (match) {
          const alId = parseInt(match[1], 10);
          if (!isNaN(alId)) {
            malToAl.set(malId, alId);
            alToMal.set(alId, malId);
            cacheSet(cacheKey, alId);
            return alId;
          }
        }
      }
    }
  } catch {}

  // 5. Anify mappings fallback
  try {
    const anifyRes = await axios.get(`https://api.anify.tv/info/${malId}?fields=mappings`, { timeout: 4000 });
    const mappings = anifyRes.data?.mappings || [];
    for (const m of mappings) {
      if (m.providerId === 'anilist' && m.id) {
        const alId = parseInt(m.id, 10);
        if (!isNaN(alId)) {
          malToAl.set(malId, alId);
          alToMal.set(alId, malId);
          cacheSet(cacheKey, alId);
          return alId;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Convert Jikan ID -> AniList ID (Jikan uses MAL IDs)
 */
export async function jikanToAnilist(jikanId: number | string): Promise<number | null> {
  const numId = typeof jikanId === 'string' ? parseInt(jikanId, 10) : jikanId;
  return malToAnilist(numId);
}

/**
 * Convert Kitsu ID -> AniList ID
 */
export async function kitsuToAnilist(kitsuId: number | string): Promise<number | null> {
  const numId = typeof kitsuId === 'string' ? parseInt(kitsuId, 10) : kitsuId;
  if (!numId || isNaN(numId)) return null;

  // 1. In-memory lookup
  if (kitsuToAl.has(numId)) {
    return kitsuToAl.get(numId)!;
  }

  // 2. Cache lookup
  const cacheKey = `kitsu2al:${numId}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached) return cached;

  // 3. Kitsu mappings API
  try {
    const res = await axios.get(`https://kitsu.io/api/edge/anime/${numId}/mappings`, { timeout: 5000 });
    const mappings = res.data?.data || [];
    for (const m of mappings) {
      if (m.attributes?.externalSite === 'anilist/anime' && m.attributes?.externalId) {
        const alId = parseInt(m.attributes.externalId, 10);
        if (!isNaN(alId)) {
          kitsuToAl.set(numId, alId);
          alToKitsu.set(alId, numId);
          cacheSet(cacheKey, alId);
          return alId;
        }
      }
    }
    // Also check if MAL ID was provided in mappings
    for (const m of mappings) {
      if (m.attributes?.externalSite === 'myanimelist/anime' && m.attributes?.externalId) {
        const malId = parseInt(m.attributes.externalId, 10);
        if (!isNaN(malId)) {
          const alId = await malToAnilist(malId);
          if (alId) {
            kitsuToAl.set(numId, alId);
            alToKitsu.set(alId, numId);
            cacheSet(cacheKey, alId);
            return alId;
          }
        }
      }
    }
  } catch {}

  // 4. Kitsu anime title search matching
  try {
    const animeRes = await axios.get(`https://kitsu.io/api/edge/anime/${numId}`, { timeout: 5000 });
    const attr = animeRes.data?.data?.attributes;
    const title = attr?.canonicalTitle || attr?.titles?.en || attr?.titles?.en_jp;
    if (title) {
      const cleanTitle = title.toLowerCase().trim();
      if (titleToAl.has(cleanTitle)) {
        const alId = titleToAl.get(cleanTitle)!;
        kitsuToAl.set(numId, alId);
        alToKitsu.set(alId, numId);
        cacheSet(cacheKey, alId);
        return alId;
      }
    }
  } catch {}

  return null;
}

/**
 * Convert AniList ID -> MyAnimeList ID
 */
export async function anilistToMal(anilistId: number): Promise<number | null> {
  if (!anilistId || isNaN(anilistId)) return null;

  if (alToMal.has(anilistId)) {
    return alToMal.get(anilistId)!;
  }

  const cacheKey = `al2mal:${anilistId}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached) return cached;

  // Try Kitsu mappings filter
  try {
    const res = await axios.get(`https://kitsu.io/api/edge/mappings?filter[external_site]=anilist/anime&filter[external_id]=${anilistId}&include=item`, { timeout: 5000 });
    const mappings = res.data?.data || [];
    const itemId = mappings[0]?.relationships?.item?.data?.id;
    if (itemId) {
      const itemMappingsRes = await axios.get(`https://kitsu.io/api/edge/anime/${itemId}/mappings`, { timeout: 5000 });
      for (const m of itemMappingsRes.data?.data || []) {
        if (m.attributes?.externalSite === 'myanimelist/anime' && m.attributes?.externalId) {
          const malId = parseInt(m.attributes.externalId, 10);
          if (!isNaN(malId)) {
            alToMal.set(anilistId, malId);
            malToAl.set(malId, anilistId);
            cacheSet(cacheKey, malId);
            return malId;
          }
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Convert AniList ID -> Kitsu ID
 */
export async function anilistToKitsu(anilistId: number): Promise<number | null> {
  if (!anilistId || isNaN(anilistId)) return null;

  if (alToKitsu.has(anilistId)) {
    return alToKitsu.get(anilistId)!;
  }

  const cacheKey = `al2kitsu:${anilistId}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(`https://kitsu.io/api/edge/mappings?filter[external_site]=anilist/anime&filter[external_id]=${anilistId}&include=item`, { timeout: 5000 });
    const mappings = res.data?.data || [];
    const itemId = mappings[0]?.relationships?.item?.data?.id;
    if (itemId) {
      const kitsuId = parseInt(itemId, 10);
      if (!isNaN(kitsuId)) {
        alToKitsu.set(anilistId, kitsuId);
        kitsuToAl.set(kitsuId, anilistId);
        cacheSet(cacheKey, kitsuId);
        return kitsuId;
      }
    }
  } catch {}

  return null;
}

/**
 * Resolve any ID / input into an AniList ID
 */
export async function resolveAnyToAnilist(input: {
  anilistId?: string | number | null;
  malId?: string | number | null;
  kitsuId?: string | number | null;
  jikanId?: string | number | null;
  slug?: string | null;
}): Promise<number | null> {
  if (input.anilistId) {
    const parsed = typeof input.anilistId === 'number' ? input.anilistId : parseInt(input.anilistId, 10);
    if (!isNaN(parsed)) return parsed;
  }

  if (input.malId) {
    const parsed = typeof input.malId === 'number' ? input.malId : parseInt(input.malId, 10);
    if (!isNaN(parsed)) {
      const al = await malToAnilist(parsed);
      if (al) return al;
    }
  }

  if (input.jikanId) {
    const parsed = typeof input.jikanId === 'number' ? input.jikanId : parseInt(input.jikanId, 10);
    if (!isNaN(parsed)) {
      const al = await jikanToAnilist(parsed);
      if (al) return al;
    }
  }

  if (input.kitsuId) {
    const al = await kitsuToAnilist(input.kitsuId);
    if (al) return al;
  }

  return null;
}

/**
 * Get unified cross-mappings for an ID
 */
export async function getCompleteCrossMapping(
  id: number | string,
  type: 'anilist' | 'mal' | 'kitsu' | 'jikan'
): Promise<{
  originalId: number | string;
  source: string;
  anilistId: number | null;
  malId: number | null;
  kitsuId: number | null;
}> {
  let anilistId: number | null = null;
  let malId: number | null = null;
  let kitsuId: number | null = null;

  const num = typeof id === 'string' ? parseInt(id, 10) : id;

  if (type === 'anilist') {
    anilistId = num;
    malId = await anilistToMal(num);
    kitsuId = await anilistToKitsu(num);
  } else if (type === 'mal' || type === 'jikan') {
    malId = num;
    anilistId = await malToAnilist(num);
    if (anilistId) {
      kitsuId = await anilistToKitsu(anilistId);
    }
  } else if (type === 'kitsu') {
    kitsuId = num;
    anilistId = await kitsuToAnilist(num);
    if (anilistId) {
      malId = await anilistToMal(anilistId);
    }
  }

  return {
    originalId: id,
    source: type,
    anilistId,
    malId,
    kitsuId,
  };
}
