# ⚡ Heaven Proxy - Standalone Cloudflare Worker

A high-performance, zero-logs Cloudflare Worker video proxy built to handle video streaming, CORS headers, range requests (`206 Partial Content`), anti-hotlinking referer spoofing, file downloads, and automatic link recovery for AnimeHeaven and other sources.

---

## ✨ Features

- **🌐 Cross-Origin Resource Sharing (CORS)**: Enables playback on any web frontend without CORS errors.
- **⏯️ Byte-Range Requests**: Full support for video seeking, buffer scrubbing, and HTML5 `<video>` controls.
- **🛡️ Anti-Hotlinking Bypasser**: Spoofs `Referer` and `Origin` headers required by upstream media CDNs.
- **🔄 Auto Subdomain Rotation**: Automatically rotates through AnimeHeaven CDN mirrors (`cc`, `co`, `cz`, `f1`, `rx`, `cy`, `po`, `ci`, `sr`, `cv`, `rk`, `7p`) if a CDN node expires or drops connection.
- **🔑 Dynamic Gate Link Recovery**: Uses the `?key=` query parameter to re-fetch fresh live stream links from `/gate.php` if the original link expires.
- **💾 Forced File Download**: Serves video files with `Content-Disposition: attachment; filename="..."` when `&dl=1` is appended.

---

## 🚀 Deployment Options

### Option 1: Quick Deployment via Cloudflare Dashboard (Easiest - 2 Minutes)

1. **Sign in to Cloudflare**: Go to [dash.cloudflare.com](https://dash.cloudflare.com/) and navigate to **Workers & Pages**.
2. **Create Worker**: Click **Create Application** ➔ **Create Worker**.
3. **Name your Worker**: Set the name to `heaven-proxy` and click **Deploy**.
4. **Edit Code**: Click **Edit Code** (or **Quick Edit**).
5. **Paste Code**: Delete all existing code in the editor, copy the complete contents of `index.js` from this folder, and paste it in.
6. **Save and Deploy**: Click **Save and Deploy**.
7. **Copy Worker URL**: Cloudflare will provide your live URL (e.g., `https://heaven-proxy.YOUR-SUBDOMAIN.workers.dev`).

---

### Option 2: Deploying via GitHub Codespaces or Wrangler CLI

If you are using GitHub Codespaces or a local terminal:

1. **Open Terminal in `heaven-proxy` directory**:
   ```bash
   cd heaven-proxy
   ```

2. **Login to Cloudflare**:
   ```bash
   npx wrangler login
   ```
   *(Follow the link in your terminal to authorize Wrangler in your browser).*

3. **Deploy to Cloudflare Workers**:
   ```bash
   npx wrangler deploy
   ```

4. **Copy Output URL**:
   Wrangler will print your live worker URL upon completion:
   `Deployed heaven-proxy to https://heaven-proxy.YOUR-SUBDOMAIN.workers.dev`

---

## 📡 API Usage & Query Parameters

Once deployed, you can send GET or HEAD requests to your Worker URL:

### Endpoint
`GET https://heaven-proxy.YOUR-SUBDOMAIN.workers.dev/proxy`

### Query Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `url` | `string` | **Yes** | URL-encoded direct video or stream URL to proxy. |
| `dl` | `1` or `0` | No | Set to `1` to force file download as attachment. |
| `filename` | `string` | No | Custom filename for the download (e.g. `AnimeEpisode.mp4`). |
| `key` | `string` | No | Episode siteId / key for auto-resolving fresh links if target URL expires. |
| `ref` | `string` | No | Custom Referer header override. |

---

## 🧪 Quick Test Examples

### 1. Check Health & Worker Info
```bash
curl https://heaven-proxy.YOUR-SUBDOMAIN.workers.dev/health
```

### 2. Stream Video
```text
https://heaven-proxy.YOUR-SUBDOMAIN.workers.dev/proxy?url=https%3A%2F%2Fci.animeheaven.me%2Fvideo.mp4%3Ffbc23f88cf21a6764d375f9f217e7e75
```

### 3. Download Video with Custom Filename
```text
https://heaven-proxy.YOUR-SUBDOMAIN.workers.dev/proxy?url=https%3A%2F%2Fci.animeheaven.me%2Fvideo.mp4%3Ffbc23f88cf21a6764d375f9f217e7e75&dl=1&filename=Black%20Blood%20Brothers%20-%20Episode%201.mp4
```

---

## 🔗 Bringing your Worker Link back to the App

After deploying your worker, simply provide your deployed URL (e.g. `https://heaven-proxy.YOUR-SUBDOMAIN.workers.dev`) back in the chat, or set `CUSTOM_PROXY_URL=https://heaven-proxy.YOUR-SUBDOMAIN.workers.dev` in your `.env` file!
