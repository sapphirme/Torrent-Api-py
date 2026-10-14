/* Only active inside the Android app (window.KVNative is injected by the WebView). */
(() => {
  if (!window.KVNative) return;
  const call = (fn, ...a) => { try { return window.KVNative[fn](...a); } catch { return null; } };
  window.KVOffline = {
    list: () => { try { return JSON.parse(call('state') || '[]'); } catch { return []; } },
    // t = torrent info from /api/torrent, f = one of its files (must be cached/complete on the server)
    download(t, f) {
      const base = `${location.origin}/hls/${t.infoHash}/${f.index}/`;
      call('download', `${t.infoHash}:${f.index}`, f.name, base + 'index.m3u8', f.hasSubs ? base + 'subs.vtt' : '');
    },
    remove: (id) => call('remove', id),
    play: (id) => call('play', id),
  };
})();
