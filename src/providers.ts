import { isBlockedHost } from "./validate";
import type { Target } from "./validate";
import type { Candidate, Resolved } from "./types";
import { pickBest, score } from "./select";
import type { PickOptions } from "./select";
import { letterAvatar } from "./fallback";

const UA =
  "Mozilla/5.0 (compatible; Reicon/1.0; +https://favicon.reicon.dev) reicon-favicon-bot";
const MAX_BYTES = 512 * 1024;
const MAX_OG_BYTES = 5 * 1024 * 1024;
const MAX_HTML_BYTES = 384 * 1024;
const PROVIDER_BUDGET_MS = 1500;
const HARD_ABORT_MS = 4000;

export interface ResolveOptions {
  size?: number;
  format?: string;
  color?: string;
  theme?: "dark" | "light";
}

async function safeFetch(
  start: string,
  init: RequestInit,
  maxHops = 3,
): Promise<Response> {
  let current = start;
  for (let hop = 0; hop <= maxHops; hop++) {
    const u = new URL(current);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new Error("bad protocol");
    }
    if (isBlockedHost(u.hostname)) throw new Error("blocked host");
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

function absUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function maxSize(sizes: string): number {
  const pair = /(\d+)\s*x\s*(\d+)/.exec(sizes);
  if (pair) return Math.min(parseInt(pair[1]), parseInt(pair[2]));
  const single = /(\d+)/.exec(sizes);
  return single ? parseInt(single[1]) : 0;
}

function iconScore(l: { href: string; rel: string; sizes: string }): number {
  let s = 0;
  const clean = l.href.split("?")[0] || "";
  if (clean.toLowerCase().endsWith(".svg") || l.rel.includes("mask-icon")) s += 1000;
  if (l.rel.includes("apple-touch-icon")) s += 600;
  if (l.sizes === "any") s += 900;
  s += Math.min(maxSize(l.sizes), 512);
  return s;
}

function capBytes(max: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      if (seen >= max) {
        controller.terminate();
        return;
      }
      const room = max - seen;
      if (chunk.byteLength > room) {
        controller.enqueue(chunk.subarray(0, room));
        seen = max;
        controller.terminate();
        return;
      }
      seen += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
}

export interface ScrapeResult {
  icons: string[];
  images: string[];
  theme?: string;
}

export async function scrape(
  target: Target,
  signal: AbortSignal,
): Promise<ScrapeResult> {
  try {
    const res = await safeFetch(
      target.url.toString(),
      {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal,
      },
      3,
    );
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || (ct && !ct.includes("html"))) return { icons: [], images: [] };

    const finalUrl = res.url || target.url.toString();
    const links: { href: string; rel: string; sizes: string }[] = [];
    const metas: { key: string; content: string }[] = [];
    let done = false;

    const rewriter = new HTMLRewriter()
      .on("link", {
        element(el) {
          const href = el.getAttribute("href");
          if (!href) return;
          links.push({
            href,
            rel: (el.getAttribute("rel") || "").toLowerCase(),
            sizes: (el.getAttribute("sizes") || "").toLowerCase(),
          });
        },
      })
      .on("meta", {
        element(el) {
          const key = (
            el.getAttribute("property") ||
            el.getAttribute("name") ||
            ""
          ).toLowerCase();
          const content = el.getAttribute("content");
          if (key && content) metas.push({ key, content });
        },
      })
      .on("head", {
        element(el) {
          el.onEndTag(() => {
            if (!done && (links.length || metas.length)) {
              done = true;
              throw new Error("__reicon_head_done__");
            }
          });
        },
      });

    const body = res.body ? res.body.pipeThrough(capBytes(MAX_HTML_BYTES)) : null;
    try {
      await rewriter.transform(new Response(body, res)).text();
    } catch (err) {
      if (!(err instanceof Error) || err.message !== "__reicon_head_done__") {
        if (!links.length && !metas.length) return { icons: [], images: [] };
      }
    }

    const icons = links
      .filter((l) => l.rel.includes("icon"))
      .map((l) => ({ l, url: absUrl(l.href, finalUrl) }))
      .filter((x) => !!x.url)
      .sort((a, b) => iconScore(b.l) - iconScore(a.l))
      .map((x) => x.url as string);

    const images = metas
      .filter((m) =>
        m.key === "og:image" ||
        m.key === "og:image:secure_url" ||
        m.key === "twitter:image" ||
        m.key === "twitter:image:src",
      )
      .map((m) => absUrl(m.content, finalUrl))
      .filter((x): x is string => !!x);

    const theme = metas.find((m) => m.key === "theme-color")?.content;

    return {
      icons: dedupe(icons).slice(0, 4),
      images: dedupe(images).slice(0, 2),
      theme,
    };
  } catch {
    return { icons: [], images: [] };
  }
}

async function fetchCandidate(
  source: string,
  url: string,
  signal: AbortSignal,
  maxBytes = MAX_BYTES,
): Promise<Candidate | null> {
  try {
    const res = await safeFetch(
      url,
      {
        headers: { "user-agent": UA, accept: "image/*,*/*;q=0.1" },
        signal,
      },
      1,
    );
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > maxBytes) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    const bytes = new Uint8Array(buf);
    const head = new TextDecoder().decode(bytes.slice(0, 640));
    const looksImage = ct.startsWith("image/") || /<svg[\s>]/i.test(head);
    if (!looksImage) return null;
    return { source, bytes, contentType: ct, url };
  } catch {
    return null;
  }
}

async function scrapeCandidates(
  target: Target,
  signal: AbortSignal,
): Promise<Candidate[]> {
  const { icons } = await scrape(target, signal);
  const out = await Promise.all(
    icons.slice(0, 4).map((u) => fetchCandidate("scraper", u, signal)),
  );
  return out.filter((c): c is Candidate => c !== null);
}

async function single(
  source: string,
  url: string,
  signal: AbortSignal,
): Promise<Candidate[]> {
  const c = await fetchCandidate(source, url, signal);
  return c ? [c] : [];
}

function race(
  providers: Promise<Candidate[]>[],
  pickOpts: PickOptions,
  budgetMs: number,
  onDone: () => void,
): Promise<Resolved | null> {
  return new Promise((resolve) => {
    let pending = providers.length;
    let best: Resolved | null = null;
    let alt: Resolved | null = null;
    let settled = false;

    const pick = () => best || alt;
    const finish = (v: Resolved | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onDone();
      resolve(v);
    };

    const timer = setTimeout(() => finish(pick()), budgetMs);

    for (const p of providers) {
      p.then((cands) => {
        const r = pickBest(cands, pickOpts);
        if (!r) return;
        const matches = !pickOpts.format || r.info.format === pickOpts.format;
        if (matches) {
          if (!best || score(r.info) > score(best.info)) best = r;
        } else if (!alt || score(r.info) > score(alt.info)) {
          alt = r;
        }
        if (!pickOpts.format && r.info.format === "svg") finish(best);
      })
        .catch(() => {})
        .finally(() => {
          pending--;
          if (pending === 0) finish(pick());
        });
    }
  });
}

export async function resolveIcon(
  target: Target,
  opts: ResolveOptions = {},
): Promise<Resolved> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HARD_ABORT_MS);
  const signal = controller.signal;
  const d = target.domain;
  const sz = Math.min(256, Math.max(16, Math.round(opts.size || 256)));
  const pickOpts: PickOptions = { format: opts.format };

  const providers: Promise<Candidate[]>[] = [
    scrapeCandidates(target, signal),
    single(
      "google-v2",
      `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${d}&size=${sz}`,
      signal,
    ),
    single(
      "google",
      `https://www.google.com/s2/favicons?domain=${d}&sz=${sz}`,
      signal,
    ),
    single("duckduckgo", `https://icons.duckduckgo.com/ip3/${d}.ico`, signal),
    single("yandex", `https://favicon.yandex.net/favicon/${d}`, signal),
  ];

  const best = await race(providers, pickOpts, PROVIDER_BUDGET_MS, () =>
    controller.abort(),
  );
  clearTimeout(timer);
  if (best) return best;

  return {
    bytes: letterAvatar(d, { size: opts.size, color: opts.color, theme: opts.theme }),
    contentType: "image/svg+xml",
    source: "fallback",
    info: { format: "svg", width: 64, height: 64 },
    fallback: true,
  };
}

export async function resolveOg(
  target: Target,
  opts: ResolveOptions = {},
): Promise<Resolved> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HARD_ABORT_MS);
  try {
    const { images } = await scrape(target, controller.signal);
    const out = await Promise.all(
      images.map((u) => fetchCandidate("og", u, controller.signal, MAX_OG_BYTES)),
    );
    const best = pickBest(
      out.filter((c): c is Candidate => c !== null),
      { format: opts.format === "svg" ? undefined : opts.format },
    );
    if (best) return best;
  } catch {
    /* fall through to favicon */
  } finally {
    clearTimeout(timer);
  }
  return resolveIcon(target, opts);
}
