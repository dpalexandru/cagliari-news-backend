// Legge 3 feed RSS e stampa la struttura degli item (nessun DB).
// Esegui con: node src/fetchPreview.js

require('dotenv').config();
const RSSParser = require('rss-parser');

const parser = new RSSParser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail']
    ]
  },
  // alcuni feed sono lenti: alziamo un po' il timeout
  timeout: 25000
});

// URL dai .env
const FEEDS = [process.env.FEED_1, process.env.FEED_2, process.env.FEED_3].filter(Boolean);

// helper: stampa subset di campi utili
function prettyItemSample(item) {
  const sample = {
    title: item.title,
    link: item.link || item.guid,
    isoDate: item.isoDate || item.pubDate,
    enclosure: item?.enclosure?.url || item?.enclosure,
    mediaContent: item?.mediaContent?.url || item?.mediaContent,
    mediaThumbnail: item?.mediaThumbnail?.url || item?.mediaThumbnail,
    contentSnippet: item?.contentSnippet ? String(item.contentSnippet).slice(0, 140) : undefined,
  };
  return sample;
}
function listItemKeys(item) {
  return Object.keys(item).sort();
}

// retry semplice: prova fino a 3 volte con piccoli ritardi
async function parseWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      if (i > 1) {
        const backoff = 1000 * i; // 1s, 2s, 3s
        await new Promise(r => setTimeout(r, backoff));
        console.log(`(retry ${i}/${attempts}) ${url}...`);
      }
      return await parser.parseURL(url);
    } catch (err) {
      lastErr = err;
      // se è l'ultimo tentativo, rilancia l'errore
      if (i === attempts) throw err;
    }
  }
  throw lastErr;
}

async function previewOneFeed(url) {
  console.log('\n==============================');
  console.log('FEED:', url);
  console.log('------------------------------');
  try {
    const feed = await parseWithRetry(url, 3);
    console.log('Feed title:', feed.title);
    console.log('Items totali:', feed.items?.length || 0);

    if (!feed.items || feed.items.length === 0) {
      console.log('⚠️ Nessun item trovato.');
      return;
    }

    const first = feed.items[0];
    console.log('\nChiavi disponibili sul primo item:\n', listItemKeys(first));

    const limit = Math.min(feed.items.length, 2);
    for (let i = 0; i < limit; i++) {
      console.log(`\n--- Esempio item #${i + 1} (campi principali) ---`);
      console.log(prettyItemSample(feed.items[i]));
    }

    // Per vedere il primo item completo, scommenta:
    // console.dir(first, { depth: 2 });

  } catch (err) {
    console.error('Errore nel leggere il feed:', err.message);
  }
}

(async function main() {
  if (FEEDS.length === 0) {
    console.error('❌ Nessun feed configurato. Aggiungi FEED_1/2/3 nel file .env');
    process.exit(1);
  }

  for (const url of FEEDS) {
    await previewOneFeed(url);
  }
  console.log('\n✅ Preview completata.\n');
})();
