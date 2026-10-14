import crypto from 'crypto';
import axios from 'axios';
import { cacheGet, cacheSet, cacheDel } from '../utils/cache';
import { searchAnilist } from '../utils/mapper';
import { getAnikotoEpisodes, getAnikotoEmbedUrl } from './anikoto';

const BASE = 'https://yumezone.live';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface YumezoneSearchResult {
  id: string;
  title: string;
  url: string;
  image?: string;
  episodes?: number | null;
  status?: string;
  format?: string;
}

export interface YumezoneEpisode {
  id: string;
  num: number;
  title: string;
}

export interface YumezoneServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub' | 'raw';
}

export interface DirectWatchLink {
  quality: string;
  url: string;
  type: 'hls' | 'mp4';
}

export interface YumezoneStream {
  embedUrl: string;
  streamUrl: string;
  m3u8: string | null;
  type: 'hls';
  servers: string[];
  directWatchLinks: DirectWatchLink[];
  subtitles?: { url: string; lang: string; default?: boolean }[];
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
  provider?: string;
  referer?: string;
}

// ─────────────────────────────────────────────
// CIPHER & SIGNATURE GENERATION
// ─────────────────────────────────────────────

function makePRNG(seed: number) {
  let o = seed;
  return () => {
    let t = (o += 1831565813);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateNoiseKey(ts: number): string {
  const o = makePRNG(20260620);
  const t = makePRNG(98765432);
  let s = '';
  let e = '';
  for (let a = 0; a < 20; a++) {
    s += String.fromCharCode(33 + Math.floor(o() * 90));
    e += String.fromCharCode(33 + Math.floor(t() * 90));
  }
  const r = ts ^ 8272540;
  return `${s
    .split('')
    .map((a, i) => {
      const d = a.charCodeAt(0);
      const u = (r >> (i % 16)) & 7;
      return String.fromCharCode(d ^ u);
    })
    .join('')}:${e}`;
}

export function generateSignature(animeId: string | number, episodeNumber: number, ts: number): string {
  const s = generateNoiseKey(ts);
  const raw = `${animeId}:${episodeNumber}:${ts}:${s}`.split('').reverse().join('') + '_yume';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function decryptCipher(encryptedText: string, sig: string): any {
  const t = Buffer.from(encryptedText, 'base64').toString('binary');
  const s = Buffer.from(sig, 'utf-8');
  const e = new Uint8Array(t.length);
  for (let r = 0; r < t.length; r++) {
    const c = t.charCodeAt(r);
    const a = s[r % s.length];
    const i = (r * 3) % 256;
    e[r] = c ^ a ^ i;
  }
  return JSON.parse(Buffer.from(e).toString('utf-8'));
}

// ─────────────────────────────────────────────
// SEARCH & ID RESOLUTION
// ─────────────────────────────────────────────

export async function searchYumezone(query: string): Promise<YumezoneSearchResult[]> {
  const cacheKey = `yumezone:search:${query.toLowerCase().trim()}`;
  const cached = cacheGet<YumezoneSearchResult[]>(cacheKey);
  if (cached) return cached;

  const results: YumezoneSearchResult[] = [];

  // 1. Direct AniList metadata query (YumeZone uses AniList IDs as its primary key)
  try {
    const aniListResults = await searchAnilist(query);
    if (aniListResults && aniListResults.length > 0) {
      for (const m of aniListResults) {
        results.push({
          id: String(m.id),
          title: m.title,
          url: `${BASE}/watch/${m.id}`,
          image: m.coverImage,
          episodes: m.episodes,
          status: m.status,
          format: m.format,
        });
      }
    }
  } catch (err: any) {
    console.warn('[yumezone] AniList search fallback error:', err?.message || err);
  }

  // Fallback slug result if nothing resolved
  if (results.length === 0) {
    const isNum = /^\d+$/.test(query.trim());
    const id = isNum ? query.trim() : query.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
    results.push({
      id,
      title: query.trim(),
      url: `${BASE}/watch/${id}`,
    });
  }

  cacheSet(cacheKey, results, 'episodes');
  return results;
}

export async function findYumezoneId(titleOrId: string): Promise<string | null> {
  const trimmed = titleOrId.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  const results = await searchYumezone(trimmed);
  if (results.length > 0) {
    return results[0].id;
  }

  return null;
}

// ─────────────────────────────────────────────
// EPISODES LIST
// ─────────────────────────────────────────────

export async function getYumezoneEpisodes(animeId: string): Promise<YumezoneEpisode[]> {
  const cacheKey = `yumezone:eps:${animeId}`;
  const cached = cacheGet<YumezoneEpisode[]>(cacheKey);
  if (cached) return cached;

  let episodes: YumezoneEpisode[] = [];
  const numericId = parseInt(animeId, 10);

  // Query AniList GraphQL directly for episode count & metadata
  if (!isNaN(numericId)) {
    try {
      const query = `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { userPreferred romaji english }
          episodes
          nextAiringEpisode { episode timeUntilAiring }
          streamingEpisodes { title }
        }
      }`;

      const res = await axios.post(
        'https://graphql.anilist.co',
        { query, variables: { id: numericId } },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );

      const media = res.data?.data?.Media;
      if (media) {
        const nextEp = media.nextAiringEpisode?.episode;
        const total = nextEp ? nextEp - 1 : media.episodes || 12;
        const streamingList: any[] = media.streamingEpisodes || [];

        for (let i = 1; i <= total; i++) {
          const streamTitle = streamingList[i - 1]?.title;
          const epTitle = streamTitle && !streamTitle.startsWith('Episode')
            ? `Episode ${i} - ${streamTitle}`
            : `Episode ${i}`;

          episodes.push({
            id: `${animeId}:${i}`,
            num: i,
            title: epTitle,
          });
        }
      }
    } catch (err: any) {
      console.warn('[yumezone] AniList GraphQL fetch error for eps:', err?.message || err);
    }
  }

  // Fallback: try anikoto episodes if AniList returned empty
  if (episodes.length === 0) {
    try {
      const anikotoEps = await getAnikotoEpisodes(animeId);
      if (anikotoEps && anikotoEps.length > 0) {
        episodes = anikotoEps.map((e) => ({
          id: `${animeId}:${e.num}`,
          num: e.num,
          title: e.title || `Episode ${e.num}`,
        }));
      }
    } catch (_) {}
  }

  // Final fallback: generate 1..24
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
// SERVERS LIST
// ─────────────────────────────────────────────

export async function getYumezoneServers(episodeId: string): Promise<YumezoneServer[]> {
  const [animeId, epStr] = episodeId.includes(':') ? episodeId.split(':') : [episodeId, '1'];
  const ep = parseInt(epStr, 10) || 1;

  return [
    {
      name: 'YumeZone Master HLS (1080p Ultra HD)',
      sourceId: `yumezone::${animeId}::${ep}::direct::sub`,
      type: 'sub',
    },
    {
      name: 'YumeZone Megaplay (Full HD)',
      sourceId: `yumezone::${animeId}::${ep}::megaplay::sub`,
      type: 'sub',
    },
    {
      name: 'YumeZone VidWish (Fast Stream)',
      sourceId: `yumezone::${animeId}::${ep}::vidwish::sub`,
      type: 'sub',
    },
    {
      name: 'YumeZone English Dub (1080p Ultra HD)',
      sourceId: `yumezone::${animeId}::${ep}::direct::dub`,
      type: 'dub',
    },
    {
      name: 'YumeZone Megaplay (English Dub)',
      sourceId: `yumezone::${animeId}::${ep}::megaplay::dub`,
      type: 'dub',
    },
    {
      name: 'YumeZone VidWish (English Dub)',
      sourceId: `yumezone::${animeId}::${ep}::vidwish::dub`,
      type: 'dub',
    },
  ];
}

// ─────────────────────────────────────────────
// STREAM RESOLVER (Dynamic Cipher Authentication)
// ─────────────────────────────────────────────

export async function getYumezoneStream(sourceId: string, bypassCache = false): Promise<YumezoneStream | null> {
  const cacheKey = `yumezone:stream:${sourceId}`;
  if (!bypassCache) {
    const cached = cacheGet<YumezoneStream>(cacheKey);
    if (cached) return cached;
  } else {
    cacheDel(cacheKey);
  }

  // Parse: yumezone::{animeId}::{ep}::{serverPreference}::{lang}
  const parts = sourceId.split('::');
  let animeId = '180136';
  let ep = 1;
  let serverPref = 'direct';
  let lang: 'sub' | 'dub' = 'sub';

  if (parts.length >= 5) {
    animeId = parts[1];
    ep = parseInt(parts[2], 10) || 1;
    serverPref = parts[3];
    lang = parts[4] === 'dub' ? 'dub' : 'sub';
  } else if (parts.length >= 3) {
    animeId = parts[1];
    ep = parseInt(parts[2], 10) || 1;
  }

  try {
    const ts = Math.floor(Date.now() / 1000);
    const sig = generateSignature(animeId, ep, ts);
    const client_cipher_token = Buffer.from([...sig].reverse().join('')).toString('base64');

    const body = {
      anime_id: String(animeId),
      episode_number: ep,
      language: lang,
      sig,
      ts,
      client_cipher_token,
    };

    const res = await axios.post(`${BASE}/api/yume/watch/sources`, body, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'Origin': BASE,
        'Referer': `${BASE}/watch/${animeId}/${ep}`,
      },
      timeout: 15000,
    });

    const encryptedData = res.data?.ct || res.data?.encrypted;
    if (encryptedData) {
      const decrypted = decryptCipher(encryptedData, sig);

      // Determine main stream file
      let chosenFile: string = decrypted.video_link || '';
      let chosenEmbed: string = '';

      // Check server preference (megaplay, vidwish, or direct)
      if (serverPref === 'megaplay' && decrypted.hls_sources?.length) {
        const mpSource = decrypted.hls_sources.find((s: any) => /megaplay/i.test(s.label));
        if (mpSource?.file) chosenFile = mpSource.file;
      } else if (serverPref === 'vidwish' && decrypted.hls_sources?.length) {
        const vwSource = decrypted.hls_sources.find((s: any) => /vidwish/i.test(s.label));
        if (vwSource?.file) chosenFile = vwSource.file;
      } else if (!chosenFile && decrypted.hls_sources?.length) {
        chosenFile = decrypted.hls_sources[0].file;
      }

      if (serverPref === 'megaplay' && decrypted.embed_sources?.length) {
        const mpEmbed = decrypted.embed_sources.find((s: any) => /megaplay/i.test(s.name));
        if (mpEmbed?.url) chosenEmbed = mpEmbed.url;
      } else if (serverPref === 'vidwish' && decrypted.embed_sources?.length) {
        const vwEmbed = decrypted.embed_sources.find((s: any) => /vidwish/i.test(s.name));
        if (vwEmbed?.url) chosenEmbed = vwEmbed.url;
      }

      if (!chosenEmbed && decrypted.embed_sources?.length) {
        chosenEmbed = decrypted.embed_sources[0].url;
      }

      const streamUrl = chosenFile ? (chosenFile.startsWith('http') ? chosenFile : `${BASE}${chosenFile}`) : (chosenEmbed || '');

      const directWatchLinks: DirectWatchLink[] = [];
      if (chosenFile) {
        directWatchLinks.push({
          quality: '1080p Ultra HD (Master HLS)',
          url: chosenFile.startsWith('http') ? chosenFile : `${BASE}${chosenFile}`,
          type: 'hls',
        });
      }

      for (const hlsSrc of decrypted.hls_sources || []) {
        if (hlsSrc.file) {
          const fullUrl = hlsSrc.file.startsWith('http') ? hlsSrc.file : `${BASE}${hlsSrc.file}`;
          if (!directWatchLinks.some((l) => l.url === fullUrl)) {
            directWatchLinks.push({
              quality: `${hlsSrc.label || 'Alternative'} (HLS Stream)`,
              url: fullUrl,
              type: 'hls',
            });
          }
        }
      }

      const subtitles = (decrypted.subtitles || []).map((s: any) => ({
        url: s.file ? (s.file.startsWith('http') ? s.file : `${BASE}${s.file}`) : '',
        lang: s.label || s.language || 'English',
        default: Boolean(s.default),
      })).filter((s: any) => Boolean(s.url));

      const streamResult: YumezoneStream = {
        embedUrl: chosenEmbed || streamUrl,
        streamUrl,
        m3u8: streamUrl.includes('/p/') || streamUrl.includes('.m3u8') ? streamUrl : null,
        type: 'hls',
        servers: [
          'YumeZone Master HLS (1080p Ultra HD)',
          'YumeZone Megaplay',
          'YumeZone VidWish',
        ],
        directWatchLinks,
        subtitles,
        intro: decrypted.intro || null,
        outro: decrypted.outro || null,
        provider: decrypted.provider || 'YumeZone',
        referer: `${BASE}/watch/${animeId}/${ep}`,
      };

      cacheSet(cacheKey, streamResult, 'stream');
      return streamResult;
    }
  } catch (err: any) {
    console.warn(`[yumezone] Live source extraction error for ${animeId} ep ${ep}:`, err?.message || err);
  }

  // Resilience fallback: if YumeZone direct API experiences network interruption,
  // resolve through Anikoto/Megaplay provider mirror so playback is seamless
  try {
    const fallback = await getAnikotoEmbedUrl(`anikoto::${animeId}::${ep}::${lang}`);
    if (fallback && (fallback.m3u8 || fallback.embedUrl)) {
      const fallbackUrl = fallback.m3u8 || fallback.embedUrl;
      const streamResult: YumezoneStream = {
        embedUrl: fallback.embedUrl,
        streamUrl: fallbackUrl,
        m3u8: fallback.m3u8 || null,
        type: 'hls',
        servers: ['YumeZone Mirror HLS (1080p)'],
        directWatchLinks: [
          {
            quality: '1080p HD (Mirror)',
            url: fallbackUrl,
            type: 'hls',
          },
        ],
        subtitles: fallback.subtitles || [],
        provider: 'YumeZone Mirror',
        referer: fallback.referer || BASE,
      };
      cacheSet(cacheKey, streamResult, 'stream');
      return streamResult;
    }
  } catch (_) {}

  return null;
}
