// Normalizza un item RSS in un formato coerente per il DB / API.
// Non scrive su DB: converte solo i campi e torna un oggetto pulito.

const sanitizeHtml = require('sanitize-html');
const crypto = require('crypto');

/** taglia una stringa in modo "gentile" per un estratto */
function makeExcerpt(str, max = 220) {
  if (!str) return null;
  const s = String(str).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trim() + '…';
}

/** prendi la miglior immagine disponibile tra i campi comuni dei feed */
function pickImage(item) {
  // priorità: enclosure -> media:content -> media:thumbnail
  const encl = item?.enclosure;
  if (typeof encl === 'string') return encl;
  if (encl?.url) return encl.url;

  const mContent = item?.mediaContent;
  if (typeof mContent === 'string') return mContent;
  if (mContent?.url) return mContent.url;

  const mThumb = item?.mediaThumbnail;
  if (typeof mThumb === 'string') return mThumb;
  if (mThumb?.url) return mThumb.url;

  // a volte l'immagine è dentro l'HTML del content
  const html = item?.['content:encoded'] || item?.content;
  if (html) {
    const m = String(html).match(/<img[^>]+src="([^"]+)"/i);
    if (m && m[1]) return m[1];
  }
  return null;
}

/** pulisci in modo conservativo l'HTML (per eventuale salvataggio) */
function sanitizeContent(html) {
  if (!html) return null;
  return sanitizeHtml(String(html), {
    allowedTags: ['p', 'a', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'img', 'blockquote'],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt']
    },
    // niente script/style/eventi inline
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

/** genera un hash stabile dell'URL per dedup (lo useremo come unique) */
function sha1(str) {
  return crypto.createHash('sha1').update(String(str)).digest('hex');
}

/**
 * Converte un item RSS in un oggetto standard:
 * {
 *   title, canonical_url, url_hash, published_at, image_url, excerpt, content_html
 * }
 */
function normalizeItem(item) {
  const title = (item?.title || '').trim();
  // molti feed usano link o guid come URL canonico
  const canonical_url = (item?.link || item?.guid || '').trim() || null;

  // published_at: usa isoDate se presente, altrimenti pubDate
  const publishedRaw = item?.isoDate || item?.pubDate || null;
  const published_at = publishedRaw ? new Date(publishedRaw) : null;

  // excerpt: prova contentSnippet/description/content
  const excerptSource = item?.contentSnippet || item?.summary || item?.description || item?.content || null;
  const excerpt = makeExcerpt(excerptSource, 220);

  // content_html (opzionale): preferisci content:encoded poi content
  const rawHtml = item?.['content:encoded'] || item?.content || null;
  const content_html = sanitizeContent(rawHtml);

  const image_url = pickImage(item);

  // hash per dedup (sarà la nostra UNIQUE nel DB)
  const url_hash = canonical_url ? sha1(canonical_url) : null;

  return {
    title,
    canonical_url,
    url_hash,
    published_at,
    image_url,
    excerpt,
    content_html,
  };
}

module.exports = { normalizeItem };
