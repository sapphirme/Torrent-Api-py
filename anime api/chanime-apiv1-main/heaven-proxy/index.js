/**
 * Heaven Proxy - Standalone Cloudflare Worker Video & Stream Proxy
 * Works for all video sources (AnimeHeaven, direct MP4, HLS m3u8, etc.)
 * Bypasses CORS, spoofing Referer/Origin headers, and automatically rotates
 * dynamic CDN subdomains if links expire.
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS Preflight OPTIONS requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(),
      });
    }

    const url = new URL(request.url);

    // Health check & Info endpoint
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify(
          {
            status: 'online',
            service: 'Heaven Proxy (Cloudflare Worker)',
            version: '1.0.0',
            usage: `${url.origin}/proxy?url=YOUR_ENCODED_URL&dl=1&filename=video.mp4&key=EPISODE_KEY`,
            examples: {
              video_stream: `${url.origin}/proxy?url=https%3A%2F%2Fcc.animeheaven.me%2Fvideo.mp4%3F123`,
              video_download: `${url.origin}/proxy?url=https%3A%2F%2Fcc.animeheaven.me%2Fvideo.mp4%3F123&dl=1&filename=AnimeEpisode.mp4`,
            },
          },
          null,
          2
        ),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(),
          },
        }
      );
    }

    // Handle Proxy Routes
    if (
      url.pathname === '/proxy' ||
      url.pathname.startsWith('/proxy/') ||
      url.pathname.startsWith('/api/proxy')
    ) {
      return handleProxyRequest(request, url);
    }

    return new Response(
      JSON.stringify({ error: 'Endpoint Not Found', path: url.pathname }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(),
        },
      }
    );
  },
};

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Content-Type',
  };
}

async function handleProxyRequest(request, reqUrl) {
  const targetUrl = reqUrl.searchParams.get('url');
  if (!targetUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing required query parameter ?url=' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(),
        },
      }
    );
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    return new Response(
      JSON.stringify({ error: 'Parameter ?url must be an absolute HTTP or HTTPS URL' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(),
        },
      }
    );
  }

  const isDownload =
    reqUrl.searchParams.get('dl') === '1' ||
    reqUrl.searchParams.get('download') === '1' ||
    reqUrl.searchParams.get('download') === 'true';

  const filename = reqUrl.searchParams.get('filename') || 'video.mp4';
  const customRef = reqUrl.searchParams.get('ref') || reqUrl.searchParams.get('referer');
  const key = reqUrl.searchParams.get('key');

  const incomingRange = request.headers.get('range');

  async function fetchUpstream(fetchUrl) {
    let referer = customRef;
    let origin;

    if (!referer && fetchUrl.includes('animeheaven.me')) {
      referer = 'https://animeheaven.me/';
      origin = 'https://animeheaven.me';
    }

    const headers = new Headers({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    if (referer) headers.set('Referer', referer);
    if (origin) headers.set('Origin', origin);
    if (incomingRange) headers.set('Range', incomingRange);

    return await fetch(fetchUrl, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
    });
  }

  let response;
  try {
    response = await fetchUpstream(targetUrl);

    // If initial fetch failed or returned non-2xx status for AnimeHeaven, run fallbacks
    if ((!response || !response.ok) && targetUrl.includes('animeheaven.me')) {
      // Strategy 1: Rotate CDN subdomains
      const match = targetUrl.match(/^https?:\/\/([a-z0-9-]+)\.animeheaven\.me\/(video\.mp4\?[^#]+)/i);
      if (match) {
        const currentSub = match[1];
        const pathAndQuery = match[2];
        const fallbackSubs = ['cc', 'co', 'cz', 'f1', 'rx', 'cy', 'po', 'ci', 'sr', 'cv', 'rk', '7p'];

        for (const sub of fallbackSubs) {
          if (sub === currentSub) continue;
          const altUrl = `https://${sub}.animeheaven.me/${pathAndQuery}`;
          try {
            const altResp = await fetchUpstream(altUrl);
            if (altResp && altResp.ok) {
              response = altResp;
              break;
            }
          } catch (_) {}
        }
      }

      // Strategy 2: Use episode key to fetch fresh link from AnimeHeaven /gate.php
      if ((!response || !response.ok) && key) {
        try {
          const gateUrl = `https://animeheaven.me/gate.php?${encodeURIComponent(key)}`;
          const gateResp = await fetch(gateUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
              'Referer': 'https://animeheaven.me/',
            },
          });
          const html = await gateResp.text();
          const mp4Match = html.match(/https?:\/\/[a-z0-9-]+\.animeheaven\.me\/video\.mp4\?[^"'\s]+/i);
          if (mp4Match) {
            const freshUrl = mp4Match[0];
            const freshResp = await fetchUpstream(freshUrl);
            if (freshResp && freshResp.ok) {
              response = freshResp;
            }
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Upstream connection failed', detail: err.message }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(),
        },
      }
    );
  }

  if (!response) {
    return new Response(
      JSON.stringify({ error: 'Unable to resolve playable video stream' }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(),
        },
      }
    );
  }

  // Construct response with CORS & Video headers
  const outHeaders = new Headers(getCorsHeaders());

  const headersToPass = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
    'cache-control',
  ];

  for (const h of headersToPass) {
    const val = response.headers.get(h);
    if (val) outHeaders.set(h, val);
  }

  if (isDownload) {
    outHeaders.set(
      'Content-Disposition',
      `attachment; filename="${encodeURI(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outHeaders,
  });
}
