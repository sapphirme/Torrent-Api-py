import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { existsSync } from 'node:fs';
import { spawn, ChildProcess } from 'child_process';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { createServer as createViteServer } from 'vite';
import routes from './chanime-apiv1-main/src/routes';
import discordRelay from './chanime-apiv1-main/src/discord-relay';
import imageMigrator from './chanime-apiv1-main/src/image-migrator';

let chanimeProcess: ChildProcess | null = null;
const chanimeDir = path.join(process.cwd(), 'chanimee2.1-main');
const hasChanimeService = existsSync(path.join(chanimeDir, 'server.ts'));

function startChanimeService() {
  if (!hasChanimeService) {
    console.warn(`[Chanime] Optional service not found at ${chanimeDir}; continuing without it.`);
    return;
  }
  console.log(`[Chanime] Launching Chanime 2.1 server from ${chanimeDir} on port 5000...`);

  chanimeProcess = spawn('npx', ['tsx', 'server.ts'], {
    cwd: chanimeDir,
    env: {
      ...process.env,
      CHANIME_PORT: '5000',
      PORT: '5000',
    },
    stdio: 'inherit',
  });

  chanimeProcess.on('exit', (code, signal) => {
    console.warn(`[Chanime] Chanime process exited (code=${code}, signal=${signal}). Respawning in 3s...`);
    chanimeProcess = null;
    setTimeout(startChanimeService, 3000);
  });

  chanimeProcess.on('error', (err) => {
    console.error('[Chanime] Failed to spawn Chanime process:', err.message);
  });
}

// Clean up child process on exit
process.on('exit', () => {
  if (chanimeProcess) {
    chanimeProcess.kill();
  }
});
process.on('SIGINT', () => {
  if (chanimeProcess) {
    chanimeProcess.kill();
  }
  process.exit();
});
process.on('SIGTERM', () => {
  if (chanimeProcess) {
    chanimeProcess.kill();
  }
  process.exit();
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Auto-start Chanime 2.1 service
  startChanimeService();

  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json());

  // Proxy middleware to Chanime 2.1 on port 5000
  const chanimeProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:5000',
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: fixRequestBody,
      error: (err, _req, res: any) => {
        console.warn('[Proxy Error] Chanime 2.1 still starting or unreachable:', err.message);
        if (!res.headersSent) {
          res.status(503).send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Starting Chanime 2.1...</title>
              <meta http-equiv="refresh" content="2">
              <style>
                body { background:#07070f; color:#fff; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; flex-direction:column; gap:16px; text-align:center; }
                .spinner { width:40px; height:40px; border:3px solid rgba(244,63,94,0.2); border-top-color:#f43f5e; border-radius:50%; animation:spin 0.8s linear infinite; }
                @keyframes spin { to { transform:rotate(360deg); } }
              </style>
            </head>
            <body>
              <div class="spinner"></div>
              <h2 style="margin:0;font-size:22px;">Starting Chanime 2.1...</h2>
              <p style="color:#94a3b8;margin:0;max-width:420px;font-size:14px;">The application is initializing on port 5000. This page will reload automatically once ready.</p>
            </body>
            </html>
          `);
        }
      },
    },
  });

  // Chanime status check
  app.get('/api/chanime/status', async (_req, res) => {
    try {
      const resp = await fetch('http://127.0.0.1:5000/landing.html', { method: 'HEAD', signal: AbortSignal.timeout(1500) });
      res.json({ ok: true, status: 'online', port: 5000, httpStatus: resp.status });
    } catch (err: any) {
      res.json({ ok: false, status: 'starting', port: 5000, message: err.message });
    }
  });

  // Redirect /chanime to Chanime Home
  app.get(['/chanime', '/chanime/'], (_req, res) => {
    res.redirect('/home');
  });

  // Explicit shortcuts & parameter mapping for Anime Info and Watch pages
  app.get(['/watch', '/watch.html'], (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(307, '/anime' + qs);
  });
  app.get(['/watch/:id', '/watch-anime/:id'], (req, res) => {
    const qs = req.url.includes('?') ? '&' + req.url.slice(req.url.indexOf('?') + 1) : '';
    res.redirect(307, `/anime?id=${encodeURIComponent(req.params.id)}${qs}`);
  });
  app.get(['/info/:id', '/anime-info/:id'], (req, res) => {
    const qs = req.url.includes('?') ? '&' + req.url.slice(req.url.indexOf('?') + 1) : '';
    res.redirect(307, `/info?id=${encodeURIComponent(req.params.id)}${qs}`);
  });
  app.get(['/anime/:id'], (req, res) => {
    const qs = req.url.includes('?') ? '&' + req.url.slice(req.url.indexOf('?') + 1) : '';
    res.redirect(307, `/anime?id=${encodeURIComponent(req.params.id)}${qs}`);
  });

  // Proxy Chanime's front-end page routes, static assets, and anime APIs without stripping URL prefixes
  const isChanimePath = (pathname: string) => {
    return (
      pathname === '/home' ||
      pathname.startsWith('/home/') ||
      pathname === '/home.html' ||
      pathname === '/browse' ||
      pathname.startsWith('/browse/') ||
      pathname === '/browse.html' ||
      pathname === '/anime' ||
      pathname.startsWith('/anime/') ||
      pathname === '/anime.html' ||
      pathname === '/watch' ||
      pathname.startsWith('/watch/') ||
      pathname === '/watch.html' ||
      pathname === '/watch-anime' ||
      pathname.startsWith('/watch-anime/') ||
      pathname === '/info' ||
      pathname.startsWith('/info/') ||
      pathname === '/info.html' ||
      pathname === '/anime-info' ||
      pathname.startsWith('/anime-info/') ||
      pathname === '/anime-info.html' ||
      pathname === '/profile' ||
      pathname.startsWith('/profile/') ||
      pathname === '/profile.html' ||
      pathname === '/schedule' ||
      pathname.startsWith('/schedule/') ||
      pathname === '/schedule.html' ||
      pathname === '/manga' ||
      pathname.startsWith('/manga/') ||
      pathname === '/manga.html' ||
      pathname === '/manga-info' ||
      pathname.startsWith('/manga-info/') ||
      pathname === '/manga-info.html' ||
      pathname === '/read' ||
      pathname.startsWith('/read/') ||
      pathname === '/read.html' ||
      pathname === '/music' ||
      pathname.startsWith('/music/') ||
      pathname === '/music.html' ||
      pathname === '/novels' ||
      pathname.startsWith('/novels/') ||
      pathname === '/novels.html' ||
      pathname === '/multi-audio' ||
      pathname.startsWith('/multi-audio/') ||
      pathname === '/multi-audio.html' ||
      pathname === '/animesalt' ||
      pathname.startsWith('/animesalt/') ||
      pathname === '/animesalt.html' ||
      pathname === '/novel-info' ||
      pathname.startsWith('/novel-info/') ||
      pathname === '/novel-info.html' ||
      pathname === '/novel-read' ||
      pathname.startsWith('/novel-read/') ||
      pathname === '/novel-read.html' ||
      pathname === '/admin' ||
      pathname.startsWith('/admin/') ||
      pathname === '/admin.html' ||
      pathname === '/dmca' ||
      pathname === '/dmca.html' ||
      pathname === '/privacy' ||
      pathname === '/privacy.html' ||
      pathname === '/terms' ||
      pathname === '/terms.html' ||
      pathname === '/landing' ||
      pathname === '/landing.html' ||
      pathname.startsWith('/css/') ||
      pathname.startsWith('/js/') ||
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/fonts/') ||
      pathname.startsWith('/images/') ||
      pathname.startsWith('/img/') ||
      pathname.startsWith('/icons/') ||
      pathname === '/favicon.ico' ||
      pathname === '/favicon.png' ||
      pathname === '/manifest.json' ||
      pathname === '/manifest.webmanifest' ||
      pathname === '/sw.js' ||
      pathname === '/sw-ad-block.js' ||
      pathname.startsWith('/api/anime') ||
      pathname.startsWith('/api/anilist') ||
      pathname.startsWith('/api/info') ||
      pathname.startsWith('/api/characters') ||
      pathname.startsWith('/api/episodes') ||
      pathname.startsWith('/api/recommendations') ||
      pathname.startsWith('/api/relations') ||
      pathname.startsWith('/api/search') ||
      pathname.startsWith('/api/suggestions') ||
      pathname.startsWith('/api/animesalt') ||
      pathname.startsWith('/api/watch') ||
      pathname.startsWith('/api/eclipse') ||
      pathname.startsWith('/api/convert') ||
      pathname.startsWith('/api/videos') ||
      pathname.startsWith('/api/tmdb-videos') ||
      pathname.startsWith('/api/animeheaven') ||
      pathname.startsWith('/api/animepahe') ||
      pathname.startsWith('/api/secure') ||
      pathname.startsWith('/api/tmdb') ||
      pathname.startsWith('/api/tvdb') ||
      pathname.startsWith('/api/custom-scraper') ||
      pathname.startsWith('/api/auth') ||
      pathname.startsWith('/api/user') ||
      pathname.startsWith('/api/comments') ||
      pathname.startsWith('/api/manga') ||
      pathname.startsWith('/api/football') ||
      pathname.startsWith('/api/firebase-config') ||
      pathname.startsWith('/api/movies') ||
      pathname.startsWith('/api/tv') ||
      pathname.startsWith('/api/themes') ||
      pathname.startsWith('/api/lyrics') ||
      pathname.startsWith('/api/mylist') ||
      pathname.startsWith('/api/spotlight') ||
      pathname.startsWith('/api/schedule') ||
      pathname.startsWith('/api/most-searched') ||
      pathname.startsWith('/api/miruproxy') ||
      pathname.startsWith('/api/stream/movie') ||
      pathname.startsWith('/api/proxy') ||
      pathname.startsWith('/api/filter')
    );
  };

  app.use((req, res, next) => {
    // Determine if this is an AniVault API request (should be handled locally)
    const pathname = req.path;
    let isAniVault = false;

    // Chanime uses /api/watch/:provider/:id/:category/:slug
    const isChanimeNestedWatch = /^\/api\/watch\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+/.test(pathname);

    const isLocalStreamProxy = ['/api/proxy/hls', '/api/proxy/video', '/api/proxy/subtitle'].includes(pathname);
    if (isLocalStreamProxy || (!isChanimeNestedWatch && (pathname.startsWith('/api/watch') || pathname.startsWith('/api/servers') || pathname.startsWith('/api/episodes') || pathname.startsWith('/api/animesalt') || pathname.startsWith('/api/search/animepahe')))) {
      isAniVault = true;
    }

    if (!isAniVault && pathname === '/api/search') {
      const q = req.query;
      if (q.source || q.anilistId || q.malId || q.ep || q.type || q.q || q.query || q.slug || q.heavenId) {
        isAniVault = true;
      }
    }

    if (isAniVault) {
      return next();
    }

    if (isChanimePath(req.path)) {
      if (!hasChanimeService) {
        return res.status(503).json({ error: 'The optional Chanime service is not included in this archive.' });
      }
      return (chanimeProxy as any)(req, res, next);
    }
    next();
  });

  // Rate limiting for AniVault API
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_MAX || '600'),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
  });
  app.use('/api', limiter);

  // API routes
  const apiRouter = (routes as any).default || routes;
  app.use('/api', apiRouter);

  // Discord webhook relay
  const discordRouter = (discordRelay as any).default || discordRelay;
  app.use('/discord', discordRouter);

  // One-off image migration tool
  const migratorRouter = (imageMigrator as any).default || imageMigrator;
  app.use('/migrate-images', migratorRouter);

  // Serve static docs/tester files from chanime-apiv1-main/public
  const publicPath = path.join(process.cwd(), 'chanime-apiv1-main', 'public');
  app.use(express.static(publicPath));

  app.get(['/', '/index.html', '/docs', '/tester'], (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Vite middleware in development mode if needed
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Catch-all route to serve the interactive AniVault API Docs & Tester interface
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🟢 AniVault API running on http://0.0.0.0:${PORT}`);
    console.log(`📄 Docs + Tester: http://0.0.0.0:${PORT}/`);
    console.log(`🔗 API base:      http://0.0.0.0:${PORT}/api\n`);

    // FlareSolverr pinger
    const flaresolverrUrl = process.env.FLARESOLVERR_URL;
    if (flaresolverrUrl) {
      const ping = () => {
        fetch(flaresolverrUrl)
          .then(() => console.log('[pinger] FlareSolverr alive ✅'))
          .catch((e: any) => console.warn('[pinger] FlareSolverr ping failed:', e.message));
      };
      ping();
      setInterval(ping, 9 * 60 * 1000);
      console.log(`🏓 FlareSolverr pinger active → ${flaresolverrUrl}`);
    }
  });
}

startServer();
