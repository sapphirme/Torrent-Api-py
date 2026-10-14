import axios, { AxiosInstance } from 'axios';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';

// Cache CF clearance cookies per domain for 25 minutes
const cfCache = new Map<string, { cookies: string; userAgent: string; expiresAt: number }>();

async function getCfClearance(baseURL: string): Promise<{ cookies: string; userAgent: string } | null> {
  if (!FLARESOLVERR_URL) return null;

  let domain: string;
  try {
    domain = new URL(baseURL).hostname;
  } catch {
    return null;
  }

  // Return cached cookies if still valid
  const cached = cfCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[FlareSolverr] Using cached cookies for ${domain} (expires in ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)`);
    return { cookies: cached.cookies, userAgent: cached.userAgent };
  }

  console.log(`[FlareSolverr] Solving challenge for ${domain}...`);
  try {
    const res = await axios.post(`${FLARESOLVERR_URL}/v1`, {
      cmd: 'request.get',
      url: baseURL,
      maxTimeout: 60000,
    }, { timeout: 70000 });

    const solution = res.data?.solution;
    if (!solution) return null;

    const cookies = (solution.cookies as any[])
      .map((c: any) => `${c.name}=${c.value}`)
      .join('; ');

    const result = { cookies, userAgent: solution.userAgent as string };
    // Cache for 25 minutes
    cfCache.set(domain, { ...result, expiresAt: Date.now() + 25 * 60 * 1000 });
    console.log(`[FlareSolverr] ✅ Cookies cached for ${domain} for 25 minutes`);
    return result;
  } catch (e) {
    console.error('[FlareSolverr] failed:', (e as Error).message);
    return null;
  }
}

export function makeClient(baseURL: string, referer: string, useFlareSolverr: boolean = false, extra?: Record<string, string>): AxiosInstance {
  const instance = axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Google Chrome";v="137", "Chromium";v="137", "Not=A?Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Referer': referer,
      'Origin': new URL(referer).origin,
      ...extra,
    },
  });

  if (useFlareSolverr) {
    // Inject CF clearance before every request — uses baseURL (not per-path URL)
    // so the domain cache key is always consistent
    instance.interceptors.request.use(async (config) => {
      const cf = await getCfClearance(baseURL);
      if (cf) {
        config.headers['Cookie'] = cf.cookies;
        config.headers['User-Agent'] = cf.userAgent;
      }
      return config;
    });
  }

  return instance;
}

export function makeAjaxClient(baseURL: string, referer: string, useFlareSolverr: boolean = false, extra?: Record<string, string>): AxiosInstance {
  return makeClient(baseURL, referer, useFlareSolverr, {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    ...extra,
  });
}

export const PRIMARY_PROXY_BASE = process.env.PRIMARY_PROXY_URL || 'https://chanime-proxy.kvngmark007.workers.dev/proxy?url=';

export function getProxyUrl(targetUrl: string): string {
  return `${PRIMARY_PROXY_BASE}${encodeURIComponent(targetUrl)}`;
}

export async function fetchViaPrimaryProxy(targetUrl: string, options?: any): Promise<any> {
  const proxyUrl = getProxyUrl(targetUrl);
  return axios.get(proxyUrl, {
    timeout: 15000,
    ...options,
  });
}

let lastAnilistFailTime = 0;
const ANILIST_BREAKER_COOLDOWN = 60000;

export function isAnilistDown(): boolean {
  return Date.now() - lastAnilistFailTime < ANILIST_BREAKER_COOLDOWN;
}

export function recordAnilistFailure(): void {
  lastAnilistFailTime = Date.now();
}

export function recordAnilistSuccess(): void {
  lastAnilistFailTime = 0;
}

export const anilistClient = axios.create({
  baseURL: 'https://graphql.anilist.co',
  timeout: 3000,
  headers: { 'Content-Type': 'application/json' },
});

anilistClient.interceptors.request.use((config) => {
  if (isAnilistDown()) {
    return Promise.reject(new Error('AniList API circuit breaker active: API is down'));
  }
  return config;
});

anilistClient.interceptors.response.use(
  (response) => {
    recordAnilistSuccess();
    return response;
  },
  (error) => {
    recordAnilistFailure();
    return Promise.reject(error);
  }
);

