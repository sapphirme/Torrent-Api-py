type StreamLink = {
  url?: unknown;
  type?: unknown;
  isM3U8?: unknown;
};

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function firstHttpUrl(...values: unknown[]): string | null {
  return values.find(validHttpUrl) as string | undefined || null;
}

export function normalizeStreamResponse(raw: any) {
  if (!raw || typeof raw !== 'object') return null;

  const directLinks: StreamLink[] = Array.isArray(raw.directWatchLinks) ? raw.directWatchLinks : [];
  const sources: StreamLink[] = Array.isArray(raw.sources) ? raw.sources : [];
  const hlsSource = sources.find((source) => source.isM3U8) || directLinks.find((link) => link.type === 'hls');
  const mp4Source = directLinks.find((link) => link.type === 'mp4');
  const sourceUrl = firstHttpUrl(raw.streamUrl, raw.m3u8, raw.mp4, raw.url, raw.masterPlaylistUrl, hlsSource?.url, mp4Source?.url, raw.embedUrl);
  if (!sourceUrl) return null;

  const m3u8 = firstHttpUrl(raw.m3u8, raw.masterPlaylistUrl, hlsSource?.url)
    || (raw.type === 'hls' || sourceUrl.toLowerCase().includes('.m3u8') ? sourceUrl : null);
  const mp4 = firstHttpUrl(raw.mp4, mp4Source?.url)
    || (raw.type === 'mp4' ? sourceUrl : null);
  const embedUrl = firstHttpUrl(raw.embedUrl) || (!m3u8 && !mp4 ? sourceUrl : null);

  return {
    streamUrl: sourceUrl,
    m3u8,
    mp4,
    embedUrl,
    playbackMode: m3u8 ? 'hls' : mp4 ? 'mp4' : 'iframe',
    iframeOnly: !m3u8 && !mp4,
  };
}