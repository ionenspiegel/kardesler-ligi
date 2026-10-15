require('dotenv').config();
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const { JWT_SECRET, DATABASE_URL, PORT = 3000, NODE_ENV } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 32) { console.error('HATA: JWT_SECRET en az 32 karakter olmalı (bkz. .env.example).'); process.exit(1); }
if (!DATABASE_URL) { console.error('HATA: DATABASE_URL tanımlı değil (bkz. .env.example).'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL, max: 5,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false } });
pool.on('error', (e) => console.error('Veritabanı bağlantı hatası:', e.message));
const q = async (t, p) => (await pool.query(t, p)).rows;
const one = async (t, p) => (await q(t, p))[0];

async function init() {
  await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','user')), password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS leagues (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL,
    win_pts INTEGER NOT NULL DEFAULT 3, draw_pts INTEGER NOT NULL DEFAULT 1, loss_pts INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY, league_id INTEGER NOT NULL REFERENCES leagues(id),
    home_id INTEGER NOT NULL REFERENCES users(id), away_id INTEGER NOT NULL REFERENCES users(id),
    played_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('planned','completed')),
    note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS goals (
    id SERIAL PRIMARY KEY, match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('home','away')),
    scorer_id INTEGER NOT NULL REFERENCES users(id), assist_id INTEGER REFERENCES users(id));`);
  if (!(await one('SELECT 1 FROM leagues'))) await q('INSERT INTO leagues (name) VALUES ($1)', ['Kardeşler Ligi']);
  for (const [username, display, role, env] of [
    ['yusuf', 'Yusuf', 'admin', 'INITIAL_PASSWORD_YUSUF'],
    ['yunus', 'Yunus', 'user', 'INITIAL_PASSWORD_YUNUS'],
    ['yalcin', 'Yalçın', 'user', 'INITIAL_PASSWORD_YALCIN'],
  ]) {
    if (await one('SELECT 1 FROM users WHERE username=$1', [username])) continue; // şifre bir kez oluşur, sonra değişmez
    const pw = process.env[env];
    if (!pw || pw.length < 8) { console.warn(`UYARI: ${env} tanımlı değil (en az 8 karakter); ${display} oluşturulmadı.`); continue; }
    await q('INSERT INTO users (username, display_name, role, password_hash) VALUES ($1,$2,$3,$4)', [username, display, role, bcrypt.hashSync(pw, 12)]);
  }
}

class Bad extends Error {}
const h = (fn) => async (req, res) => {
  try { res.json((await fn(req, res)) ?? { ok: true }); }
  catch (e) {
    if (e instanceof Bad) return res.status(400).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'Sunucu hatası. Biraz sonra tekrar dene.' });
  }
};
const pid = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw new Bad('Geçersiz kayıt.'); return n; };
const DUMMY = bcrypt.hashSync('x', 12);
const attempts = new Map();
const limited = (ip) => {
  const now = Date.now(), a = attempts.get(ip);
  if (!a || now - a.t > 15 * 60 * 1000) { attempts.set(ip, { n: 1, t: now }); return false; }
  return ++a.n > 10;
};

const auth = async (req, res, next) => {
  try {
    const p = jwt.verify(req.cookies.token, JWT_SECRET);
    const u = await one('SELECT id, username, display_name, role FROM users WHERE id=$1', [p.id]);
    if (!u) throw new Error();
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Devam etmek için giriş yap.' }); }
};
const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekir.' });

async function getState(me) {
  const league = await one('SELECT * FROM leagues ORDER BY id LIMIT 1');
  const users = await q('SELECT id, username, display_name, first_name, last_name, country, position FROM users ORDER BY id');
  const allGoals = await q('SELECT * FROM goals');
  const rows = await q('SELECT * FROM matches WHERE league_id=$1 ORDER BY played_at DESC', [league.id]);
  const matches = rows.map((m) => {
    const goals = allGoals.filter((g) => g.match_id === m.id);
    return { ...m, goals, home_score: goals.filter((g) => g.side === 'home').length, away_score: goals.filter((g) => g.side === 'away').length };
  });
  const stats = Object.fromEntries(users.map((u) => [u.id, { id: u.id, name: u.display_name, username: u.username,
    first_name: u.first_name, last_name: u.last_name, country: u.country, position: u.position,
    p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, goals: 0, assists: 0 }]));
  for (const m of matches) {
    if (m.status !== 'completed') continue;
    for (const g of m.goals) {
      if (stats[g.scorer_id]) stats[g.scorer_id].goals++;
      if (g.assist_id && stats[g.assist_id]) stats[g.assist_id].assists++;
    }
    for (const [id, gf, ga] of [[m.home_id, m.home_score, m.away_score], [m.away_id, m.away_score, m.home_score]]) {
      const s = stats[id]; if (!s) continue;
      s.p++; s.gf += gf; s.ga += ga;
      if (gf > ga) { s.w++; s.pts += league.win_pts; }
      else if (gf === ga) { s.d++; s.pts += league.draw_pts; }
      else { s.l++; s.pts += league.loss_pts; }
    }
  }
  const table = Object.values(stats).map((s) => ({ ...s, gd: s.gf - s.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name, 'tr'));
  return { me, league, users, matches, stats: table };
}

async function parseMatch(b) {
  const ids = new Set((await q('SELECT id FROM users')).map((u) => u.id));
  const home = Number(b.home_id), away = Number(b.away_id);
  if (!ids.has(home) || !ids.has(away)) throw new Bad('İki katılımcıyı da seç.');
  if (home === away) throw new Bad('Katılımcılar farklı kişiler olmalı.');
  const d = new Date(b.played_at);
  if (isNaN(d)) throw new Bad('Geçerli bir tarih ve saat gir.');
  const status = b.status === 'completed' ? 'completed' : 'planned';
  const goals = status === 'completed' && Array.isArray(b.goals) ? b.goals : [];
  if (goals.length > 60) throw new Bad('En fazla 60 gol girilebilir.');
  const clean = goals.map((g) => {
    const scorer = Number(g.scorer_id), assist = g.assist_id ? Number(g.assist_id) : null;
    if (!['home', 'away'].includes(g.side)) throw new Bad('Her gol için takımı seç.');
    if (!ids.has(scorer)) throw new Bad('Her gol için gol atan kişiyi seç.');
    if (assist !== null && !ids.has(assist)) throw new Bad('Asist yapan kişi geçersiz.');
    if (assist === scorer) throw new Bad('Gol atan kişi kendi golüne asist yapamaz.');
    return { side: g.side, scorer, assist };
  });
  return { home, away, played_at: d.toISOString(), status, note: String(b.note || '').slice(0, 500), goals: clean };
}

async function saveMatch(id, m) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (id) {
      const r = await c.query('UPDATE matches SET home_id=$1, away_id=$2, played_at=$3, status=$4, note=$5 WHERE id=$6',
        [m.home, m.away, m.played_at, m.status, m.note, id]);
      if (!r.rowCount) throw new Bad('Maç bulunamadı.');
      await c.query('DELETE FROM goals WHERE match_id=$1', [id]);
    } else {
      const league = (await c.query('SELECT id FROM leagues ORDER BY id LIMIT 1')).rows[0];
      id = (await c.query('INSERT INTO matches (league_id, home_id, away_id, played_at, status, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [league.id, m.home, m.away, m.played_at, m.status, m.note])).rows[0].id;
    }
    for (const g of m.goals) await c.query('INSERT INTO goals (match_id, side, scorer_id, assist_id) VALUES ($1,$2,$3,$4)', [id, g.side, g.scorer, g.assist]);
    await c.query('COMMIT');
    return id;
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'" });
  next();
});
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', h(async (req, res) => {
  if (limited(req.ip)) throw new Bad('Çok fazla deneme yaptın. 15 dakika sonra tekrar dene.');
  const u = await one('SELECT * FROM users WHERE username=$1', [String(req.body.username || '').trim().toLowerCase()]);
  const ok = bcrypt.compareSync(String(req.body.password || ''), u ? u.password_hash : DUMMY);
  if (!u || !ok) throw new Bad('Kullanıcı adı veya şifre hatalı.');
  res.cookie('token', jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'strict', secure: NODE_ENV === 'production', maxAge: 7 * 24 * 3600 * 1000 });
}));
app.post('/api/logout', h((req, res) => { res.clearCookie('token'); }));

app.get('/api/state', auth, h((req) => getState(req.user)));

app.post('/api/matches', auth, admin, h(async (req) => ({ id: await saveMatch(null, await parseMatch(req.body)) })));
app.put('/api/matches/:id', auth, admin, h(async (req) => ({ id: await saveMatch(pid(req.params.id), await parseMatch(req.body)) })));
app.delete('/api/matches/:id', auth, admin, h(async (req) => { await q('DELETE FROM matches WHERE id=$1', [pid(req.params.id)]); }));

app.put('/api/league', auth, admin, h(async (req) => {
  const b = req.body, pts = [b.win_pts, b.draw_pts, b.loss_pts].map(Number);
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw new Bad('Lig adı boş olamaz.');
  if (pts.some((n) => !Number.isInteger(n) || n < 0 || n > 10)) throw new Bad('Puanlar 0 ile 10 arasında tam sayı olmalı.');
  await q('UPDATE leagues SET name=$1, win_pts=$2, draw_pts=$3, loss_pts=$4 WHERE id=(SELECT id FROM leagues ORDER BY id LIMIT 1)', [name, ...pts]);
}));

app.put('/api/users/:id/password', auth, admin, h(async (req) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8) throw new Bad('Şifre en az 8 karakter olmalı.');
  const r = await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [bcrypt.hashSync(pw, 12), pid(req.params.id)]);
  if (!r.rowCount) throw new Bad('Kullanıcı bulunamadı.');
}));

const POS = ['Kaleci', 'Defans', 'Orta saha', 'Forvet'];
app.put('/api/profile', auth, h(async (req) => {
  const b = req.body, t = (v, n) => String(v || '').trim().slice(0, n);
  const pos = t(b.position, 20);
  if (pos && !POS.includes(pos)) throw new Bad('Geçerli bir mevki seç.');
  await q('UPDATE users SET first_name=$1, last_name=$2, country=$3, position=$4 WHERE id=$5',
    [t(b.first_name, 40), t(b.last_name, 40), t(b.country, 40), pos, req.user.id]);
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı.' }));
init().then(() => app.listen(PORT, () => console.log(`Lig sitesi çalışıyor: http://localhost:${PORT}`)))
  .catch((e) => { console.error('Başlatma hatası:', e.message); process.exit(1); });
