import { parseDomain } from "./validate";
import { resolveIcon, resolveOg } from "./providers";
import type { ResolveOptions } from "./providers";
import { letterAvatar, solidAvatar } from "./fallback";

interface Env {
  RL_IMG?: RateLimit;
  RL_META?: RateLimit;
}

const CANONICAL = "https://favicon.reicon.dev";
const CACHE_VERSION = "5";
const IMG_LIMIT = 120;
const META_LIMIT = 30;

const TTL_OK =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, stale-if-error=86400";
const TTL_FALLBACK =
  "public, max-age=600, s-maxage=3600, stale-while-revalidate=3600";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "*",
};

interface Params {
  og: boolean;
  json: boolean;
  redirect: boolean;
  size: number;
  format: string;
  fallback: "letter" | "color" | "none";
  color: string;
  theme: "dark" | "light";
  v: string;
}

export function readParams(url: URL, accept: string): Params {
  const q = url.searchParams;
  const ogRaw = q.get("og");
  const og = ogRaw !== null && ogRaw !== "false" && ogRaw !== "0";

  const fmt = (q.get("format") || q.get("f") || "").toLowerCase();
  const json =
    q.get("json") !== null || fmt === "json" || accept.includes("application/json");

  const redirectRaw = q.get("redirect");
  const redirect =
    redirectRaw !== null && redirectRaw !== "false" && redirectRaw !== "0";

  const sizeRaw = parseInt(q.get("size") || "", 10);
  const size = Number.isFinite(sizeRaw)
    ? Math.min(512, Math.max(16, sizeRaw))
    : 0;

  const fbRaw = (q.get("fallback") || "letter").toLowerCase();
  const fallback: Params["fallback"] =
    fbRaw === "color" || fbRaw === "none" ? fbRaw : "letter";

  const theme = (q.get("theme") || "dark").toLowerCase() === "light" ? "light" : "dark";

  return {
    og,
    json,
    redirect,
    size,
    format: fmt === "json" ? "" : fmt,
    fallback,
    color: q.get("color") || "",
    theme,
    v: q.get("v") || "",
  };
}

export function keyFor(ip: string): string {
  let h = 5381;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) + h + ip.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// In-isolate fixed-window limiter. The Workers Rate Limiting binding is
// currently unreliable (always returns success:true, cloudflare/workers-sdk#16097),
// so this enforces the limit within each isolate while the binding acts as an
// extra cross-isolate layer once Cloudflare fixes it.
const BUCKETS = new Map<string, { count: number; reset: number }>();
const MAX_BUCKETS = 5000;

function localLimit(key: string, limit: number, periodSec: number): boolean {
  const now = Date.now();
  const prev = BUCKETS.get(key);
  if (!prev || now >= prev.reset) {
    BUCKETS.set(key, { count: 1, reset: now + periodSec * 1000 });
    return true;
  }
  prev.count++;
  if (BUCKETS.size > MAX_BUCKETS) {
    for (const [k, v] of BUCKETS) if (now >= v.reset) BUCKETS.delete(k);
    if (BUCKETS.size > MAX_BUCKETS) BUCKETS.clear();
  }
  return prev.count <= limit;
}

function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...CORS, ...extra };
}

function imageResponse(
  bytes: Uint8Array,
  contentType: string,
  cacheControl: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(bytes, {
    status: 200,
    headers: baseHeaders({
      "content-type": contentType,
      "cache-control": cacheControl,
      ...extra,
    }),
  });
}

function textResponse(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: baseHeaders({ "content-type": "text/plain; charset=utf-8", ...extra }),
  });
}

function jsonResponse(payload: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: baseHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...extra,
    }),
  });
}

function tooMany(limit: number): Response {
  return textResponse("Rate limit exceeded", 429, {
    "retry-after": "60",
    "x-ratelimit-limit": String(limit),
    "cache-control": "no-store",
  });
}

function notFound(): Response {
  return textResponse("No favicon found", 404, { "cache-control": "no-store" });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method Not Allowed", 405);
    }

    const path = decodeURIComponent(url.pathname);

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (path === "/health") {
      return jsonResponse({ ok: true, service: "favicon.reicon.dev", v: CACHE_VERSION });
    }

    const params = readParams(url, request.headers.get("accept") || "");
    const isMeta = params.json || params.redirect;

    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const limiter = isMeta ? env.RL_META : env.RL_IMG;
    const limit = isMeta ? META_LIMIT : IMG_LIMIT;
    const rateKey = keyFor(ip) + (isMeta ? ":m" : ":i");

    if (!localLimit(rateKey, limit, 60)) return tooMany(limit);
    if (limiter) {
      try {
        const { success } = await limiter.limit({ key: rateKey });
        if (!success) return tooMany(limit);
      } catch {
        /* limiter unavailable, in-isolate guard still applies */
      }
    }

    const raw = url.searchParams.get("url") || path.replace(/^\/+/, "");
    const target = parseDomain(raw);
    if (!target) {
      return textResponse(`Invalid or unsupported domain: ${raw || "(empty)"}`, 400);
    }

    const domain = target.domain;
    const resolveOpts: ResolveOptions = {
      size: params.size,
      format: params.format,
      color: params.color,
      theme: params.theme,
    };

    const cache = caches.default;
    const cacheKey = new Request(
      `${CANONICAL}/__cache/v${CACHE_VERSION}/${domain}?og=${params.og ? 1 : 0}` +
        `&s=${params.size}&f=${params.format}&fb=${params.fallback}` +
        `&c=${params.color.replace("#", "").toLowerCase()}&t=${params.theme}` +
        (params.v ? `&v=${encodeURIComponent(params.v)}` : ""),
      { method: "GET" },
    );

    const inm = request.headers.get("if-none-match");
    if (!isMeta) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const hitEtag = hit.headers.get("etag");
        if (inm && hitEtag && inm === hitEtag) {
          return new Response(null, {
            status: 304,
            headers: baseHeaders({
              etag: hitEtag,
              "cache-control": hit.headers.get("cache-control") || TTL_OK,
            }),
          });
        }
        return finalize(request, hit);
      }
    }

    let result = params.og
      ? await resolveOg(target, resolveOpts)
      : await resolveIcon(target, resolveOpts);

    if (result.fallback) {
      if (params.fallback === "none") return notFound();
      if (params.fallback === "color") {
        result = {
          ...result,
          bytes: solidAvatar(domain, {
            size: params.size,
            color: params.color,
            theme: params.theme,
          }),
        };
      }
    }

    if (params.json) {
      return jsonResponse({
        domain,
        favicon: `${CANONICAL}/${domain}`,
        og: `${CANONICAL}/${domain}?og=true`,
        source: result.source,
        format: result.info.format,
        width: result.info.width,
        height: result.info.height,
        fallback: !!result.fallback,
      });
    }

    if (params.redirect) {
      if (!result.url) return notFound();
      return new Response(null, {
        status: 302,
        headers: baseHeaders({
          location: result.url,
          "cache-control": "public, max-age=3600",
        }),
      });
    }

    const ttl = result.fallback ? TTL_FALLBACK : TTL_OK;
    const etag =
      `W/"${domain}-${params.og ? 1 : 0}-${result.source}-${result.info.format}` +
      `-${result.info.width}x${result.info.height}-${result.fallback ? 1 : 0}"`;

    if (inm && inm === etag) {
      return new Response(null, {
        status: 304,
        headers: baseHeaders({ etag, "cache-control": ttl }),
      });
    }

    const res = imageResponse(result.bytes, result.contentType, ttl, {
      etag,
      "x-reicon-source": result.source,
      "x-reicon-format": result.info.format,
      "x-reicon-size": `${result.info.width}x${result.info.height}`,
      ...(result.fallback ? { "x-reicon-fallback": "1" } : {}),
    });

    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return finalize(request, res);
  },
};

function finalize(request: Request, res: Response): Response {
  if (request.method === "HEAD") {
    return new Response(null, { status: res.status, headers: res.headers });
  }
  return res;
}
