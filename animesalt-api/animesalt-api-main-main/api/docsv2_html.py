DOCSV2_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smart Docs V2</title>
    <style>
        :root {
            --bg-color: #0f172a;
            --surface-color: #1e293b;
            --text-color: #e2e8f0;
            --accent-color: #3b82f6;
            --accent-hover: #2563eb;
        }
        
        * { 
            box-sizing: border-box; 
            outline: none !important; 
            -webkit-tap-highlight-color: transparent;
        }

        body {
            font-family: system-ui, -apple-system, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .container {
            width: 100%;
            max-width: 1200px;
        }
        header {
            text-align: center;
            margin-bottom: 30px;
            animation: fadeIn 0.5s ease;
        }
        
        /* Search only */
        .search-container {
            width: 100%;
            max-width: 600px;
            margin: 0 auto 25px;
            position: relative;
            z-index: 1000;
        }
        .search-bar {
            display: flex;
            gap: 10px;
        }
        .search-bar input {
            flex: 1;
            padding: 12px 20px;
            border-radius: 12px;
            border: 1px solid #334155;
            background: var(--surface-color);
            color: white;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        .search-bar input:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
        }
        .search-bar button {
            padding: 0 25px;
            border-radius: 12px;
            border: none;
            background: var(--accent-color);
            color: white;
            cursor: pointer;
            font-weight: bold;
            transition: 0.3s ease;
        }
        .search-bar button:hover { background: var(--accent-hover); }

        .search-results {
            position: absolute;
            top: 100%; left: 0; right: 0;
            background: var(--surface-color);
            border-radius: 12px;
            margin-top: 8px;
            max-height: 400px;
            overflow-y: auto;
            z-index: 1001;
            box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
            display: none;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .search-results.show { display: block; animation: popIn 0.3s ease; }
        .search-item {
            padding: 12px;
            display: flex;
            gap: 15px;
            cursor: pointer;
            border-bottom: 1px solid #334155;
            align-items: center;
            transition: background 0.2s;
        }
        .search-item:hover { background: #334155; }
        .search-item img { width: 45px; height: 60px; object-fit: cover; border-radius: 6px; }

        .controls {
            display: flex;
            gap: 15px;
            margin-bottom: 30px;
            justify-content: center;
            align-items: center;
        }
        .btn-home {
            background: #10b981;
            color: white;
            padding: 10px 20px;
            border-radius: 10px;
            border: none;
            font-weight: bold;
            cursor: pointer;
            transition: 0.3s ease;
        }
        .btn-home:hover { transform: translateY(-2px); opacity: 0.9; }

        .toggle-container {
            display: flex;
            align-items: center;
            gap: 10px;
            background: var(--surface-color);
            padding: 8px 16px;
            border-radius: 30px;
            font-size: 13px;
        }
        .switch { position: relative; width: 34px; height: 20px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
            position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
            background-color: #334155; transition: .4s; border-radius: 20px;
        }
        .slider:before {
            position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px;
            background-color: white; transition: .4s; border-radius: 50%;
        }
        input:checked + .slider { background-color: var(--accent-color); }
        input:checked + .slider:before { transform: translateX(14px); }

        /* Layout Grid */
        .layout {
            display: grid;
            grid-template-columns: 350px 1fr;
            gap: 25px;
            animation: fadeInUp 0.6s ease both;
        }
        @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }

        .panel {
            background: var(--surface-color);
            border-radius: 16px;
            padding: 25px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        
        .anime-info img {
            width: 100%;
            border-radius: 12px;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        }
        .watchlist-btn {
            background: rgba(255,255,255,0.05); color: white; padding: 8px 12px; border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 13px; margin-top: 15px; width: 100%;
            transition: 0.3s;
        }
        .watchlist-btn.active { background: #ef4444; border-color: transparent; }

        .seasons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
        .btn-s {
            background: #334155; color: white; border: none; padding: 8px 14px; border-radius: 6px;
            cursor: pointer; font-size: 13px; font-weight: 600; transition: 0.3s;
        }
        .btn-s.active { background: var(--accent-color); }

        .episodes {
            max-height: 500px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 15px;
        }
        .ep-card {
            background: rgba(0,0,0,0.2); padding: 12px; border-radius: 10px; display: flex; align-items: center;
            gap: 15px; cursor: pointer; transition: 0.3s ease; border: 1px solid transparent;
        }
        .ep-card:hover { background: #334155; transform: translateX(5px); }
        .ep-card.active { border-color: var(--accent-color); background: rgba(59, 130, 246, 0.1); }
        .ep-card img { width: 90px; height: 50px; object-fit: cover; border-radius: 6px; }

        /* Player */
        .player-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .player-container {
            width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 16px; overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); margin-bottom: 20px;
        }
        iframe { width: 100%; height: 100%; border: none; transition: opacity 0.4s ease; }

        .server-list { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
        .btn-pill {
            background: #334155; color: white; padding: 10px 18px; border-radius: 30px; border: none;
            cursor: pointer; font-size: 13px; font-weight: 600; transition: 0.3s;
        }
        .btn-pill.active { background: var(--accent-color); box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3); }

        /* Home Sections */
        .home-section { margin-bottom: 40px; animation: fadeInUp 0.6s ease both; }
        .home-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 20px; }
        .anime-card {
            background: var(--surface-color); border-radius: 12px; overflow: hidden; cursor: pointer;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); position: relative;
        }
        .anime-card:hover { transform: translateY(-10px); box-shadow: 0 12px 24px rgba(0,0,0,0.4); }
        .anime-card img { width: 100%; height: 240px; object-fit: cover; }
        .card-info { padding: 12px; }
        .card-title { font-size: 14px; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        
        .history-badge { font-size: 11px; color: var(--accent-color); font-weight: 800; margin-top: 4px; }
        .remove-icon {
            position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7);
            width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
            font-size: 12px; opacity: 0; transition: 0.2s;
        }
        .anime-card:hover .remove-icon { opacity: 1; }

        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popIn { 0% { transform: scale(0.95); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

        .loader {
            border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--accent-color);
            border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 20px auto;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .hidden { display: none !important; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1 onclick="fetchHome()" style="cursor:pointer; font-size:32px; font-weight:800; letter-spacing:-1px;">Smart<span style="color:var(--accent-color)">Docs</span> V2</h1>
        </header>

        <div class="search-container">
            <div class="search-bar">
                <input type="text" id="searchQuery" placeholder="Search anime title..." autocomplete="off">
                <button onclick="doSearch()">Search</button>
            </div>
            <div id="searchResults" class="search-results"></div>
        </div>

        <div class="controls">
            <button class="btn-home" onclick="fetchHome()">Home</button>
            <div class="toggle-container">
                <span>Ads Block</span>
                <label class="switch">
                    <input type="checkbox" id="blockRedirects" onchange="updatePlayerSandbox()">
                    <span class="slider"></span>
                </label>
            </div>
        </div>

        <div id="mainLoader" class="loader hidden"></div>

        <div id="homeLayout">
            <div id="personalSections"></div>
            <div id="apiHomeSections"></div>
        </div>

        <div class="layout hidden" id="contentLayout">
            <div class="sidebar">
                <div class="panel anime-info">
                    <img id="animePoster" src="">
                    <h2 id="animeTitle" style="margin:15px 0 5px; font-size:22px;"></h2>
                    <button id="watchlistBtn" class="watchlist-btn" onclick="toggleWatchlist()">+ Watchlist</button>
                    <p id="animeGenres" style="color:var(--accent-color); font-size:13px; font-weight:700; margin-top:10px;"></p>
                    <p id="animeDesc" style="font-size:14px; color:var(--text-muted); line-height:1.6; margin-top:15px; border-top:1px solid #334155; padding-top:15px;"></p>
                    <div id="animeExtra" style="margin-top:15px; font-size:12px; display:grid; grid-template-columns:1fr 1fr; gap:10px; background:rgba(0,0,0,0.2); padding:12px; border-radius:10px;"></div>
                    
                    <h3 style="margin-top:25px; font-size:16px;">Seasons</h3>
                    <div class="seasons" id="seasonsList"></div>
                </div>
                
                <div class="panel" style="margin-top:20px;">
                    <h3 style="margin:0; font-size:16px;">Episodes</h3>
                    <div id="epLoader" class="loader hidden"></div>
                    <div class="episodes" id="episodesList"></div>
                </div>
            </div>

            <div class="main">
                <div class="panel" id="playerPanel">
                    <div class="player-header">
                        <h2 id="nowPlaying" style="font-size:18px; margin:0;"></h2>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-pill" id="btnPrev" onclick="playPrev()" style="padding:6px 12px;">Prev</button>
                            <button class="btn-pill" id="btnNext" onclick="playNext()" style="padding:6px 12px;">Next</button>
                        </div>
                    </div>
                    <div id="nextEpTime" style="color:#10b981; font-weight:800; font-size:12px; margin-bottom:10px;"></div>
                    <div id="vmolyWarning" class="hidden" style="color:#ef4444; font-weight:700; font-size:12px; margin-bottom:10px;">⚠️ VMoly unavailable. Ads might play.</div>
                    
                    <div class="player-container">
                        <iframe id="videoPlayer" allowfullscreen style="opacity:0"></iframe>
                    </div>

                    <div class="server-list" id="serversList"></div>
                    <div class="server-list" id="downloadsList"></div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const API_BASE = window.location.origin;
        let history = JSON.parse(localStorage.getItem('s_history')) || [];
        let watchlist = JSON.parse(localStorage.getItem('s_watchlist')) || [];
        let favServer = localStorage.getItem('s_server') || '';
        let currentAnime = null;
        let epList = [];
        let epIdx = -1;

        // Search
        const sInp = document.getElementById('searchQuery');
        let sT;
        sInp.addEventListener('input', (e) => {
            clearTimeout(sT);
            if(e.target.value.length > 2) sT = setTimeout(doSearch, 400);
            else document.getElementById('searchResults').classList.remove('show');
        });

        async function doSearch() {
            const q = sInp.value.trim();
            const resBox = document.getElementById('searchResults');
            resBox.innerHTML = '<div class="loader"></div>';
            resBox.classList.add('show');
            try {
                const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
                const json = await res.json();
                resBox.innerHTML = '';
                if(json.success && json.results) {
                    json.results.slice(0,12).forEach(a => {
                        const d = document.createElement('div');
                        d.className = 'search-item';
                        d.innerHTML = `<img src="${a.image}"> <div><b>${a.title}</b><br><small style="color:var(--text-muted)">${a.slug}</small></div>`;
                        d.onclick = () => { resBox.classList.remove('show'); sInp.value=''; loadAnime(a.slug); };
                        resBox.appendChild(d);
                    });
                }
            } catch(e){}
        }

        // Home
        async function fetchHome() {
            window.scrollTo({top:0, behavior:'smooth'});
            document.getElementById('contentLayout').classList.add('hidden');
            document.getElementById('homeLayout').classList.remove('hidden');
            document.getElementById('mainLoader').classList.remove('hidden');
            renderPersonal();
            try {
                const res = await fetch(`${API_BASE}/api/home`);
                const json = await res.json();
                const container = document.getElementById('apiHomeSections');
                container.innerHTML = '';
                if(json.success && json.data) {
                    for(const [k, arr] of Object.entries(json.data)) {
                        if(!arr.length) continue;
                        let h = `<div class="home-section"><h2>${k.replace(/_/g,' ').toUpperCase()}</h2><div class="home-grid">`;
                        arr.forEach(a => {
                            h += `<div class="anime-card" onclick="loadAnime('${a.slug}')"><img src="${a.image}" loading="lazy"><div class="card-info"><div class="card-title">${a.title}</div></div></div>`;
                        });
                        container.innerHTML += h + '</div></div>';
                    }
                }
            } catch(e){}
            document.getElementById('mainLoader').classList.add('hidden');
        }

        function renderPersonal() {
            const container = document.getElementById('personalSections');
            container.innerHTML = '';
            if(history.length) {
                let h = `<div class="home-section"><h2>CONTINUE WATCHING</h2><div class="home-grid">`;
                history.forEach(i => {
                    h += `<div class="anime-card" onclick="loadAnime('${i.slug}', '${i.eid}')"><div class="remove-icon" onclick="event.stopPropagation(); history=history.filter(x=>x.slug!=='${i.slug}'); localStorage.setItem('s_history', JSON.stringify(history)); renderPersonal();">❌</div><img src="${i.image}"><div class="card-info"><div class="card-title">${i.title}</div><div class="history-badge">${i.et}</div></div></div>`;
                });
                container.innerHTML += h + '</div></div>';
            }
            if(watchlist.length) {
                let h = `<div class="home-section"><h2>MY WATCHLIST</h2><div class="home-grid">`;
                watchlist.forEach(i => {
                    h += `<div class="anime-card" onclick="loadAnime('${i.slug}')"><div class="remove-icon" onclick="event.stopPropagation(); watchlist=watchlist.filter(x=>x.slug!=='${i.slug}'); localStorage.setItem('s_watchlist', JSON.stringify(watchlist)); renderPersonal();">❌</div><img src="${i.image}"><div class="card-info"><div class="card-title">${i.title}</div></div></div>`;
                });
                container.innerHTML += h + '</div></div>';
            }
        }

        // Details
        async function loadAnime(slug, autoEid = null) {
            window.scrollTo({top:0, behavior:'smooth'});
            document.getElementById('homeLayout').classList.add('hidden');
            document.getElementById('mainLoader').classList.remove('hidden');
            const wa = document.getElementById('watchArea'); if(wa) wa.classList.add('hidden');
            document.getElementById('videoPlayer').src = '';

            try {
                const res = await fetch(`${API_BASE}/api/anime/${slug}`);
                const json = await res.json();
                if(json.success && json.data) {
                    const d = json.data;
                    currentAnime = { slug, title: d.title, image: d.thumbnail };
                    document.getElementById('animeTitle').innerText = d.title;
                    document.getElementById('animePoster').src = d.thumbnail;
                    document.getElementById('animeDesc').innerText = d.description;
                    document.getElementById('animeGenres').innerText = (d.genres||[]).join(' • ');
                    
                    const extra = document.getElementById('animeExtra');
                    extra.innerHTML = '';
                    if(d.information) {
                        for(const [k,v] of Object.entries(d.information)) {
                            if(!v || v==='N/A') continue;
                            extra.innerHTML += `<div><b style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">${k.replace(/_/g,' ')}</b><div style="font-weight:700;">${v}</div></div>`;
                        }
                    }

                    const sDiv = document.getElementById('seasonsList'); sDiv.innerHTML = '';
                    if(d.seasons) {
                        d.seasons.forEach((s, i) => {
                            const b = document.createElement('button');
                            b.className = `btn-s ${i===0?'active':''}`;
                            b.innerText = s.name;
                            b.onclick = () => { document.querySelectorAll('.btn-s').forEach(x=>x.classList.remove('active')); b.classList.add('active'); fetchEps(s.id, autoEid); };
                            sDiv.appendChild(b);
                        });
                        fetchEps(d.seasons[0].id, autoEid);
                    }
                    updateWatchBtn();
                    document.getElementById('contentLayout').classList.remove('hidden');
                }
            } catch(e){}
            document.getElementById('mainLoader').classList.add('hidden');
        }

        async function fetchEps(sid, autoEid) {
            document.getElementById('epLoader').classList.remove('hidden');
            const grid = document.getElementById('episodesList'); grid.innerHTML = '';
            try {
                const res = await fetch(`${API_BASE}/api/episodes/${sid}`);
                const json = await res.json();
                if(json.success && json.data.episodes) {
                    epList = json.data.episodes;
                    epList.forEach((ep, i) => {
                        const div = document.createElement('div');
                        div.className = 'ep-card'; div.id = `ep-${ep.id}`;
                        div.innerHTML = `<img src="${ep.thumbnail}"> <div class="ep-card-info"><div class="ep-card-title">${ep.title}</div></div>`;
                        div.onclick = () => fetchStream(ep.id, ep.title, i);
                        grid.appendChild(div);
                        if(autoEid === ep.id) fetchStream(ep.id, ep.title, i);
                    });
                }
            } catch(e){}
            document.getElementById('epLoader').classList.add('hidden');
        }

        async function fetchStream(eid, title, idx) {
            epIdx = idx;
            const wa = document.getElementById('watchArea'); if(wa) wa.classList.remove('hidden');
            document.getElementById('nowPlaying').innerText = title;
            document.querySelectorAll('.ep-card').forEach(x=>x.classList.remove('active'));
            document.getElementById(`ep-${eid}`)?.classList.add('active');
            
            document.getElementById('btnPrev').disabled = idx <= 0;
            document.getElementById('btnNext').disabled = idx >= epList.length - 1;
            
            const player = document.getElementById('videoPlayer'); player.style.opacity = '0';
            
            history = history.filter(x=>x.slug !== currentAnime.slug);
            history.unshift({...currentAnime, eid, epTitle: title});
            localStorage.setItem('s_history', JSON.stringify(history.slice(0, 20)));

            try {
                const res = await fetch(`${API_BASE}/api/stream/${eid}`);
                const json = await res.json();
                if(json.success && json.data) {
                    const d = json.data;
                    document.getElementById('nextEpTime').innerText = d.next_episode_time ? `Next Episode: ${d.next_episode_time}` : '';
                    
                    const servers = d.servers || [];
                    if(favServer) servers.sort((a,b)=> a.name === favServer ? -1 : b.name === favServer ? 1 : 0);
                    
                    if(servers.length && !servers[0].name.toLowerCase().includes('vmoly') && !favServer) document.getElementById('vmolyWarning').classList.remove('hidden');
                    else document.getElementById('vmolyWarning').classList.add('hidden');

                    const sList = document.getElementById('serversList'); sList.innerHTML = '';
                    servers.forEach((s, i) => {
                        const b = document.createElement('button');
                        b.className = `btn-pill ${i===0?'active':''}`;
                        b.innerText = s.name;
                        b.onclick = () => { document.querySelectorAll('#serversList .btn-pill').forEach(x=>x.classList.remove('active')); b.classList.add('active'); favServer = s.name; localStorage.setItem('s_server', s.name); player.src = s.url; };
                        sList.appendChild(b);
                    });

                    const dList = document.getElementById('downloadsList'); dList.innerHTML = '';
                    (d.downloads || []).forEach(x => { dList.innerHTML += `<a href="${x.url}" target="_blank" class="btn-pill" style="text-decoration:none; background:rgba(16, 185, 129, 0.1); color:#10b981; border:1px solid rgba(16, 185, 129, 0.2);">${x.name}</a>`; });

                    player.src = servers.length ? servers[0].url : d.video_player;
                    player.onload = () => player.style.opacity = '1';
                }
            } catch(e){}
        }

        window.playNext = () => { if(epIdx < epList.length-1) fetchStream(epList[epIdx+1].id, epList[epIdx+1].title, epIdx+1); };
        window.playPrev = () => { if(epIdx > 0) fetchStream(epList[epIdx-1].id, epList[epIdx-1].title, epIdx-1); };

        function toggleWatchlist() {
            const i = watchlist.findIndex(x=>x.slug === currentAnime.slug);
            if(i > -1) watchlist.splice(i, 1); else watchlist.unshift(currentAnime);
            localStorage.setItem('s_watchlist', JSON.stringify(watchlist));
            updateWatchBtn();
        }
        function updateWatchBtn() {
            const b = document.getElementById('watchlistBtn');
            const active = watchlist.some(x=>x.slug === currentAnime.slug);
            b.innerHTML = active ? '<span class="material-icons-round" style="font-size:18px;">bookmark</span> In Watchlist' : '<span class="material-icons-round" style="font-size:18px;">bookmark_border</span> Watchlist';
            if(active) b.classList.add('active'); else b.classList.remove('active');
        }

        function updatePlayerSandbox() {
            const p = document.getElementById('videoPlayer');
            if(document.getElementById('blockRedirects').checked) p.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups');
            else p.removeAttribute('sandbox');
        }

        document.addEventListener('click', (e) => { if (!e.target.closest('.search-container')) document.getElementById('searchResults').classList.remove('show'); });
        
        // Init
        document.addEventListener('DOMContentLoaded', () => {
            updatePlayerSandbox();
            fetchHome();
        });
    </script>
</body>
</html>
"""