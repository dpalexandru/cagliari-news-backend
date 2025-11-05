// Salva nel DB gli articoli normalizzati dai feed RSS.
// Esegui: node src/saveToDb.js

require('dotenv').config();
const RSSParser = require('rss-parser');
const mysql = require('mysql2/promise');
const { normalizeItem } = require('./normalizeItem');

const FEEDS = [process.env.FEED_1, process.env.FEED_2, process.env.FEED_3].filter(Boolean);

// Parser con campi extra per immagini/HTML e timeout più alto
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

// Retry semplice (1s, 2s, 3s)
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

// Crea un pool MySQL (riutilizzabile)
async function createPool() {
  return mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
}

// Inserisce 1 articolo. Dedup su url_hash (UNIQUE).
// Nota: con ON DUPLICATE KEY UPDATE, mysql2 restituisce:
// - affectedRows = 1  -> insert nuovo
// - affectedRows = 2  -> ha fatto "update" (qui no-op) => DOPPIONE
async function insertArticle(pool, a) {
  if (!a.title || !a.canonical_url || !a.url_hash) return { inserted: false, duplicated: false, reason: 'missing key fields' };

  const sql = `
    INSERT INTO articles (title, canonical_url, url_hash, excerpt, content_html, image_url, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE url_hash = url_hash`; // no-op per rilevare duplicato

  const params = [
    a.title,
    a.canonical_url,
    a.url_hash,
    a.excerpt || null,
    a.content_html || null,
    a.image_url || null,
    a.published_at ? new Date(a.published_at) : null
  ];

  const [result] = await pool.query(sql, params);

  if (result.affectedRows === 1) return { inserted: true, duplicated: false };
  if (result.affectedRows === 2) return { inserted: false, duplicated: true };
  return { inserted: false, duplicated: false, reason: 'unexpected affectedRows=' + result.affectedRows };
}

async function saveFeed(pool, url) {
  console.log('\n==============================');
  console.log('FEED:', url);
  console.log('------------------------------');

  try {
    const feed = await parseWithRetry(url, 3);
    const items = feed.items || [];
    console.log('Feed title:', feed.title);
    console.log('Items totali nel feed:', items.length);

    let inserted = 0, duplicated = 0, skipped = 0;

    for (const raw of items) {
      const n = normalizeItem(raw);
      // se manca l'URL non ha senso salvarlo
      if (!n.canonical_url || !n.url_hash || !n.title) {
        skipped++;
        continue;
      }
      try {
        const res = await insertArticle(pool, n);
        if (res.inserted) inserted++;
        else if (res.duplicated) duplicated++;
        else skipped++;
      } catch (e) {
        console.error('Errore insert:', e.message);
        skipped++;
      }
    }

    console.log(`✅ Salvataggio completato per questo feed -> inserted: ${inserted}, duplicated: ${duplicated}, skipped: ${skipped}`);
    return { inserted, duplicated, skipped };
  } catch (err) {
    console.error('Errore nel feed:', err.message);
    return { inserted: 0, duplicated: 0, skipped: 0, error: err.message };
  }
}

(async function main() {
  if (FEEDS.length === 0) {
    console.error('❌ Nessun feed configurato. Aggiungi FEED_1/2/3 nel file .env');
    process.exit(1);
  }

  let pool;
  try {
    pool = await createPool();

    let totalInserted = 0, totalDuplicated = 0, totalSkipped = 0;

    for (const url of FEEDS) {
      const { inserted, duplicated, skipped } = await saveFeed(pool, url);
      totalInserted += inserted;
      totalDuplicated += duplicated;
      totalSkipped += skipped;
    }

    console.log('\n==============================');
    console.log('📊 Totale:', { inserted: totalInserted, duplicated: totalDuplicated, skipped: totalSkipped });
    console.log('==============================\n');
  } catch (e) {
    console.error('❌ Errore generale:', e.message);
  } finally {
    if (pool && pool.end) await pool.end();
  }
})();
