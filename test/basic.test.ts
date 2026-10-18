import { describe, it, expect } from "vitest";
import { parseDomain, isBlockedHost } from "../src/validate";
import { sniff } from "../src/imageInfo";
import { pickBest, score } from "../src/select";
import { letterAvatar, solidAvatar } from "../src/fallback";
import { readParams, keyFor } from "../src/index";

describe("parseDomain", () => {
  it("parses a bare domain", () => {
    expect(parseDomain("example.com")?.domain).toBe("example.com");
  });

  it("strips path and query", () => {
    expect(parseDomain("example.com/path?x=1")?.domain).toBe("example.com");
  });

  it("parses a full https URL", () => {
    expect(parseDomain("https://example.com/page")?.domain).toBe("example.com");
  });

  it("parses a full http URL and normalises to https", () => {
    const t = parseDomain("http://example.com");
    expect(t?.domain).toBe("example.com");
    expect(t?.url.protocol).toBe("https:");
  });

  it("accepts a protocol-prefixed path value", () => {
    expect(parseDomain("https://sub.example.co.uk/x")?.domain).toBe("sub.example.co.uk");
  });

  it("rejects empty input", () => {
    expect(parseDomain("")).toBeNull();
  });

  it("rejects localhost and single-label hosts", () => {
    expect(parseDomain("localhost")).toBeNull();
    expect(parseDomain("intranet")).toBeNull();
  });

  it("rejects IP literals", () => {
    expect(parseDomain("127.0.0.1")).toBeNull();
    expect(parseDomain("http://10.0.0.5")).toBeNull();
  });

  it("rejects internal suffixes", () => {
    expect(parseDomain("printer.local")).toBeNull();
    expect(parseDomain("box.internal")).toBeNull();
  });
});

describe("isBlockedHost", () => {
  it("blocks private and special hosts", () => {
    for (const h of [
      "localhost",
      "metadata.google.internal",
      "10.0.0.1",
      "192.168.1.1",
      "::1",
      "foo.local",
    ]) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });

  it("allows normal public hosts", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("sub.github.io")).toBe(false);
  });
});

describe("sniff", () => {
  it("detects SVG dimensions", () => {
    const b = new TextEncoder().encode('<svg width="24" height="24"></svg>');
    expect(sniff(b)).toMatchObject({ format: "svg", width: 24, height: 24 });
  });

  it("detects SVG via viewBox when no width/height", () => {
    const b = new TextEncoder().encode('<svg viewBox="0 0 32 32"><path/></svg>');
    expect(sniff(b)).toMatchObject({ format: "svg", width: 32, height: 32 });
  });

  it("detects PNG dimensions", () => {
    const b = new Uint8Array(24);
    b[0] = 0x89;
    b[1] = 0x50;
    b[2] = 0x4e;
    b[3] = 0x47;
    const dv = new DataView(b.buffer);
    dv.setUint32(16, 64);
    dv.setUint32(20, 64);
    expect(sniff(b)).toMatchObject({ format: "png", width: 64, height: 64 });
  });

  it("returns bin for unknown data", () => {
    expect(sniff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toMatchObject({
      format: "bin",
    });
  });
});

describe("select", () => {
  it("prefers SVG over larger raster", () => {
    const svg = new TextEncoder().encode('<svg viewBox="0 0 16 16"></svg>');
    const png = new Uint8Array(24);
    png[0] = 0x89;
    png[1] = 0x50;
    png[2] = 0x4e;
    png[3] = 0x47;
    const dv = new DataView(png.buffer);
    dv.setUint32(16, 512);
    dv.setUint32(20, 512);

    const best = pickBest([
      { source: "png", bytes: png, contentType: "image/png", url: "x" },
      { source: "svg", bytes: svg, contentType: "image/svg+xml", url: "y" },
    ]);
    expect(best?.info.format).toBe("svg");
    expect(best?.source).toBe("svg");
  });

  it("picks the larger raster when no SVG", () => {
    const mk = (n: number) => {
      const b = new Uint8Array(24);
      b[0] = 0x89;
      b[1] = 0x50;
      b[2] = 0x4e;
      b[3] = 0x47;
      const dv = new DataView(b.buffer);
      dv.setUint32(16, n);
      dv.setUint32(20, n);
      return b;
    };
    const best = pickBest([
      { source: "a", bytes: mk(32), contentType: "image/png", url: "a" },
      { source: "b", bytes: mk(180), contentType: "image/png", url: "b" },
    ]);
    expect(best?.source).toBe("b");
    expect(score(best!.info)).toBeGreaterThan(score({ format: "png", width: 32, height: 32 }));
  });

  it("rejects 1x1 transparent placeholders", () => {
    const b = new Uint8Array(24);
    b[0] = 0x89;
    b[1] = 0x50;
    b[2] = 0x4e;
    b[3] = 0x47;
    const dv = new DataView(b.buffer);
    dv.setUint32(16, 1);
    dv.setUint32(20, 1);
    const best = pickBest([
      { source: "yandex", bytes: b, contentType: "image/png", url: "x" },
    ]);
    expect(best).toBeNull();
  });
});

describe("fallback", () => {
  it("generates a deterministic letter avatar", () => {
    const a = new TextDecoder().decode(letterAvatar("github.com"));
    const b = new TextDecoder().decode(letterAvatar("github.com"));
    expect(a).toBe(b);
    expect(a).toContain("<svg");
    expect(a).toContain(">G<");
  });
});

describe("select format filter", () => {
  const png = (n: number) => {
    const b = new Uint8Array(24);
    b[0] = 0x89;
    b[1] = 0x50;
    b[2] = 0x4e;
    b[3] = 0x47;
    const dv = new DataView(b.buffer);
    dv.setUint32(16, n);
    dv.setUint32(20, n);
    return b;
  };

  it("prefers the requested format over a higher-scoring one", () => {
    const svg = new TextEncoder().encode('<svg viewBox="0 0 16 16"></svg>');
    const best = pickBest(
      [
        { source: "a", bytes: png(256), contentType: "image/png", url: "a" },
        { source: "b", bytes: svg, contentType: "image/svg+xml", url: "b" },
      ],
      { format: "png" },
    );
    expect(best?.info.format).toBe("png");
  });

  it("falls back to any format when the requested one is absent", () => {
    const best = pickBest(
      [{ source: "a", bytes: png(256), contentType: "image/png", url: "a" }],
      { format: "ico" },
    );
    expect(best?.info.format).toBe("png");
  });
});

describe("fallback variants", () => {
  it("solidAvatar has no text", () => {
    const s = new TextDecoder().decode(solidAvatar("example.com", { size: 128 }));
    expect(s).toContain('width="128"');
    expect(s).not.toContain("<text");
  });

  it("letterAvatar honors an explicit color", () => {
    const s = new TextDecoder().decode(letterAvatar("example.com", { color: "#ff0000" }));
    expect(s).toContain("#ff0000");
  });

  it("letterAvatar light theme uses dark text", () => {
    const s = new TextDecoder().decode(letterAvatar("example.com", { theme: "light" }));
    expect(s).toContain("#1a1a1a");
  });
});

describe("readParams", () => {
  const P = (qs: string, accept = "") =>
    readParams(new URL("https://x.dev/a" + qs), accept);

  it("parses og", () => {
    expect(P("?og=true").og).toBe(true);
    expect(P("?og=false").og).toBe(false);
    expect(P("?og").og).toBe(true);
    expect(P("").og).toBe(false);
  });

  it("detects json via query or accept header", () => {
    expect(P("?json=1").json).toBe(true);
    expect(P("?format=json").json).toBe(true);
    expect(P("", "application/json").json).toBe(true);
    expect(P("").json).toBe(false);
  });

  it("clamps size to 16..512", () => {
    expect(P("?size=9999").size).toBe(512);
    expect(P("?size=1").size).toBe(16);
    expect(P("").size).toBe(0);
  });

  it("validates fallback and theme", () => {
    expect(P("?fallback=bogus").fallback).toBe("letter");
    expect(P("?fallback=color").fallback).toBe("color");
    expect(P("?theme=light").theme).toBe("light");
    expect(P("?theme=x").theme).toBe("dark");
  });
});

describe("keyFor", () => {
  it("is stable and distinct per ip", () => {
    expect(keyFor("1.2.3.4")).toBe(keyFor("1.2.3.4"));
    expect(keyFor("1.2.3.4")).not.toBe(keyFor("5.6.7.8"));
  });
});
