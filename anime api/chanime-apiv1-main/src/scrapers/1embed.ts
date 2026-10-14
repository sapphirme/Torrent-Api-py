import axios from 'axios';
import crypto from 'crypto';
import { cacheGet, cacheSet } from '../utils/cache';

const BASE_URL = 'https://1embed.cc';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

export interface OneEmbedStream {
  embedUrl: string;
  streamUrl: string;
  m3u8: string | null;
  mp4: string | null;
  downloadUrl: string | null;
  type: 'hls';
  subtitles: Array<{ id?: string; url: string; label: string; lang: string; default?: boolean }>;
  servers: string[];
  directWatchLinks: Array<{ quality: string; url: string; type: 'hls'; proxyUrl?: string }>;
  referer: string;
  title?: string;
  backdrop?: string;
  poster?: string;
}

/**
 * Generate 1embed.cc authorization token
 * sha256 of `${n}:${t}:bcine_player_guard_${n % 1000}`
 */
export async function get1embedToken(): Promise<string> {
  const cacheKey = '1embed:auth_token';
  const cached = cacheGet<string>(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(`${BASE_URL}/api/token`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': `${BASE_URL}/`,
      },
      timeout: 8000,
    });
    const t = res.data;
    if (t && t.t && t.n && t.s) {
      const { t: tokenT, n: tokenN, s: tokenS } = t;
      const guardKey = `${tokenN}:${tokenT}:bcine_player_guard_${tokenN % 1000}`;
      const p = crypto.createHash('sha256').update(guardKey).digest('hex').slice(0, 16);
      const payload = JSON.stringify({ t: tokenT, n: tokenN, s: tokenS, p });
      const b64 = Buffer.from(payload).toString('base64');
      cacheSet(cacheKey, b64, 'stream'); // 5 min cache
      return b64;
    }
    return t?.legacyToken || '';
  } catch (err) {
    console.error('[1embed] Token error:', err);
    return '';
  }
}

/**
 * Resolve TMDB ID and Season from AniList ID
 */
export async function resolveTmdbInfo(anilistId: number | string): Promise<{ tmdbId: number; season: number } | null> {
  const numId = Number(anilistId);
  if (!numId || isNaN(numId)) return null;

  const cacheKey = `1embed:tmdb:${numId}`;
  const cached = cacheGet<{ tmdbId: number; season: number }>(cacheKey);
  if (cached) return cached;

  // 1. Try ARM API (Direct AniList -> TMDB mapping)
  try {
    const res = await axios.get(`https://arm.haglund.dev/api/v2/ids?source=anilist&id=${numId}`, {
      timeout: 5000,
    });
    if (res.data?.themoviedb) {
      const info = {
        tmdbId: Number(res.data.themoviedb),
        season: Number(res.data['themoviedb-season']) || 1,
      };
      cacheSet(cacheKey, info, 'mapping');
      return info;
    }
  } catch (_) {}

  // 2. Try Anify
  try {
    const anifyRes = await axios.get(`https://api.anify.tv/info/${numId}`, {
      params: { fields: 'mappings' },
      timeout: 4000,
    });
    const mappings = anifyRes.data?.mappings || [];
    const tmdbMap = mappings.find((m: any) => m.providerId === 'themoviedb' || m.providerId === 'tmdb');
    if (tmdbMap?.id) {
      const info = {
        tmdbId: Number(tmdbMap.id),
        season: 1,
      };
      cacheSet(cacheKey, info, 'mapping');
      return info;
    }
  } catch (_) {}

  return null;
}

/**
 * Fetch direct HLS stream from 1embed.cc
 */
export async function get1embedStream(
  tmdbId: number | string,
  season: number = 1,
  episode: number = 1,
  isMovie: boolean = false
): Promise<OneEmbedStream | null> {
  const token = await get1embedToken();
  if (!token) {
    console.warn('[1embed] Failed to obtain token');
    return null;
  }

  const queryType = isMovie ? 'movie' : 'tv';
  const sourceIds = ['1', '3', '2', '4'];
  let data: any = null;

  for (const sid of sourceIds) {
    const sourcesUrl = `${BASE_URL}/api/sources/${sid}/id=${tmdbId}?type=${queryType}&s=${season}&e=${episode}&ads=off&_st=${encodeURIComponent(token)}`;
    try {
      const res = await axios.get(sourcesUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': `${BASE_URL}/`,
          'X-Stream-Token': token,
        },
        timeout: 8000,
      });
      if (res.data && (res.data.directPlayableUrl || res.data.raw_stream_url || res.data.streams?.length || res.data.streamsList?.length)) {
        data = res.data;
        break;
      }
    } catch (_) {}
  }

  if (!data) return null;

  try {
    const primaryM3u8 = data.directPlayableUrl || data.proxied_stream_url || data.raw_stream_url || data.streams?.[0]?.url || null;
    if (!primaryM3u8) return null;

    const directWatchLinks: Array<{ quality: string; url: string; type: 'hls'; proxyUrl?: string }> = [];
    const servers: string[] = [];

    if (Array.isArray(data.streams)) {
      data.streams.forEach((st: any, idx: number) => {
        const url = st.workerProxyUrl || st.url || st.rawUrl;
        if (url) {
          const srvName = st.quality || `1Embed Server ${idx + 1}`;
          servers.push(srvName);
          directWatchLinks.push({
            quality: srvName,
            url,
            type: 'hls',
            proxyUrl: st.workerProxyUrl || url,
          });
        }
      });
    }

    if (directWatchLinks.length === 0) {
      servers.push('1Embed HLS 1080p');
      directWatchLinks.push({
        quality: '1Embed HLS 1080p',
        url: primaryM3u8,
        type: 'hls',
      });
    }

    const subtitles = (data.subtitles || []).map((sub: any, idx: number) => ({
      id: sub.id || `1embed-sub-${idx + 1}`,
      url: sub.url,
      label: sub.label || sub.lang || `Subtitle ${idx + 1}`,
      lang: sub.lang || 'en',
      default: !!sub.default,
    }));

    return {
      embedUrl: `${BASE_URL}/watch?type=${queryType}&id=${tmdbId}&s=${season}&e=${episode}`,
      streamUrl: primaryM3u8,
      m3u8: primaryM3u8,
      mp4: null,
      downloadUrl: primaryM3u8,
      type: 'hls',
      subtitles,
      servers,
      directWatchLinks,
      referer: BASE_URL,
      title: data.title,
      backdrop: data.backdrop,
      poster: data.poster,
    };
  } catch (err: any) {
    console.error('[1embed] Stream processing error:', err?.message || err);
    return null;
  }
}
