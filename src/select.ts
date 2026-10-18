import { sniff, mimeFor } from "./imageInfo";
import type { Candidate, Info, Resolved } from "./types";

export interface PickOptions {
  format?: string;
}

export function score(i: Info): number {
  const fmt =
    i.format === "svg"
      ? 6
      : i.format === "png" || i.format === "webp"
        ? 4
        : i.format === "jpeg"
          ? 3
          : i.format === "ico"
            ? 2
            : 1;
  const dim = Math.min(i.width || 0, i.height || 0);
  const area = (i.width || 0) * (i.height || 0);
  return fmt * 1_000_000 + Math.min(dim, 512) * 1_000 + Math.min(area, 262_144);
}

function isTiny(info: Info): boolean {
  if (info.width > 0 && info.width < 8) return true;
  if (info.height > 0 && info.height < 8) return true;
  return false;
}

export function pickBest(
  candidates: Candidate[],
  opts: PickOptions = {},
): Resolved | null {
  const usable = candidates
    .map((c) => ({ c, info: sniff(c.bytes) }))
    .filter((x) => x.info.format !== "bin")
    .filter((x) => x.info.format === "svg" || !isTiny(x.info));

  const wantFormat = opts.format
    ? usable.filter((x) => x.info.format === opts.format)
    : [];
  const list = wantFormat.length ? wantFormat : usable;

  let best: Resolved | null = null;
  let bestScore = -Infinity;
  for (const { c, info } of list) {
    const s = score(info);
    if (s > bestScore) {
      bestScore = s;
      best = {
        bytes: c.bytes,
        contentType: c.contentType || mimeFor(info.format),
        source: c.source,
        info,
        url: c.url,
      };
    }
  }
  return best;
}
