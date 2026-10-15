require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const { JWT_SECRET, DB_PATH = 'data/lig.db', PORT = 3000, NODE_ENV } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('HATA: .env içinde en az 32 karakterlik JWT_SECRET tanımla (bkz. .env.example).');
  process.exit(1);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')), password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  win_pts INTEGER NOT NULL DEFAULT 3, draw_pts INTEGER NOT NULL DEFAULT 1, loss_pts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL REFERENCES leagues(id),
  home_id INTEGER NOT NULL REFERENCES users(id), away_id INTEGER NOT NULL REFERENCES users(id),
  played_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('planned','completed')),
  note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('home','away')),
  scorer_id INTEGER NOT NULL REFERENCES users(id), assist_id INTEGER REFERENCES users(id));
`);

// ---- İlk kurulum (şifreler yalnızca ortam değişkenlerinden okunur) ----
if (!db.prepare('SELECT 1 FROM leagues').get()) {
  db.prepare('INSERT INTO leagues (name) VALUES (?)').run('Kardeşler Ligi');
}
for (const [username, display, role, env] of [
  ['yusuf', 'Yusuf', 'admin', 'INITIAL_PASSWORD_YUSUF'],
  ['yunus', 'Yunus', 'user', 'INITIAL_PASSWORD_YUNUS'],
  ['yalcin', 'Yalçın', 'user', 'INITIAL_PASSWORD_YALCIN'],
]) {
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) continue;
  const pw = process.env[env];
  if (!pw || pw.length < 8) { console.warn(`UYARI: ${env} tanımlı değil (en az 8 karakter); ${display} oluşturulmadı.`); continue; }
  db.prepare('INSERT INTO users (username, display_name, role, password_hash) VALUES (?,?,?,?)')
    .run(username, display, role, bcrypt.hashSync(pw, 12));
}

// ---- Yardımcılar ----
class Bad extends Error {}
const h = (fn) => (req, res) => {
  try { res.json(fn(req, res) ?? { ok: true }); }
  catch (e) {
    if (e instanceof Bad) return res.status(400).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'Sunucu hatası. Biraz sonra tekrar dene.' });
  }
};
const DUMMY = bcrypt.hashSync('x', 12);
const attempts = new Map();
const limited = (ip) => {
  const now = Date.now(), a = attempts.get(ip);
  if (!a || now - a.t > 15 * 60 * 1000) { attempts.set(ip, { n: 1, t: now }); return false; }
  return ++a.n > 10;
};

const auth = (req, res, next) => {
  try {
    const p = jwt.verify(req.cookies.token, JWT_SECRET);
    const u = db.prepare('SELECT id, username, display_name, role FROM users WHERE id=?').get(p.id);
    if (!u) throw new Error();
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Devam etmek için giriş yap.' }); }
};
const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekir.' });

// ---- Hesaplamalar: tüm istatistikler maç ve gol kayıtlarından türetilir ----
function getState(me) {
  const league = db.prepare('SELECT * FROM leagues ORDER BY id LIMIT 1').get();
  const users = db.prepare('SELECT id, username, display_name FROM users ORDER BY id').all();
  const allGoals = db.prepare('SELECT * FROM goals').all();
  const matches = db.prepare('SELECT * FROM matches WHERE league_id=? ORDER BY played_at DESC').all(league.id).map((m) => {
    const goals = allGoals.filter((g) => g.match_id === m.id);
    return { ...m, goals, home_score: goals.filter((g) => g.side === 'home').length, away_score: goals.filter((g) => g.side === 'away').length };
  });
  const stats = Object.fromEntries(users.map((u) => [u.id, { id: u.id, name: u.display_name, username: u.username,
    p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, goals: 0, assists: 0 }]));
  for (const m of matches) {
    if (m.status !== 'completed') continue;
    for (const g of m.goals) {
      if (stats[g.scorer_id]) stats[g.scorer_id].goals++;
      if (g.assist_id && stats[g.assist_id]) stats[g.assist_id].assists++;
    }
    const sides = [[m.home_id, m.home_score, m.away_score], [m.away_id, m.away_score, m.home_score]];
    for (const [id, gf, ga] of sides) {
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

function parseMatch(b) {
  const ids = new Set(db.prepare('SELECT id FROM users').all().map((u) => u.id));
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

const saveMatch = db.transaction((id, m) => {
  const league = db.prepare('SELECT id FROM leagues ORDER BY id LIMIT 1').get();
  if (id) {
    if (!db.prepare('SELECT 1 FROM matches WHERE id=?').get(id)) throw new Bad('Maç bulunamadı.');
    db.prepare('UPDATE matches SET home_id=?, away_id=?, played_at=?, status=?, note=? WHERE id=?')
      .run(m.home, m.away, m.played_at, m.status, m.note, id);
    db.prepare('DELETE FROM goals WHERE match_id=?').run(id);
  } else {
    id = db.prepare('INSERT INTO matches (league_id, home_id, away_id, played_at, status, note) VALUES (?,?,?,?,?,?)')
      .run(league.id, m.home, m.away, m.played_at, m.status, m.note).lastInsertRowid;
  }
  const ins = db.prepare('INSERT INTO goals (match_id, side, scorer_id, assist_id) VALUES (?,?,?,?)');
  for (const g of m.goals) ins.run(id, g.side, g.scorer, g.assist);
  return Number(id);
});

// ---- Uygulama ----
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

app.post('/api/login', h((req, res) => {
  if (limited(req.ip)) throw new Bad('Çok fazla deneme yaptın. 15 dakika sonra tekrar dene.');
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(req.body.username || '').trim().toLowerCase());
  const ok = bcrypt.compareSync(String(req.body.password || ''), u ? u.password_hash : DUMMY);
  if (!u || !ok) throw new Bad('Kullanıcı adı veya şifre hatalı.');
  res.cookie('token', jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'strict', secure: NODE_ENV === 'production', maxAge: 7 * 24 * 3600 * 1000 });
}));
app.post('/api/logout', h((req, res) => { res.clearCookie('token'); }));

app.get('/api/state', auth, h((req) => getState(req.user)));

app.post('/api/matches', auth, admin, h((req) => ({ id: saveMatch(null, parseMatch(req.body)) })));
app.put('/api/matches/:id', auth, admin, h((req) => ({ id: saveMatch(Number(req.params.id), parseMatch(req.body)) })));
app.delete('/api/matches/:id', auth, admin, h((req) => { db.prepare('DELETE FROM matches WHERE id=?').run(Number(req.params.id)); }));

app.put('/api/league', auth, admin, h((req) => {
  const b = req.body, pts = [b.win_pts, b.draw_pts, b.loss_pts].map(Number);
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw new Bad('Lig adı boş olamaz.');
  if (pts.some((n) => !Number.isInteger(n) || n < 0 || n > 10)) throw new Bad('Puanlar 0 ile 10 arasında tam sayı olmalı.');
  db.prepare('UPDATE leagues SET name=?, win_pts=?, draw_pts=?, loss_pts=? WHERE id=(SELECT id FROM leagues ORDER BY id LIMIT 1)').run(name, ...pts);
}));

app.put('/api/users/:id/password', auth, admin, h((req) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8) throw new Bad('Şifre en az 8 karakter olmalı.');
  const r = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(pw, 12), Number(req.params.id));
  if (!r.changes) throw new Bad('Kullanıcı bulunamadı.');
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı.' }));
app.listen(PORT, () => console.log(`Lig sitesi çalışıyor: http://localhost:${PORT}`));
