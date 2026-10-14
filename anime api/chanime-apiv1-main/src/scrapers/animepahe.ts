import axios from 'axios';
import * as cheerio from 'cheerio';
import { cacheGet, cacheSet } from '../utils/cache';

export const PRIMARY_DOMAIN = 'animepahe.ch';
export const SECONDARY_DOMAIN = 'animepahe.ng';
export const DOMAINS = [PRIMARY_DOMAIN, SECONDARY_DOMAIN, 'animepahe.su', 'animepahe.ru'] as const;
export type PaheDomain = typeof DOMAINS[number];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface PaheSearchResult { id: string; slug: string; title: string; url: string; image?: string; domain: string; latest?: string; }
export interface PaheEpisode { id: string; num: number; title: string; url: string; domain: string; }
export interface PaheServer { name: string; sourceId: string; type: 'sub' | 'dub'; domain: string; embedUrl: string; }
export interface PaheStream { embedUrl: string; streamUrl: string; mp4: string | null; m3u8: string | null; downloadUrl: string | null; type: 'mp4' | 'hls' | 'embed'; subtitles: any[]; servers: string[]; directWatchLinks: any[]; referer: string; }

function extractSlug(url: string) { return url.replace(/\/$/, '').split('/').pop() || ''; }

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/season\s*(\d+)/gi, 's$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
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

export async function searchAnimePahe(query: string, domain: string = PRIMARY_DOMAIN): Promise<PaheSearchResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const cacheKey = `pahe:search:${domain}:${cleanQ.toLowerCase()}`;
  const cached = cacheGet<PaheSearchResult[]>(cacheKey);
  if (cached) return cached;

  try {
    const params = new URLSearchParams();
    params.append('action', 'ts_ac_do_search');
    params.append('ts_ac_query', cleanQ);
    const res = await axios.post(`https://${domain}/wp-admin/admin-ajax.php`, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        'Referer': `https://${domain}/`,
      },
      timeout: 10000,
    });
    const items = res.data?.series?.[0]?.all || [];
    const results: PaheSearchResult[] = items.map((item: any) => ({
      id: extractSlug(item.post_link || ''),
      slug: extractSlug(item.post_link || ''),
      title: (item.post_title || '').trim(),
      url: item.post_link,
      image: item.post_image,
      domain,
      latest: item.post_latest,
    })).filter((r: any) => r.slug);

    if (results.length > 0) {
      cacheSet(cacheKey, results, 'episodes');
    }
    return results;
  } catch (err) {
    return [];
  }
}

export async function findAnimePaheSlug(titles: string | string[], domain: string = PRIMARY_DOMAIN): Promise<{ slug: string; domain: string; title: string } | null> {
  const rawList = Array.isArray(titles) ? titles : [titles];
  const validTitles = rawList
    .map(t => (t || '').trim())
    .filter(t => t.length > 0);

  if (!validTitles.length) return null;

  // Prefer longer, non-acronym titles for search to avoid ambiguous partial matches
  const searchQueries = [...validTitles].sort((a, b) => {
    const aIsShort = a.length <= 3;
    const bIsShort = b.length <= 3;
    if (aIsShort && !bIsShort) return 1;
    if (!aIsShort && bIsShort) return -1;
    return b.length - a.length;
  });

  const candidates: { candidate: PaheSearchResult; score: number }[] = [];
  const seenSlugs = new Set<string>();

  for (const q of searchQueries.slice(0, 4)) {
    if (q.length <= 2 && searchQueries.length > 1) continue;
    const searchRes = await searchAnimePahe(q, domain);

    for (const item of searchRes) {
      if (seenSlugs.has(item.slug)) continue;
      seenSlugs.add(item.slug);

      // Score against all valid titles
      let maxScore = 0;
      for (const target of validTitles) {
        const titleScore = calculateSimilarity(target, item.title);
        const slugScore = calculateSimilarity(target, item.slug.replace(/-/g, ' '));
        const score = Math.max(titleScore, slugScore);
        if (score > maxScore) maxScore = score;
      }

      if (maxScore >= 0.45) {
        candidates.push({ candidate: item, score: maxScore });
      }
    }

    // If an exact match is found, exit early
    if (candidates.some(c => c.score >= 0.95)) break;
  }

  if (!candidates.length) {
    for (const t of validTitles) {
      const slugCandidate = t.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
      if (slugCandidate) {
        try {
          const checkRes = await axios.get(`https://${domain}/series/${slugCandidate}/`, {
            headers: { 'User-Agent': USER_AGENT, 'Referer': `https://${domain}/` },
            timeout: 5000,
            validateStatus: null,
          });
          if (checkRes.status === 200) {
            return { slug: slugCandidate, domain, title: t };
          }
        } catch {}
      }
    }
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    slug: best.candidate.slug,
    domain,
    title: best.candidate.title,
  };
}

export async function getAnimePaheEpisodes(seriesSlug: string | { slug: string; domain?: string }, domain: string = PRIMARY_DOMAIN): Promise<PaheEpisode[]> {
  const actualDomain = (typeof seriesSlug === 'object' && seriesSlug?.domain) ? seriesSlug.domain : domain;
  const rawSlug = typeof seriesSlug === 'object' ? seriesSlug?.slug : seriesSlug;
  const cleanSlug = String(rawSlug || '').replace(/^https?:\/\/[^\/]+\/(?:series\/)?/, '').replace(/^\/+|\/+$/g, '');
  if (!cleanSlug) return [];

  const cacheKey = `pahe:eps:${actualDomain}:${cleanSlug}`;
  const cached = cacheGet<PaheEpisode[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(`https://${actualDomain}/series/${cleanSlug}/`, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': `https://${actualDomain}/` },
      timeout: 12000,
    });
    const $ = cheerio.load(res.data);
    const eps: PaheEpisode[] = [];
    $('.eplister ul li').each((_, el) => {
      const epUrl = $(el).find('a').attr('href') || '';
      const epNumStr = $(el).find('.epl-num').text().trim() || $(el).find('.epl-title').text().match(/\d+/)?.[0] || '0';
      const epNum = parseFloat(epNumStr);
      if (epUrl && !isNaN(epNum)) {
        eps.push({ id: extractSlug(epUrl), num: epNum, title: `Episode ${epNum}`, url: epUrl, domain: actualDomain });
      }
    });

    $('a[href*="-episode-"]').each((_, el) => {
      const epUrl = $(el).attr('href') || '';
      const numMatch = epUrl.match(/episode-(\d+(?:\.\d+)?)/i);
      if (numMatch) {
        const epNum = parseFloat(numMatch[1]);
        if (!eps.some(e => e.num === epNum)) {
          eps.push({
            id: extractSlug(epUrl),
            num: epNum,
            title: `Episode ${epNum}`,
            url: epUrl.startsWith('http') ? epUrl : `https://${actualDomain}${epUrl}`,
            domain: actualDomain,
          });
        }
      }
    });

    const sorted = eps.sort((a, b) => a.num - b.num);
    if (sorted.length > 0) {
      cacheSet(cacheKey, sorted, 'episodes');
    }
    return sorted;
  } catch (err) {
    return [];
  }
}

export async function getAnimePaheServers(episodeSlugOrUrl: string, domain: string = PRIMARY_DOMAIN): Promise<PaheServer[]> {
  let epUrl = episodeSlugOrUrl.trim();
  if (!epUrl.startsWith('http://') && !epUrl.startsWith('https://')) {
    const cleanSlug = epUrl.replace(/^\/+|\/+$/g, '');
    epUrl = `https://${domain}/${cleanSlug}/`;
  }

  const tryFetchFromDomain = async (targetUrl: string, targetDomain: string): Promise<PaheServer[]> => {
    try {
      const res = await axios.get(targetUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': `https://${targetDomain}/` },
        timeout: 12000,
      });
      const html = res.data;
      if (typeof html !== 'string') return [];
      const $ = cheerio.load(html);
      const servers: PaheServer[] = [];

      const addServer = (embedUrl: string, label: string = '') => {
        if (!embedUrl) return;
        let cleanUrl = embedUrl.trim();
        if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
        if (cleanUrl.startsWith('/')) cleanUrl = `https://${targetDomain}${cleanUrl}`;

        // Explicitly exclude megaplay.buzz as requested by user
        if (cleanUrl.includes('megaplay.buzz') || cleanUrl.includes('/stream/s-2/')) {
          return;
        }

        const isBlogger = cleanUrl.includes('blogger.com') || cleanUrl.includes('video.g');
        if (isBlogger) {
          const tokMatch = cleanUrl.match(/[?&]token=([A-Za-z0-9_-]+)/);
          if (tokMatch) {
            cleanUrl = `https://www.blogger.com/video.g?token=${tokMatch[1]}`;
          }
        }

        if (servers.some(s => s.embedUrl === cleanUrl)) return;

        let name = label.trim();
        if (isBlogger) {
          name = 'Blogger Player';
        } else if (cleanUrl.includes('gogoanime') || cleanUrl.includes('anihdplay') || cleanUrl.includes('streaming.php')) {
          name = 'Gogo Streaming';
        } else if (cleanUrl.includes('megacloud') || cleanUrl.includes('rapid-cloud')) {
          name = 'MegaCloud Player';
        } else if (!name || name.toLowerCase().includes('select')) {
          try {
            const u = new URL(cleanUrl);
            name = `${u.hostname.replace(/^www\./, '')} Player`;
          } catch {
            name = `Server ${servers.length + 1}`;
          }
        }

        servers.push({
          name,
          sourceId: cleanUrl,
          type: 'sub',
          domain: targetDomain,
          embedUrl: cleanUrl,
        });
      };

      // 1. Scan for Blogger video.g tokens directly across HTML & scripts
      const bloggerMatches = html.match(/https?:\/\/(?:www\.)?blogger\.com\/video\.g\?token=[A-Za-z0-9_-]+(?:&amp;|&|origin=[^"'\s]+)*/g);
      if (bloggerMatches) {
        for (const bUrl of bloggerMatches) {
          addServer(bUrl.replace(/&amp;/g, '&'), 'Blogger Player');
        }
      }

      // 2. Scan for raw token patterns
      const rawTokenMatches = html.match(/(?:blogger\.com\/video\.g\?token=|\btoken=)([A-Za-z0-9_-]{40,})/g);
      if (rawTokenMatches) {
        for (const rMatch of rawTokenMatches) {
          const tok = rMatch.replace(/.*token=/, '');
          if (tok) {
            addServer(`https://www.blogger.com/video.g?token=${tok}`, 'Blogger Player');
          }
        }
      }

      // 3. Check iframes directly in DOM
      $('iframe').each((_, el) => {
        const src = $(el).attr('src');
        if (src && (src.startsWith('http') || src.startsWith('//') || src.startsWith('/'))) {
          addServer(src, 'Iframe Player');
        }
      });

      // 4. Check select options
      $('select option').each((_, el) => {
        const val = $(el).attr('value') || '';
        const rawText = $(el).text().trim();
        const optionLabel = (!rawText || rawText.toLowerCase().includes('select')) ? '' : rawText;

        if (val.length > 20) {
          try {
            const decoded = Buffer.from(val, 'base64').toString('utf8');
            const srcMatch = decoded.match(/src=["']([^"']+)["']/i);
            if (srcMatch) addServer(srcMatch[1], optionLabel);
          } catch (_) {}
        }
      });

      // Sort Blogger First!
      servers.sort((a, b) => {
        const aBlogger = a.name.includes('Blogger') || a.embedUrl.includes('blogger.com');
        const bBlogger = b.name.includes('Blogger') || b.embedUrl.includes('blogger.com');
        if (aBlogger && !bBlogger) return -1;
        if (!aBlogger && bBlogger) return 1;
        return 0;
      });

      return servers;
    } catch {
      return [];
    }
  };

  let servers = await tryFetchFromDomain(epUrl, domain);

  // If no Blogger server found on primary domain, check secondary domain
  const hasBlogger = servers.some(s => s.name.includes('Blogger') || s.embedUrl.includes('blogger.com'));
  if (!hasBlogger) {
    const altDomain = domain === PRIMARY_DOMAIN ? SECONDARY_DOMAIN : PRIMARY_DOMAIN;
    const cleanSlug = episodeSlugOrUrl.replace(/^https?:\/\/[^\/]+\//, '').replace(/^\/+|\/+$/g, '');
    const altUrl = `https://${altDomain}/${cleanSlug}/`;
    const altServers = await tryFetchFromDomain(altUrl, altDomain);
    if (altServers.length > 0) {
      const altBlogger = altServers.filter(s => s.name.includes('Blogger') || s.embedUrl.includes('blogger.com'));
      if (altBlogger.length > 0) {
        servers = [...altBlogger, ...servers];
      } else if (servers.length === 0) {
        servers = altServers;
      }
    }
  }

  if (servers.length === 0 && epUrl) {
    servers.push({
      name: 'AnimePahe Server',
      sourceId: epUrl,
      type: 'sub',
      domain,
      embedUrl: epUrl,
    });
  }

  return servers;
}

export async function getAnimePaheStream(sourceId: string, bypassCache = false): Promise<PaheStream | null> {
  let embedUrl = sourceId.trim();
  if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;

  const isBlogger = embedUrl.includes('blogger.com') || embedUrl.includes('video.g');
  const tokenMatch = embedUrl.match(/[?&]token=([A-Za-z0-9_-]+)/);
  const bloggerToken = tokenMatch ? tokenMatch[1] : undefined;

  if (isBlogger && bloggerToken) {
    embedUrl = `https://www.blogger.com/video.g?token=${bloggerToken}`;
  }

  const serverName = isBlogger ? 'Blogger Player' : 'Iframe Player';

  return {
    embedUrl,
    streamUrl: embedUrl,
    mp4: null,
    m3u8: null,
    downloadUrl: null,
    type: 'embed',
    subtitles: [],
    servers: [serverName],
    directWatchLinks: [
      {
        quality: isBlogger ? 'Blogger 1080p' : 'Auto',
        url: embedUrl,
        type: 'embed',
      },
    ],
    referer: isBlogger ? 'https://www.blogger.com/' : embedUrl,
  };
}
