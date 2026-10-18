# favicon.reicon.dev

Any website's favicon or Open Graph image, behind one hotlinkable URL. Built on
Cloudflare Workers, edge-cached, and never a broken image.

```
https://favicon.reicon.dev/github.com
https://favicon.reicon.dev/github.com?og=true
```

## Why

- **One URL per site.** No downloading, no hosting, no build step.
- **Best quality.** Races an HTML scraper against Google, DuckDuckGo and Yandex,
  then picks the highest-scoring source (SVG beats raster, larger beats smaller,
  1x1 placeholders are rejected).
- **Never broken.** When nothing resolves, returns a deterministic letter avatar.
- **OG images too.** `?og=true` returns the page's `og:image` / `twitter:image`.
- **Fast and cheap.** Edge cache with long TTLs, conditional requests, and a
  short race budget so slow providers cannot hold a request hostage.

## API

`GET /{domain}` returns an image. `GET /{domain}?og=true` returns the OG image.

| Param | Values | Default | Notes |
| --- | --- | --- | --- |
| `og` | `true` `false` | `false` | Return the Open Graph image instead of the favicon. |
| `size` | `16`..`512` | auto | Size hint passed to providers. |
| `format` / `f` | `svg` `png` `webp` `ico` `json` | auto | Prefer a format; `json` returns metadata. |
| `json` | present | - | Return JSON metadata (also via `Accept: application/json`). |
| `redirect` | `true` | - | `302` to the resolved icon URL instead of proxying bytes. |
| `fallback` | `letter` `color` `none` | `letter` | Avatar style when nothing is found; `none` returns `404`. |
| `color` | hex, e.g. `ff0055` | auto | Avatar background. |
| `theme` | `dark` `light` | `dark` | Avatar palette. |
| `v` | any | - | Cache-buster; pass-through for your own versioning. |

`GET /health` returns `{ "ok": true }`.

### Response headers

- `content-type`, `cache-control`, `etag`
- `x-reicon-source` (`scraper`, `google`, `google-v2`, `duckduckgo`, `yandex`, `og`, `fallback`)
- `x-reicon-format`, `x-reicon-size`
- `x-reicon-fallback: 1` when an avatar was served

Success is cached for 7 days at the edge (`s-maxage`) with
`stale-while-revalidate` and `stale-if-error`. Fallbacks use a shorter 1 hour TTL
so a site that later gains a favicon is picked up quickly.

### Examples

```html
<img src="https://favicon.reicon.dev/github.com" width="32" height="32" alt="GitHub" />
<img src="https://favicon.reicon.dev/stripe.com?og=true" alt="Stripe" />
```

```
GET https://favicon.reicon.dev/vercel.com?json=1
{ "domain": "vercel.com", "favicon": "...", "og": "...", "source": "og",
  "format": "png", "width": 2400, "height": 1350, "fallback": false }
```

## Rate limits

Per IP: **120 image requests/min** and **30 metadata requests/min**, returning
`429` with `Retry-After`. Limits are enforced in-Worker; the Cloudflare Rate
Limiting binding is layered on top for cross-isolate coverage.

> Note: the Workers Rate Limiting binding is currently unreliable in production
> (see cloudflare/workers-sdk#16097), which is why the in-Worker guard exists.

## Self-hosting

```sh
npm install
npm run dev        # wrangler dev
npm run typecheck
npm test
npm run deploy     # wrangler deploy
```

Configure in `wrangler.jsonc`:

- `assets.directory` serves the landing page from `public/`.
- `placement.mode: "smart"` runs the Worker near origin sites.
- `ratelimits` defines the `RL_IMG` / `RL_META` bindings.
- `routes` binds the custom domain (change it, or use the default `*.workers.dev`).

Static assets are served directly and do not invoke the Worker, so the landing
page is free. The best quota win is a Cloudflare **Cache Rule** ("Cache
Everything") on `/{domain}*` so cached hotlinks are served from the edge without
invoking the Worker at all.

## Architecture

- `src/index.ts` - router, rate limiting, caching, ETag/304, query params.
- `src/providers.ts` - provider race, HTML scraper, OG extraction.
- `src/select.ts` - candidate scoring and selection.
- `src/imageInfo.ts` - image format/dimension sniffing.
- `src/validate.ts` - domain parsing and SSRF guard.
- `src/fallback.ts` - deterministic letter/solid avatars.

## License

MIT
