export interface ExtractedArticle {
  title:       string;
  description: string;
  imageUrl:    string | null;
  bodyText:    string;   // first ~2000 chars of article body for LLM summarisation
  canonicalUrl: string;
}

function metaContent(html: string, property: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return '';
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractBodyText(html: string): string {
  // Try <article>, then <main>, then <body>
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const mainMatch    = html.match(/<main[\s\S]*?<\/main>/i);
  const bodyMatch    = html.match(/<body[\s\S]*?<\/body>/i);
  const chunk = articleMatch?.[0] ?? mainMatch?.[0] ?? bodyMatch?.[0] ?? html;
  return stripTags(chunk).slice(0, 2000);
}

export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TPCE-bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const ogTitle   = metaContent(html, 'og:title');
  const ogDesc    = metaContent(html, 'og:description');
  const ogImage   = metaContent(html, 'og:image');
  const metaDesc  = metaContent(html, 'description');

  // Fallback title from <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle   = ogTitle || (titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : '');
  // Strip site name suffix (e.g. " | TechCrunch")
  const title = rawTitle.replace(/\s*[|–—-]\s*[^|–—-]{3,}$/, '').trim();

  const description = ogDesc || metaDesc;
  const bodyText    = extractBodyText(html);

  return {
    title:        title || 'Untitled',
    description:  description || '',
    imageUrl:     ogImage || null,
    bodyText,
    canonicalUrl: url,
  };
}
