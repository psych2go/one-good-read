export function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(html: string, selector = "body", stopAt?: RegExp): Promise<{ text: string; links: number }> {
  const parts: string[] = [];
  let links = 0;
  let stopped = false;
  const rewriter = new HTMLRewriter()
    .on(selector, {
      text(chunk) {
        if (stopped) return;
        const text = chunk.text;
        if (stopAt?.test(text)) {
          stopped = true;
          return;
        }
        parts.push(text);
        if (chunk.lastInTextNode) parts.push("\n");
      },
    })
    .on(`${selector} a`, {
      element() {
        links += 1;
      },
    })
    .on(`${selector} br`, {
      element() {
        if (!stopped) parts.push("\n");
      },
    })
    .on(`${selector} p`, {
      element() {
        if (!stopped) parts.push("\n");
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return { text: normalizeText(parts.join("")), links };
}

export async function collectLinks(html: string, selector: string, baseUrl: string): Promise<Array<{ url: string; text: string }>> {
  const links: Array<{ url: string; text: string }> = [];
  let current: { url: string; text: string } | undefined;
  const rewriter = new HTMLRewriter().on(selector, {
    element(element) {
      const href = element.getAttribute("href");
      if (!href) return;
      try {
        current = { url: new URL(href, baseUrl).toString(), text: "" };
        links.push(current);
      } catch {
        current = undefined;
      }
    },
    text(chunk) {
      if (current) current.text += chunk.text;
      if (chunk.lastInTextNode && current) current.text = normalizeText(current.text);
    },
  });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return links;
}

export async function extractMeta(html: string): Promise<Record<string, string>> {
  const meta: Record<string, string> = {};
  const rewriter = new HTMLRewriter()
    .on("title", {
      text(chunk) {
        meta.title = `${meta.title ?? ""}${chunk.text}`;
      },
    })
    .on('meta[property="og:title"]', {
      element(element) {
        meta.ogTitle = element.getAttribute("content") ?? "";
      },
    })
    .on('meta[property="article:published_time"]', {
      element(element) {
        meta.published = element.getAttribute("content") ?? "";
      },
    })
    .on("time", {
      element(element) {
        meta.time = element.getAttribute("datetime")?.replace(/^>/, "") ?? meta.time ?? "";
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();
  for (const key of Object.keys(meta)) meta[key] = normalizeText(decodeHtmlEntities(meta[key] ?? ""));
  return meta;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function stripHtmlFragment(html: string): { text: string; links: number } {
  const links = (html.match(/<a\b[^>]*href=/gi) ?? []).length;
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
;
  return { text: normalizeText(decodeHtmlEntities(text)), links };
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, number: string) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}
