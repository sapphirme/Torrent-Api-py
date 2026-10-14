import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { cacheGet, cacheSet } from '../utils/cache';

const BASE = 'https://animesalt.cx';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${BASE}/`,
};

const http = axios.create({
  baseURL: BASE,
  headers: DEFAULT_HEADERS,
  timeout: 20000,
});

export interface AnimeSaltLanguage {
  id: string;
  name: string;
  code: string;
  nativeName?: string;
  flag?: string;
}

export const SUPPORTED_LANGUAGES: AnimeSaltLanguage[] = [
  { id: 'hindi', name: 'Hindi', code: 'hin', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { id: 'telugu', name: 'Telugu', code: 'tel', nativeName: 'తెలుగు', flag: '🇮🇳' },
  { id: 'tamil', name: 'Tamil', code: 'tam', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { id: 'japanese', name: 'Japanese', code: 'jpn', nativeName: '日本語', flag: '🇯🇵' },
  { id: 'korean', name: 'Korean', code: 'kor', nativeName: '한국어', flag: '🇰🇷' },
  { id: 'english', name: 'English', code: 'eng', nativeName: 'English', flag: '🇺🇸' },
  { id: 'bengali', name: 'Bengali', code: 'ben', nativeName: 'বাংলা', flag: '🇧🇩' },
  { id: 'malayalam', name: 'Malayalam', code: 'mal', nativeName: 'മലയാളം', flag: '🇮🇳' },
  { id: 'kannada', name: 'Kannada', code: 'kan', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳' },
];

export interface AnimeSaltAnimeItem {
  id: string;
  title: string;
  url: string;
  poster: string | null;
  type: 'series' | 'movie';
  languages: string[];
  isDub: boolean;
  isSub: boolean;
  genres: string[];
}

export interface AnimeSaltEpisode {
  id: string;
  num: number | string;
  title: string;
  url: string;
  thumbnail?: string | null;
}

export interface AnimeSaltDetail {
  id: string;
  title: string;
  synopsis: string;
  poster: string | null;
  banner: string | null;
  type: 'series' | 'movie';
  genres: string[];
  languages: string[];
  isDub: boolean;
  isSub: boolean;
  episodes: AnimeSaltEpisode[];
}

export interface AnimeSaltAudioTrack {
  name: string;
  language: string;
  code: string;
  url?: string;
  groupId?: string;
  isDefault?: boolean;
  selected?: boolean;
}

export interface AnimeSaltVideoSource {
  url: string;
  quality: string;
  isM3U8: boolean;
  bandwidth?: number;
  resolution?: string;
}

export interface AnimeSaltSubtitle {
  file: string;
  label: string;
  kind?: string;
  default?: boolean;
}

export interface AnimeSaltMultiLangLink {
  language: string;
  link: string;
  code?: string;
}

export interface AnimeSaltServer {
  name: string;
  info: string;
  embedUrl: string;
  index: number;
}

export interface AnimeSaltWatchResult {
  episodeId: string;
  title: string;
  selectedLanguage: string;
  selectedType: 'sub' | 'dub' | 'all';
  masterPlaylistUrl: string | null;
  sources: AnimeSaltVideoSource[];
  audioTracks: AnimeSaltAudioTrack[];
  selectedAudio: AnimeSaltAudioTrack | null;
  subtitles: AnimeSaltSubtitle[];
  multiLangLinks: AnimeSaltMultiLangLink[];
  servers: AnimeSaltServer[];
  headers: Record<string, string>;
}

export function normalizeLanguage(lang?: string | null): string | null {
  if (!lang) return null;
  const l = lang.trim().toLowerCase();
  if (l === 'hindi' || l === 'hin' || l === 'hi') return 'hindi';
  if (l === 'telugu' || l === 'tel' || l === 'te') return 'telugu';
  if (l === 'tamil' || l === 'tam' || l === 'ta') return 'tamil';
  if (l === 'japanese' || l === 'jpn' || l === 'ja' || l === 'jp') return 'japanese';
  if (l === 'korean' || l === 'kor' || l === 'ko') return 'korean';
  if (l === 'english' || l === 'eng' || l === 'en') return 'english';
  if (l === 'bengali' || l === 'ben' || l === 'bn') return 'bengali';
  if (l === 'malayalam' || l === 'mal' || l === 'ml') return 'malayalam';
  if (l === 'kannada' || l === 'kan' || l === 'kn') return 'kannada';
  return l;
}

export function getLanguageCode(lang: string): string {
  const normalized = normalizeLanguage(lang);
  const found = SUPPORTED_LANGUAGES.find(s => s.id === normalized);
  return found?.code || lang.slice(0, 3).toLowerCase();
}

/**
 * Returns supported languages list
 */
export function getSupportedLanguages(): AnimeSaltLanguage[] {
  return SUPPORTED_LANGUAGES;
}

/**
 * Parse an anime card from a list item element
 */
function parseAnimeCard($: any, el: any): AnimeSaltAnimeItem | null {
  const li = $(el);
  const id = li.attr('id') || '';
  const classList = (li.attr('class') || '').split(/\s+/);
  const isMovie = classList.includes('movies') || classList.includes('type-movies');
  const title = li.find('.entry-title').text().trim();
  const url = li.find('a.lnk-blk').attr('href') || li.find('a').first().attr('href') || '';
  if (!title && !url) return null;

  let poster = li.find('img').attr('data-src') || li.find('img').attr('src') || null;
  if (poster && poster.startsWith('//')) poster = 'https:' + poster;

  const categories = classList
    .filter(c => c.startsWith('category-'))
    .map(c => c.replace('category-', ''));

  const validLangIds = SUPPORTED_LANGUAGES.map(s => s.id);
  const languages = categories.filter(c => validLangIds.includes(c));

  // Determine sub / dub capabilities
  const isDub = languages.some(l => ['hindi', 'telugu', 'tamil', 'english', 'bengali', 'malayalam', 'kannada'].includes(l));
  const isSub = languages.includes('japanese') || categories.includes('sub') || categories.includes('subbed');

  const genres = categories.filter(
    c => !['anime', 'completed', 'ongoing', ...validLangIds].includes(c)
  );

  const cleanId = url
    ? url.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '')
    : id.replace(/^post-/, '');

  return {
    id: cleanId,
    title,
    url,
    poster,
    type: isMovie ? 'movie' : 'series',
    languages,
    isDub,
    isSub,
    genres,
  };
}

/**
 * Browse or list anime from animesalt.cx with selectable language and sub/dub filters
 */
export async function browseAnimeSalt(options: {
  language?: string;
  type?: 'sub' | 'dub' | 'all';
  page?: number;
  category?: string;
  sort?: string;
} = {}): Promise<{
  page: number;
  totalPages: number;
  totalCount: number;
  selectedLanguage: string;
  selectedType: 'sub' | 'dub' | 'all';
  results: AnimeSaltAnimeItem[];
}> {
  const lang = normalizeLanguage(options.language);
  const type = options.type || 'all';
  const page = Math.max(1, options.page || 1);

  let targetUrl = '';
  if (lang && lang !== 'all') {
    targetUrl = page > 1
      ? `/category/language/${lang}/page/${page}/`
      : `/category/language/${lang}/`;
  } else if (options.category) {
    targetUrl = page > 1
      ? `/category/genre/${options.category}/page/${page}/`
      : `/category/genre/${options.category}/`;
  } else {
    // Default browse series or language list
    targetUrl = page > 1 ? `/series/page/${page}/` : '/series/';
  }

  const cacheKey = `animesalt:browse:${targetUrl}:${lang}:${type}:${page}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return cached;

  const res = await http.get(targetUrl);
  const $ = cheerio.load(res.data);

  let results: AnimeSaltAnimeItem[] = [];
  $('li[id^="post-"]').each((_, el) => {
    const card = parseAnimeCard($, el);
    if (card) {
      if (type === 'dub' && !card.isDub && card.languages.length > 0 && !card.languages.some(l => l !== 'japanese')) {
        return;
      }
      if (type === 'sub' && !card.isSub && card.languages.length > 0 && !card.languages.includes('japanese')) {
        return;
      }
      results.push(card);
    }
  });

  // Calculate total pages
  let totalPages = 1;
  $('.navigation.pagination a.page-link').each((_, el) => {
    const num = parseInt($(el).text().trim(), 10);
    if (!isNaN(num) && num > totalPages) totalPages = num;
  });

  const payload = {
    page,
    totalPages,
    totalCount: results.length,
    selectedLanguage: lang || 'all',
    selectedType: type,
    results,
  };

  cacheSet(cacheKey, payload, 300); // 5 min cache
  return payload;
}

/**
 * Search animesalt.cx with selectable language and sub/dub filters
 */
export async function searchAnimeSalt(
  query: string,
  options: {
    language?: string;
    type?: 'sub' | 'dub' | 'all';
    page?: number;
  } = {}
): Promise<{
  query: string;
  page: number;
  totalPages: number;
  count: number;
  selectedLanguage: string;
  selectedType: 'sub' | 'dub' | 'all';
  results: AnimeSaltAnimeItem[];
}> {
  const q = (query || '').trim();
  if (!q) {
    return {
      query: '',
      page: 1,
      totalPages: 1,
      count: 0,
      selectedLanguage: options.language || 'all',
      selectedType: options.type || 'all',
      results: [],
    };
  }

  const lang = normalizeLanguage(options.language);
  const type = options.type || 'all';
  const page = Math.max(1, options.page || 1);

  const searchPath = page > 1
    ? `/page/${page}/?s=${encodeURIComponent(q)}`
    : `/?s=${encodeURIComponent(q)}`;

  const cacheKey = `animesalt:search:${q}:${page}:${lang}:${type}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return cached;

  const res = await http.get(searchPath);
  const $ = cheerio.load(res.data);

  let results: AnimeSaltAnimeItem[] = [];
  $('li[id^="post-"]').each((_, el) => {
    const card = parseAnimeCard($, el);
    if (card) {
      if (lang && lang !== 'all' && card.languages.length > 0 && !card.languages.includes(lang)) {
        return;
      }
      if (type === 'dub' && !card.isDub && card.languages.length > 0 && !card.languages.some(l => l !== 'japanese')) {
        return;
      }
      if (type === 'sub' && !card.isSub && card.languages.length > 0 && !card.languages.includes('japanese')) {
        return;
      }
      results.push(card);
    }
  });

  let totalPages = 1;
  $('.navigation.pagination a.page-link').each((_, el) => {
    const num = parseInt($(el).text().trim(), 10);
    if (!isNaN(num) && num > totalPages) totalPages = num;
  });

  const payload = {
    query: q,
    page,
    totalPages,
    count: results.length,
    selectedLanguage: lang || 'all',
    selectedType: type,
    results,
  };

  cacheSet(cacheKey, payload, 300);
  return payload;
}

/**
 * Get anime detail and episode list by slug or ID
 */
export async function getAnimeSaltInfo(idOrSlug: string): Promise<AnimeSaltDetail> {
  let cleanPath = idOrSlug.trim();
  cleanPath = cleanPath.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleanPath.startsWith('series/') && !cleanPath.startsWith('movies/') && !cleanPath.startsWith('episode/')) {
    cleanPath = `series/${cleanPath}`;
  }

  const cacheKey = `animesalt:info:${cleanPath}`;
  const cached = cacheGet<AnimeSaltDetail>(cacheKey);
  if (cached) return cached;

  const res = await http.get(`/${cleanPath}/`);
  const $ = cheerio.load(res.data);

  const title =
    $('h1.entry-title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().replace(/- Watch Now.*$/i, '').trim();

  const synopsis =
    $('.description p').text().trim() ||
    $('meta[property="og:description"]').attr('content') ||
    '';

  let poster =
    $('meta[property="og:image"]').attr('content') ||
    $('.post-thumbnail img').attr('data-src') ||
    $('.post-thumbnail img').attr('src') ||
    null;
  if (poster && poster.startsWith('//')) poster = 'https:' + poster;

  let banner =
    $('.backdrop img').attr('data-src') ||
    $('.backdrop img').attr('src') ||
    poster;
  if (banner && banner.startsWith('//')) banner = 'https:' + banner;

  const genres: string[] = [];
  $('a[href*="/category/genre/"]').each((_, el) => {
    const g = $(el).text().trim();
    if (g && !genres.includes(g)) genres.push(g);
  });

  const languages: string[] = [];
  $('a[href*="/category/language/"]').each((_, el) => {
    const l = $(el).text().trim().toLowerCase();
    if (l && !languages.includes(l)) languages.push(l);
  });

  const isMovie = cleanPath.startsWith('movies/');
  const episodes: AnimeSaltEpisode[] = [];

  if (isMovie) {
    episodes.push({
      id: cleanPath,
      num: 1,
      title: title || 'Movie',
      url: `${BASE}/${cleanPath}/`,
      thumbnail: poster,
    });
  } else {
    $('li .post.episodes').each((_, el) => {
      const epNumText = $(el).find('.num-epi').text().trim();
      const epTitle = $(el).find('.entry-title').text().trim();
      const epHref =
        $(el).find('a.lnk-blk').attr('href') ||
        $(el).closest('li').find('a[href*="/episode/"]').attr('href') ||
        '';

      let epThumbnail = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || null;
      if (epThumbnail && epThumbnail.startsWith('//')) epThumbnail = 'https:' + epThumbnail;

      const epId = epHref
        ? epHref.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '')
        : `episode-${epNumText}`;

      const numParsed = parseInt(epNumText, 10);

      episodes.push({
        id: epId,
        num: isNaN(numParsed) ? epNumText : numParsed,
        title: epTitle || `Episode ${epNumText}`,
        url: epHref || `${BASE}/${epId}/`,
        thumbnail: epThumbnail,
      });
    });
  }

  const validLangIds = SUPPORTED_LANGUAGES.map(s => s.id);
  const isDub = languages.some(l => ['hindi', 'telugu', 'tamil', 'english', 'bengali', 'malayalam', 'kannada'].includes(l));
  const isSub = languages.includes('japanese');

  const detail: AnimeSaltDetail = {
    id: cleanPath,
    title,
    synopsis,
    poster,
    banner,
    type: isMovie ? 'movie' : 'series',
    genres,
    languages,
    isDub,
    isSub,
    episodes,
  };

  cacheSet(cacheKey, detail, 1800); // 30 min cache
  return detail;
}

/**
 * Get episodes list only
 */
export async function getAnimeSaltEpisodes(idOrSlug: string): Promise<AnimeSaltEpisode[]> {
  const info = await getAnimeSaltInfo(idOrSlug);
  return info.episodes;
}

/**
 * Parse Master M3U8 for Audio Tracks and Quality Levels
 */
export function parseMasterM3U8(
  m3u8Text: string,
  baseUrl: string
): {
  audioTracks: AnimeSaltAudioTrack[];
  sources: AnimeSaltVideoSource[];
} {
  const audioTracks: AnimeSaltAudioTrack[] = [];
  const sources: AnimeSaltVideoSource[] = [];

  const lines = m3u8Text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Parse Audio Tracks
    // e.g.: #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="jpn",NAME="Japanese",DEFAULT=NO,AUTOSELECT=YES,URI="/hls/..."
    if (trimmed.startsWith('#EXT-X-MEDIA:') && trimmed.includes('TYPE=AUDIO')) {
      const langMatch = trimmed.match(/LANGUAGE=["']?([^,"']+)["']?/i);
      const nameMatch = trimmed.match(/NAME=["']?([^,"']+)["']?/i);
      const uriMatch = trimmed.match(/URI=["']?([^,"']+)["']?/i);
      const groupMatch = trimmed.match(/GROUP-ID=["']?([^,"']+)["']?/i);
      const defaultMatch = trimmed.match(/DEFAULT=(YES|NO)/i);

      if (uriMatch && uriMatch[1]) {
        let uri = uriMatch[1];
        if (uri.startsWith('/')) {
          try {
            const parsedBase = new URL(baseUrl);
            uri = `${parsedBase.origin}${uri}`;
          } catch {
            uri = `https://as-cdn26.top${uri}`;
          }
        } else if (!uri.startsWith('http')) {
          uri = new URL(uri, baseUrl).toString();
        }

        const rawLang = (langMatch ? langMatch[1] : '').toLowerCase();
        const rawName = nameMatch ? nameMatch[1] : '';

        // Determine friendly language & code
        let normalized = normalizeLanguage(rawName) || normalizeLanguage(rawLang) || rawLang;
        let code = rawLang || getLanguageCode(normalized);

        audioTracks.push({
          name: rawName || normalized,
          language: normalized,
          code: code,
          url: uri,
          groupId: groupMatch ? groupMatch[1] : undefined,
          isDefault: defaultMatch ? defaultMatch[1].toUpperCase() === 'YES' : false,
        });
      }
    }

    // Parse Stream Qualities
    // e.g.: #EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4096000,RESOLUTION=1920x1080,NAME="1080p",...
    if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
      const resMatch = trimmed.match(/RESOLUTION=([0-9x]+)/i);
      const nameMatch = trimmed.match(/NAME=["']?([^,"']+)["']?/i);
      const bwMatch = trimmed.match(/BANDWIDTH=([0-9]+)/i);

      const quality = nameMatch ? nameMatch[1] : (resMatch ? resMatch[1].split('x')[1] + 'p' : 'Auto');
      const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : undefined;
      const resolution = resMatch ? resMatch[1] : undefined;

      sources.push({
        url: baseUrl, // stream inherits master with selection params
        quality,
        isM3U8: true,
        bandwidth,
        resolution,
      });
    }
  }

  return { audioTracks, sources };
}

/**
 * Resolves an episode watch stream from animesalt.cx with selectable language and sub/dub options!
 */
export async function resolveAnimeSaltWatch(
  episodeIdOrUrl: string,
  options: {
    language?: string;
    type?: 'sub' | 'dub' | 'all';
    server?: number | string;
  } = {}
): Promise<AnimeSaltWatchResult> {
  let cleanPath = episodeIdOrUrl.trim();
  cleanPath = cleanPath.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleanPath.startsWith('episode/') && !cleanPath.startsWith('movies/')) {
    cleanPath = `episode/${cleanPath}`;
  }

  const requestedLanguage = normalizeLanguage(options.language);
  const requestedType = options.type || 'all';

  const cacheKey = `animesalt:watch:${cleanPath}:${requestedLanguage}:${requestedType}`;
  const cached = cacheGet<AnimeSaltWatchResult>(cacheKey);
  if (cached) return cached;

  const res = await http.get(`/${cleanPath}/`);
  const $ = cheerio.load(res.data);

  const episodeTitle =
    $('h1.entry-title').first().text().trim() ||
    $('h2.entry-title').first().text().trim() ||
    $('title').text().replace(/- Watch Now.*$/i, '').trim();

  // Extract server buttons
  const servers: AnimeSaltServer[] = [];
  $('.server-grid .server-btn').each((idx, el) => {
    const sName = $(el).find('.server-name').text().trim() || `SERVER ${idx + 1}`;
    const sInfo = $(el).find('.server-info').text().trim() || '';
    servers.push({
      name: sName,
      info: sInfo,
      embedUrl: '',
      index: idx,
    });
  });

  // Extract iframes from video player container
  $('aside.video-player .video').each((idx, el) => {
    const iframe = $(el).find('iframe');
    const embedUrl = iframe.attr('src') || iframe.attr('data-src') || '';
    if (servers[idx]) {
      servers[idx].embedUrl = embedUrl;
    } else if (embedUrl) {
      servers.push({
        name: `SERVER ${idx + 1}`,
        info: '',
        embedUrl,
        index: idx,
      });
    }
  });

  // If no server-grid found, check direct iframes
  if (servers.length === 0) {
    $('iframe').each((idx, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && (src.includes('as-cdn') || src.includes('player') || src.includes('stream') || src.includes('short.icu'))) {
        servers.push({
          name: `SERVER ${idx + 1}`,
          info: '',
          embedUrl: src,
          index: idx,
        });
      }
    });
  }

  let masterPlaylistUrl: string | null = null;
  let audioTracks: AnimeSaltAudioTrack[] = [];
  let sources: AnimeSaltVideoSource[] = [];
  const subtitles: AnimeSaltSubtitle[] = [];
  const multiLangLinks: AnimeSaltMultiLangLink[] = [];

  // 1. Check Server 1 (as-cdn FirePlayer / Multi-Audio HLS)
  const asCdnServer = servers.find(s => s.embedUrl.includes('as-cdn') || s.embedUrl.includes('/video/'));
  if (asCdnServer && asCdnServer.embedUrl) {
    try {
      const hashMatch = asCdnServer.embedUrl.match(/\/video\/([a-zA-Z0-9_-]+)/);
      const hash = hashMatch ? hashMatch[1] : '';

      let cdnHost = 'https://as-cdn26.top';
      try {
        const u = new URL(asCdnServer.embedUrl);
        cdnHost = u.origin;
      } catch {}

      if (hash) {
        const postData = new URLSearchParams({
          hash,
          r: `${BASE}/`,
        });

        const getVideoRes = await axios.post(
          `${cdnHost}/player/index.php?data=${hash}&do=getVideo`,
          postData.toString(),
          {
            headers: {
              Referer: asCdnServer.embedUrl,
              'User-Agent': UA,
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 15000,
          }
        );

        if (getVideoRes.data?.videoSource) {
          masterPlaylistUrl = getVideoRes.data.videoSource;

          // Add default master source
          sources.push({
            url: masterPlaylistUrl!,
            quality: 'Auto (Master HLS)',
            isM3U8: true,
          });

          // Fetch the master playlist to parse individual audio streams and qualities
          try {
            const m3u8Res = await axios.get(masterPlaylistUrl!, {
              headers: {
                Referer: `${cdnHost}/`,
                'User-Agent': UA,
              },
              timeout: 12000,
            });

            const parsed = parseMasterM3U8(m3u8Res.data, masterPlaylistUrl!);
            if (parsed.audioTracks.length > 0) {
              audioTracks = parsed.audioTracks;
            }
            if (parsed.sources.length > 0) {
              // Append resolutions
              for (const s of parsed.sources) {
                if (!sources.some(existing => existing.quality === s.quality)) {
                  sources.push(s);
                }
              }
            }
          } catch (e: any) {
            console.warn('[AnimeSalt] Failed to fetch/parse master m3u8:', e.message);
          }
        }
      }

      // Check for subtitles in player page
      try {
        const playerPageRes = await axios.get(asCdnServer.embedUrl, {
          headers: { Referer: `${BASE}/`, 'User-Agent': UA },
          timeout: 10000,
        });
        const subMatch = playerPageRes.data.match(/playerjsSubtitle\s*=\s*["']([^"']+)["']/i);
        if (subMatch && subMatch[1]) {
          subtitles.push({
            file: subMatch[1].startsWith('//') ? 'https:' + subMatch[1] : subMatch[1],
            label: 'English',
            kind: 'captions',
            default: true,
          });
        }
      } catch {}
    } catch (err: any) {
      console.warn('[AnimeSalt] Error resolving as-cdn server:', err.message);
    }
  }

  // 2. Check Server 2 (multi-lang-plyr with base64 data)
  const multiLangServer = servers.find(s => s.embedUrl.includes('multi-lang-plyr') || s.embedUrl.includes('data='));
  if (multiLangServer && multiLangServer.embedUrl) {
    try {
      const urlObj = new URL(multiLangServer.embedUrl, BASE);
      const dataParam = urlObj.searchParams.get('data');
      if (dataParam) {
        const decodedJson = Buffer.from(decodeURIComponent(dataParam), 'base64').toString('utf-8');
        const parsedLinks = JSON.parse(decodedJson);
        if (Array.isArray(parsedLinks)) {
          for (const item of parsedLinks) {
            if (item.language && item.link) {
              const langNorm = normalizeLanguage(item.language) || item.language.toLowerCase();
              const langCode = getLanguageCode(langNorm);
              multiLangLinks.push({
                language: item.language,
                link: item.link,
                code: langCode,
              });

              // Also ensure it's in audioTracks if not already present
              if (!audioTracks.some(a => a.language === langNorm || a.code === langCode)) {
                audioTracks.push({
                  name: item.language,
                  language: langNorm,
                  code: langCode,
                  url: item.link,
                });
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[AnimeSalt] Error parsing multi-lang-plyr data:', err.message);
    }
  }

  // 3. Check MegaPlay / MegaCloud server
  const megaServer = servers.find(s => s.embedUrl.includes('megaplay.buzz') || s.embedUrl.includes('/stream/s-2/'));
  if (megaServer && megaServer.embedUrl) {
    try {
      const megaRes = await axios.get(megaServer.embedUrl, {
        headers: { Referer: `${BASE}/`, 'User-Agent': UA },
        timeout: 10000,
      });
      const dataIdMatch = megaRes.data.match(/data-id=["']([0-9]+)["']/);
      if (dataIdMatch && dataIdMatch[1]) {
        const dataId = dataIdMatch[1];
        const sourcesRes = await axios.get(`https://megaplay.buzz/stream/getSources?id=${dataId}`, {
          headers: { Referer: megaServer.embedUrl, 'User-Agent': UA },
          timeout: 10000,
        });
        if (sourcesRes.data?.tracks && Array.isArray(sourcesRes.data.tracks)) {
          for (const t of sourcesRes.data.tracks) {
            if (t.file) {
              subtitles.push({
                file: t.file,
                label: t.label || 'Subtitle',
                kind: t.kind || 'captions',
                default: !!t.default,
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[AnimeSalt] Error parsing megaplay server:', err.message);
    }
  }

  // 4. Handle Language & Sub/Dub Selection (Selectable REST Call!)
  let selectedAudio: AnimeSaltAudioTrack | null = null;

  if (requestedLanguage && requestedLanguage !== 'all') {
    // Find track matching requested language
    selectedAudio =
      audioTracks.find(
        a =>
          a.language.toLowerCase() === requestedLanguage ||
          a.code.toLowerCase() === getLanguageCode(requestedLanguage) ||
          a.name.toLowerCase() === requestedLanguage
      ) || null;
  } else if (requestedType === 'dub') {
    // Prioritize Hindi / Telugu / Tamil / English
    selectedAudio =
      audioTracks.find(a => ['hindi', 'telugu', 'tamil', 'english'].includes(a.language.toLowerCase())) ||
      audioTracks[0] ||
      null;
  } else if (requestedType === 'sub') {
    // Prioritize Japanese / Korean
    selectedAudio =
      audioTracks.find(a => ['japanese', 'korean'].includes(a.language.toLowerCase())) ||
      audioTracks[0] ||
      null;
  } else {
    selectedAudio = audioTracks[0] || null;
  }

  // Mark selected track
  if (selectedAudio) {
    for (const a of audioTracks) {
      a.selected = a.language === selectedAudio.language || a.code === selectedAudio.code;
    }
  }

  const result: AnimeSaltWatchResult = {
    episodeId: cleanPath,
    title: episodeTitle,
    selectedLanguage: selectedAudio?.language || requestedLanguage || 'all',
    selectedType: requestedType,
    masterPlaylistUrl,
    sources,
    audioTracks,
    selectedAudio,
    subtitles,
    multiLangLinks,
    servers,
    headers: {
      Referer: 'https://as-cdn26.top/',
      'User-Agent': UA,
    },
  };

  cacheSet(cacheKey, result, 300); // 5 min cache for streams
  return result;
}

function normalizeSaltText(text: string): string {
  return text
    .toLowerCase()
    .replace(/season\s*(\d+)/gi, 's$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function calculateSaltSimilarity(str1: string, str2: string): number {
  const s1 = normalizeSaltText(str1);
  const s2 = normalizeSaltText(str2);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;

  const words1 = s1.split(/\s+/).filter(Boolean);
  const words2 = s2.split(/\s+/).filter(Boolean);

  const set1 = new Set(words1);
  const set2 = new Set(words2);
  let intersection = 0;
  for (const w of set1) {
    if (set2.has(w)) intersection++;
  }
  const union = new Set([...words1, ...words2]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  if (s1.includes(s2) || s2.includes(s1)) {
    const ratio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
    return Math.max(jaccard, 0.65 + 0.35 * ratio);
  }

  return jaccard;
}

/**
 * Standard provider search compatibility function with smart title matching
 */
export async function findAnimeSaltId(titleOrTitles: string | string[]): Promise<string | null> {
  const rawList = Array.isArray(titleOrTitles) ? titleOrTitles : [titleOrTitles];
  const validTitles = rawList
    .map(t => (t || '').trim())
    .filter(t => t.length > 0);

  if (!validTitles.length) return null;

  const candidates: { id: string; score: number; title: string }[] = [];
  const seenIds = new Set<string>();

  for (const q of validTitles.slice(0, 3)) {
    if (q.length <= 2 && validTitles.length > 1) continue;
    try {
      const searchRes = await searchAnimeSalt(q);
      for (const item of searchRes.results) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        let maxScore = 0;
        for (const target of validTitles) {
          const score = calculateSaltSimilarity(target, item.title);
          if (score > maxScore) maxScore = score;
        }

        if (maxScore >= 0.45) {
          candidates.push({ id: item.id, score: maxScore, title: item.title });
        }
      }
      if (candidates.some(c => c.score >= 0.95)) break;
    } catch {
      // Continue to next title variant
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].id;
}
