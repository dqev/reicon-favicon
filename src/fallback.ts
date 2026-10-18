export interface AvatarOptions {
  size?: number;
  color?: string;
  theme?: "dark" | "light";
}

function hueFor(domain: string): number {
  let h = 0;
  for (let i = 0; i < domain.length; i++) {
    h = (h * 31 + domain.charCodeAt(i)) % 360;
  }
  return h;
}

function clampSize(size: number | undefined): number {
  if (!size || !Number.isFinite(size)) return 64;
  return Math.min(512, Math.max(16, Math.round(size)));
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normHex(color: string | undefined): string | null {
  if (!color) return null;
  const m = HEX.exec(color.trim());
  if (!m) return null;
  return "#" + m[1];
}

function face(hue: number, theme: "dark" | "light") {
  return theme === "light"
    ? { bg: `hsl(${hue} 62% 86%)`, fg: "#1a1a1a" }
    : { bg: `hsl(${hue} 42% 34%)`, fg: "#ffffff" };
}

function square(size: number): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 64 64">'
  );
}

export function letterAvatar(domain: string, opts: AvatarOptions = {}): Uint8Array {
  const size = clampSize(opts.size);
  const theme = opts.theme === "light" ? "light" : "dark";
  const clean = domain.replace(/^www\./i, "");
  const letter = (clean[0] || "?").toUpperCase();
  const hex = normHex(opts.color);
  const { bg, fg } = hex
    ? { bg: hex, fg: luminance(hex) > 0.6 ? "#1a1a1a" : "#ffffff" }
    : face(hueFor(domain), theme);
  const svg =
    square(size) +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    '<text x="32" y="43" font-family="Saans, system-ui, -apple-system, sans-serif" ' +
    `font-size="34" font-weight="500" fill="${fg}" text-anchor="middle">` +
    letter +
    "</text></svg>";
  return new TextEncoder().encode(svg);
}

export function solidAvatar(domain: string, opts: AvatarOptions = {}): Uint8Array {
  const size = clampSize(opts.size);
  const theme = opts.theme === "light" ? "light" : "dark";
  const hex = normHex(opts.color);
  const bg = hex || face(hueFor(domain), theme).bg;
  const svg =
    square(size) + `<rect width="64" height="64" rx="14" fill="${bg}"/></svg>`;
  return new TextEncoder().encode(svg);
}

function luminance(hexIn: string): number {
  let hex = hexIn.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
