export interface Target {
  domain: string;
  url: URL;
}

const DOMAIN_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function isBlockedHost(host: string): boolean {
  const h = (host || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa"))
    return true;
  if (h === "metadata.google.internal") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(":")) return true;
  if (!h.includes(".")) return true;
  return false;
}

function fromUrl(u: URL): Target | null {
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname;
  if (isBlockedHost(host) || !DOMAIN_RE.test(host)) return null;
  const domain = host.toLowerCase();
  return { domain, url: new URL("https://" + domain + "/") };
}

export function parseDomain(raw: string): Target | null {
  if (!raw) return null;
  let input = raw.trim();
  try {
    input = decodeURIComponent(input);
  } catch {
    /* keep raw */
  }
  input = input.replace(/^\/+/, "");
  if (!input) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      return fromUrl(new URL(input));
    } catch {
      return null;
    }
  }

  input = input.replace(/^\/\//, "");
  const host = input.split(/[/?#]/)[0] || "";
  if (isBlockedHost(host) || !DOMAIN_RE.test(host)) return null;
  const domain = host.toLowerCase();
  try {
    return { domain, url: new URL("https://" + domain + "/") };
  } catch {
    return null;
  }
}
