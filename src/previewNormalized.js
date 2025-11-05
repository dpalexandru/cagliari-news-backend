// Mostra i primi item NORMALIZZATI per ciascun feed.
// Esegui: node src/previewNormalized.js

require('dotenv').config();
const RSSParser = require('rss-parser');
const { normalizeItem } = require('./normalizeItem');

const parser = new RSSParser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail']
    ]
  },
  timeout: 25000
});

const FEEDS = [process.env.FEED_1, process.env.FEED_2, process.env.FEED_3].filter(Boolean);

// retry semplice con backoff (1s, 2s, 3s)
async function parseWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      if (i > 1) {
        const backoff = 1000 * i;
        await new Promise(r => setTimeout(r, backoff));
        console.log(`(retry ${i}/${attempts}) ${url}...`);
      }
      return await parser.parseURL(url);
    } catch (err) {
      lastErr = err;
      if (i === attempts) throw err;
    }
  }
  throw lastErr;
}

async function previewNormalizedFeed(url) {
  console.log('\n==============================');
  console.log('FEED:', url);
  console.log('------------------------------');

  try {
    const feed = await parseWithRetry(url, 3);
    const items = feed.items || [];
    console.log('Feed title:', feed.title);
    console.log('Items totali:', items.length);

    if (items.length === 0) {
      console.log('⚠️ Nessun item trovato.');
      return;
    }

    const limit = Math.min(items.length, 2);
    for (let i = 0; i < limit; i++) {
      const raw = items[i];
      const normalized = normalizeItem(raw);

      // mostriamo solo i campi che andranno nel DB
      const output = {
        title: normalized.title,
        canonical_url: normalized.canonical_url,
        url_hash: normalized.url_hash,
        published_at: normalized.published_at,
        image_url: normalized.image_url,
        excerpt: normalized.excerpt,
        // content_html è spesso lungo: mostriamo una versione curta
        content_html_preview: normalized.content_html
          ? String(normalized.content_html).slice(0, 120) + '…'
          : null
      };

      console.log(`\n--- Item normalizzato #${i + 1} ---`);
      console.dir(output, { depth: 1 });
    }
    console.log('\n✅ Normalizzazione anteprima completata per questo feed.');

  } catch (err) {
    console.error('Errore nel leggere/normalizzare il feed:', err.message);
  }
}

(async function main() {
  if (FEEDS.length === 0) {
    console.error('❌ Nessun feed configurato. Aggiungi FEED_1/2/3 nel file .env');
    process.exit(1);
  }
  for (const url of FEEDS) {
    await previewNormalizedFeed(url);
  }
  console.log('\n✅ Anteprima normalizzata completata.\n');
})();


