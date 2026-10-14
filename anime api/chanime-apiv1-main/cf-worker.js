/**
 * Advanced HLS & Scraper Stream Proxy - Cloudflare Worker
 * Combining MediaFlow Proxy + Node-HLS-Proxy manifest parsing & routing
 * 
 * Features:
 *  - Full HLS M3U8 Playlist rewriting (Segments, Audio, Subtitles, & AES-128 Key URIs)
 *  - MediaFlow Proxy compatibility (/proxy/hls/manifest.m3u8, /proxy/stream, ?d=..., ?headers=...)
 *  - Node-HLS-Proxy manifest URL resolution & segment caching headers
 *  - Custom CDN Rules Table (MegaPlay/Nexabloom, Kwik/Pahe, AniDB, AniZone, VidHide, etc.)
 *  - Base64 URL routing (/p/<b64u>) & standard routing (/proxy?url=..., /hls?url=...)
 *  - CORS enabled for all web players (HLS.js, Video.js, Plyr, native browser)
 *  - Byte range support for fast scrubbing / seeking (206 Partial Content)
 */

/* ─── CDN Rules Table ──────────────────────────────────────────────────────── */
const CDN_RULES = [
  // MegaPlay / Nexabloom / Anikoto / LunarX / AnimeSalt
  { test: h => h.includes('nexabloom') || h.includes('megaplay') || h.includes('streamzone') || h.includes('cinewave') || h.includes('mewstream') || h.includes('animesalt'),
    referer: 'https://megaplay.buzz/', origin: 'https://megaplay.buzz', secSite: 'cross-site' },
  
  // Kwik / Pahe / Owocdn
  { test: h => h.endsWith('.owocdn.top') || h === 'owocdn.top' || h.endsWith('.kwik.cx') || h === 'kwik.cx' || h.includes('pahe') || h.includes('animepahe'),
    referer: 'https://kwik.cx/', origin: 'https://kwik.cx', secSite: 'cross-site' },

  // AniDB & AniZone
  { test: h => h === 'hls.anidb.app' || h.endsWith('.anidb.app') || h === 'anidb.se' || h.endsWith('.anidb.se'),
    referer: 'https://anidb.se/', origin: 'https://anidb.se', secSite: 'same-site' },
  { test: h => h.endsWith('.vid-cdn.xyz') || h === 'vid-cdn.xyz' || h.endsWith('.anizone.to'),
    referer: 'https://anizone.to/', origin: 'https://anizone.to', secSite: 'cross-site' },

  // Reanime / AnimeGG / Animex
  { test: h => h.endsWith('.otakuu.se') || h === 'otakuu.se' || h.includes('animex') || h.includes('reanime') || h === 'cdn.reanime.cc',
    referer: 'https://reanime.to/', origin: 'https://reanime.to', secSite: 'cross-site' },

  // VibePlayer / AniNeko / VidWish
  { test: h => h.includes('vibeplayer') || h.includes('watching.onl') || h.includes('vidwish'),
    referer: 'https://vibeplayer.site/', origin: 'https://vibeplayer.site', secSite: 'cross-site' },

  // Mofl / VidHosters / Clvd
  { test: h => h.includes('mofl.pro') || h.includes('vidhosters.com') || h.includes('clvd.xyz'),
    referer: 'https://kem.clvd.xyz/', origin: 'https://kem.clvd.xyz', secSite: 'cross-site' },

  // EchoVideo
  { test: h => h.includes('echovideo') || h.includes('burntburst'),
    referer: null, origin: 'https://play2.echovideo.ru', secSite: 'cross-site' },

  // ZenCloudz (AniWave)
  { test: h => h.includes('zencloudz') || h.includes('aniwave'),
    referer: 'https://aniwaves.ru/', origin: 'https://aniwaves.ru', secSite: 'cross-site' },

  // MegaUp / Hub26
  { test: h => h.includes('megaup.nl') || h.includes('hub26link') || h.startsWith('rrr.'),
    referer: 'https://megaup.nl/', origin: 'https://megaup.nl', secSite: 'cross-site' },
  
  // StreamWish / Filemoon / VidHide / MixDrop
  { test: h => h.includes('streamwish') || h.includes('filemoon') || h.includes('vidhide') || h.includes('mixdrop'),
    referer: null, origin: null, secSite: 'cross-site' }
];

/* ─── Allowed File Extensions ────────────────────────────────────────────── */
const ALLOWED_EXTENSIONS = new Set([
  "m3u8", "ts", "m4s", "m4v", "mp4", "cmfv", "cmfa",
  "aac", "mp3", "vtt", "srt", "ass", "json", "bin", "key"
]);

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* ─── CORS Headers ───────────────────────────────────────────────────────── */
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Referer, Origin, Authorization, Content-Type, X-Requested-With, api_password",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type, Accept-Ranges",
  };
}

/* ─── Base64 & URL Helpers ────────────────────────────────────────────────── */
function b64Decode(str) {
  try {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "==".slice((base64.length % 4) || 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function b64EncodePayload(targetUrl, headersObj) {
  const headersJson = headersObj ? JSON.stringify(headersObj) : "";
  const raw = `${targetUrl}\u0000${headersJson}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function decodePayload(b64u) {
  const raw = b64Decode(b64u);
  if (!raw) return null;
  const sep = raw.indexOf("\u0000");
  if (sep === -1) return { url: raw, headers: {} };
  
  const targetUrl = raw.slice(0, sep);
  const headersStr = raw.slice(sep + 1);
  let headers = {};
  if (headersStr) {
    try {
      if (headersStr.startsWith("{")) {
        headers = JSON.parse(headersStr);
      } else {
        headers = { referer: headersStr };
      }
    } catch {
      headers = { referer: headersStr };
    }
  }
  return { url: targetUrl, headers };
}

/* ─── Rule Lookup ────────────────────────────────────────────────────────── */
function lookupCdnRule(hostname, fallbackRef) {
  for (const rule of CDN_RULES) {
    if (rule.test(hostname)) return rule;
  }
  return { referer: fallbackRef || null, origin: null, secSite: "cross-site" };
}

/* ─── M3U8 Playlist Rewriter (Node-HLS-Proxy + MediaFlow specification) ──── */
function buildWorkerProxiedUrl(workerBase, targetUrl, extraHeaders) {
  return `${workerBase}p/${b64EncodePayload(targetUrl, extraHeaders)}`;
}

function rewriteM3u8Playlist(manifestText, baseUrl, customHeaders, workerBase) {
  const lines = manifestText.split("\n");
  const rewritten = lines.map(line => {
    let trimmed = line.trim();
    if (!trimmed) return line;

    // 1. Rewrite URI inside attributes: #EXT-X-KEY:METHOD=AES-128,URI="..."
    if (trimmed.startsWith("#EXT-X-KEY:") || trimmed.startsWith("#EXT-X-MEDIA:")) {
      return trimmed.replace(/URI=["']([^"']+)["']/g, (match, uri) => {
        try {
          const absUrl = new URL(uri, baseUrl).href;
          const proxied = buildWorkerProxiedUrl(workerBase, absUrl, customHeaders);
          return `URI="${proxied}"`;
        } catch {
          return match;
        }
      });
    }

    // Preserve comments & tags
    if (trimmed.startsWith("#")) return line;

    // 2. Absolute HTTP/HTTPS URLs
    if (/^https?:\/\//i.test(trimmed)) {
      return buildWorkerProxiedUrl(workerBase, trimmed, customHeaders);
    }

    // 3. Relative URLs - resolve against M3U8 base URL
    try {
      const absoluteUrl = new URL(trimmed, baseUrl).href;
      return buildWorkerProxiedUrl(workerBase, absoluteUrl, customHeaders);
    } catch {
      return line;
    }
  });

  return rewritten.join("\n");
}

/* ─── Core Target Proxy Handler ───────────────────────────────────────────── */
async function handleProxyRequest(targetUrl, requestHeadersObj, originalReq, workerBase) {
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
      throw new Error("Invalid protocol");
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid target URL", url: targetUrl }),
      { status: 400, headers: { "Content-Type": "application/json", ...getCorsHeaders() } }
    );
  }

  // Detect CDN rule for default headers
  const passedReferer = requestHeadersObj.referer || requestHeadersObj.Referer || "";
  const rule = lookupCdnRule(parsedTarget.hostname, passedReferer);

  // Construct fetch headers
  const fetchHeaders = {
    "User-Agent": requestHeadersObj["user-agent"] || requestHeadersObj["User-Agent"] || DEFAULT_UA,
    "Accept": requestHeadersObj["accept"] || "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // Merge extra passed headers
  for (const [key, val] of Object.entries(requestHeadersObj)) {
    if (!["host", "connection", "accept-encoding"].includes(key.toLowerCase())) {
      fetchHeaders[key] = val;
    }
  }

  // Apply referer/origin rules
  const effectiveReferer = rule.referer !== undefined ? rule.referer : passedReferer;
  if (effectiveReferer) {
    fetchHeaders["Referer"] = effectiveReferer;
    try {
      fetchHeaders["Origin"] = rule.origin || new URL(effectiveReferer).origin;
    } catch {}
  }
  if (rule.secSite) fetchHeaders["Sec-Fetch-Site"] = rule.secSite;
  fetchHeaders["Sec-Fetch-Mode"] = "cors";

  // Range header for audio/video seeking
  const range = originalReq.headers.get("Range");
  if (range) fetchHeaders["Range"] = range;

  // Execute Upstream Fetch
  let upstreamRes;
  try {
    upstreamRes = await fetch(targetUrl, {
      method: originalReq.method === "HEAD" ? "HEAD" : "GET",
      headers: fetchHeaders,
      redirect: "follow",
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Upstream fetch failed: ${err.message}` }),
      { status: 502, headers: { "Content-Type": "application/json", ...getCorsHeaders() } }
    );
  }

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    return new Response(
      JSON.stringify({ error: `Upstream error status: ${upstreamRes.status}` }),
      { status: upstreamRes.status, headers: { "Content-Type": "application/json", ...getCorsHeaders() } }
    );
  }

  const contentType = upstreamRes.headers.get("Content-Type") || "";
  const isM3U8 = contentType.includes("mpegurl") || 
                 contentType.includes("x-mpegURL") || 
                 parsedTarget.pathname.toLowerCase().endsWith(".m3u8");

  const responseHeaders = {
    ...getCorsHeaders(),
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": isM3U8 ? "no-cache, no-store" : "public, max-age=3600",
  };

  // Pass-through standard stream headers
  const cl = upstreamRes.headers.get("Content-Length");
  if (cl) responseHeaders["Content-Length"] = cl;
  const cr = upstreamRes.headers.get("Content-Range");
  if (cr) responseHeaders["Content-Range"] = cr;
  const ar = upstreamRes.headers.get("Accept-Ranges");
  if (ar) responseHeaders["Accept-Ranges"] = ar;

  if (originalReq.method === "HEAD") {
    return new Response(null, { status: upstreamRes.status, headers: responseHeaders });
  }

  // Handle M3U8 Manifest Rewriting
  if (isM3U8) {
    const rawManifest = await upstreamRes.text();
    const finalManifest = rewriteM3u8Playlist(rawManifest, upstreamRes.url || targetUrl, requestHeadersObj, workerBase);
    
    responseHeaders["Content-Type"] = "application/vnd.apple.mpegurl";
    delete responseHeaders["Content-Length"];

    return new Response(finalManifest, { status: upstreamRes.status, headers: responseHeaders });
  }

  // Stream raw video/audio segment
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: responseHeaders });
}

/* ─── Main Cloudflare Worker Router ───────────────────────────────────────── */
export default {
  async fetch(request, env, ctx) {
    // 1. Pre-flight OPTIONS CORS check
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders() });
    }

    const reqUrl = new URL(request.url);
    const workerBase = `${reqUrl.origin}/`;

    // 2. Health check route
    if (reqUrl.pathname === "/health" || reqUrl.pathname === "/status") {
      return new Response(
        JSON.stringify({
          status: "active",
          service: "HLS & Scraper Stream Proxy (MediaFlow + Node-HLS-Proxy)",
          timestamp: new Date().toISOString(),
          version: "3.0.0"
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders() } }
      );
    }

    // 3. Base64 URL Payload Route: /p/<b64u>
    if (reqUrl.pathname.startsWith("/p/")) {
      const b64uPayload = reqUrl.pathname.slice(3);
      const decoded = decodePayload(b64uPayload);
      if (!decoded || !decoded.url) {
        return new Response(
          JSON.stringify({ error: "Invalid b64u stream payload" }),
          { status: 400, headers: { "Content-Type": "application/json", ...getCorsHeaders() } }
        );
      }
      return handleProxyRequest(decoded.url, decoded.headers, request, workerBase);
    }

    // 4. MediaFlow Proxy compatible routes:
    //    /proxy/hls/manifest.m3u8?d=...&headers=...
    //    /proxy/stream?d=... or ?url=...
    //    /hls?d=... or ?url=...
    //    /proxy?url=... or ?d=...
    const isProxyRoute = [
      "/proxy", "/hls", "/stream", 
      "/proxy/hls/manifest.m3u8", "/proxy/stream"
    ].includes(reqUrl.pathname) || reqUrl.searchParams.has("url") || reqUrl.searchParams.has("d");

    if (isProxyRoute) {
      let rawTarget = reqUrl.searchParams.get("url") || reqUrl.searchParams.get("d") || reqUrl.searchParams.get("destination");
      if (!rawTarget) {
        return new Response(
          JSON.stringify({ error: "Missing required 'url' or 'd' query parameter" }),
          { status: 400, headers: { "Content-Type": "application/json", ...getCorsHeaders() } }
        );
      }

      // Check if target is base64 encoded
      let targetUrl = rawTarget;
      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        const decodedTarget = b64Decode(targetUrl);
        if (decodedTarget && (decodedTarget.startsWith("http://") || decodedTarget.startsWith("https://"))) {
          targetUrl = decodedTarget;
        }
      }

      // Parse headers parameter if supplied (e.g., ?headers={"Referer":"..."} or base64)
      const headersParam = reqUrl.searchParams.get("headers") || reqUrl.searchParams.get("h");
      let customHeaders = {};

      if (headersParam) {
        try {
          if (headersParam.startsWith("{")) {
            customHeaders = JSON.parse(headersParam);
          } else {
            const decodedHeaders = b64Decode(headersParam);
            customHeaders = decodedHeaders ? JSON.parse(decodedHeaders) : {};
          }
        } catch {}
      }

      // Referer override parameter
      const refererParam = reqUrl.searchParams.get("ref") || reqUrl.searchParams.get("referer");
      if (refererParam) {
        customHeaders["Referer"] = refererParam;
      }

      return handleProxyRequest(targetUrl, customHeaders, request, workerBase);
    }

    // 5. Default Fallback Info Response
    return new Response(
      JSON.stringify({
        message: "HLS Stream Proxy Worker Ready.",
        usage: {
          standardProxy: `${workerBase}proxy?url=<TARGET_URL>&ref=<REFERER>`,
          mediaflowFormat: `${workerBase}proxy/hls/manifest.m3u8?d=<TARGET_URL>&headers=<JSON_OR_B64_HEADERS>`,
          b64uFormat: `${workerBase}p/<B64U_PAYLOAD>`
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders() } }
    );
  }
};
