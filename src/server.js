// Avvia un server Express con una rotta GET /api/articles e rotte "importanti"
// Esegui: node src/server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const app = express();

// CORS "aperto" per sviluppo. (In prod: restringi al tuo dominio)
app.use(cors());
app.use(express.json());

// --- util: sha1 coerente con il progetto ---
function sha1(str) {
  return crypto.createHash('sha1').update(String(str)).digest('hex');
}

// --- Pool MySQL riutilizzabile ---
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'cagliari_news',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// --- Crea tabella "important_articles" se non esiste ---
async function ensureImportantTable() {
  const sql = `
  CREATE TABLE IF NOT EXISTS important_articles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    url_hash CHAR(40) NOT NULL UNIQUE,
    canonical_url VARCHAR(1024) NOT NULL,
    title VARCHAR(512) DEFAULT NULL,
    image_url TEXT DEFAULT NULL,
    excerpt TEXT DEFAULT NULL,
    published_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await pool.query(sql);
}
ensureImportantTable().catch(err => {
  console.error('Errore ensureImportantTable:', err.message);
});

// --- Healthcheck semplice ---
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/**
 * GET /api/articles
 * Query params:
 *  - page  (default 1)
 *  - limit (default 20, max 100)
 *  - q     (ricerca semplice su title/excerpt via LIKE)
 */
app.get('/api/articles', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    const whereParts = [];
    const params = [];

    if (q) {
      whereParts.push('(title LIKE ? OR excerpt LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    // totale per paginazione
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM articles ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    // dati
    const [rows] = await pool.query(
      `
      SELECT id, title, canonical_url, image_url, excerpt, published_at, created_at
      FROM articles
      ${whereSql}
      ORDER BY (published_at IS NULL), published_at DESC, id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    res.json({
      page,
      limit,
      total,
      items: rows
    });
  } catch (err) {
    console.error('Errore GET /api/articles:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ------------------------------------------------------
// IMPORTANT ARTICLES
// ------------------------------------------------------

/**
 * POST /api/important
 * body: { canonical_url, title?, image_url?, excerpt?, published_at? }
 * Dedup via url_hash UNIQUE (sha1(canonical_url))
 */
app.post('/api/important', async (req, res) => {
  try {
    const {
      canonical_url,
      title = null,
      image_url = null,
      excerpt = null,
      published_at = null,
    } = req.body || {};

    if (!canonical_url) {
      return res.status(400).json({ ok: false, error: 'canonical_url obbligatoria' });
    }

    const url_hash = sha1(canonical_url);

    const sql = `
      INSERT INTO important_articles
        (url_hash, canonical_url, title, image_url, excerpt, published_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = COALESCE(VALUES(title), title),
        image_url = COALESCE(VALUES(image_url), image_url),
        excerpt = COALESCE(VALUES(excerpt), excerpt),
        published_at = COALESCE(VALUES(published_at), published_at)
    `;

    const params = [
      url_hash,
      canonical_url,
      title,
      image_url,
      excerpt,
      published_at ? new Date(published_at) : null,
    ];

    await pool.query(sql, params);
    return res.json({ ok: true, url_hash });
  } catch (err) {
    console.error('Errore POST /api/important:', err);
    return res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

/**
 * GET /api/important
 * Ritorna la lista degli articoli segnati come importanti
 */
app.get('/api/important', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT url_hash, canonical_url, title, image_url, excerpt, published_at, created_at
       FROM important_articles
       ORDER BY created_at DESC`
    );
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('Errore GET /api/important:', err);
    return res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

/**
 * DELETE /api/important/:hash (opzionale)
 * Rimuove un articolo dalla lista degli importanti tramite url_hash
 */
app.delete('/api/important/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    if (!hash || hash.length !== 40) {
      return res.status(400).json({ ok: false, error: 'hash non valido' });
    }
    const [out] = await pool.query(`DELETE FROM important_articles WHERE url_hash = ?`, [hash]);
    return res.json({ ok: true, deleted: out.affectedRows > 0 });
  } catch (err) {
    console.error('Errore DELETE /api/important/:hash:', err);
    return res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

// --- Avvio server ---
const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`✅ Server pronto su http://localhost:${PORT}`);
});
