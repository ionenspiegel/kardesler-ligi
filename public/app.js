'use strict';
const app = document.getElementById('app');
const topEl = document.getElementById('top');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = { me: null, d: null, filter: 'all', flash: '' };
let after = null;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Bir hata oluştu. Tekrar dene.'); e.status = r.status; throw e; }
  return j;
}
const fmt = (iso) => new Date(iso).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const toLocal = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const nm = (id) => (S.d.users.find((u) => u.id === id) || {}).display_name || '?';
const isAdmin = () => S.me && S.me.role === 'admin';
const box = (msg, cls = 'err') => `<div class="${cls}" role="alert">${esc(msg)}</div>`;
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
const flash = () => { const f = S.flash; S.flash = ''; return f ? box(f, 'ok') : ''; };

async function load() {
  try { S.d = await api('GET', '/api/state'); S.me = S.d.me; } catch { S.me = null; S.d = null; }
  render();
}
async function act(fn, errEl) {
  try { await fn(); }
  catch (e) {
    if (e.status === 401) { S.me = null; S.d = null; return render(); }
    errEl.innerHTML = box(e.message); errEl.scrollIntoView({ block: 'nearest' });
  }
}

// ---------- Görünümler ----------
function tableHtml(compact) {
  const rows = S.d.stats;
  const cols = compact
    ? [['O', 'Oynanan', 'p'], ['Av', 'Averaj', 'gd'], ['P', 'Puan', 'pts']]
    : [['O', 'Oynanan', 'p'], ['G', 'Galibiyet', 'w'], ['B', 'Beraberlik', 'd'], ['M', 'Mağlubiyet', 'l'], ['AG', 'Atılan gol', 'gf'], ['YG', 'Yenilen gol', 'ga'], ['Av', 'Averaj', 'gd'], ['P', 'Puan', 'pts']];
  return `<div class="wrap"><table><caption class="skip">Puan tablosu</caption><thead><tr><th scope="col">#</th><th scope="col">Oyuncu</th>${cols.map((c) => `<th scope="col"><abbr title="${c[1]}">${c[0]}</abbr></th>`).join('')}</tr></thead><tbody>${rows.map((s, i) =>
    `<tr><td>${i + 1}</td><td>${esc(s.name)}</td>${cols.map((c) => `<td${c[2] === 'pts' ? ' class="pts"' : ''}>${c[2] === 'gd' && s.gd > 0 ? '+' : ''}${s[c[2]]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function matchCard(m) {
  const done = m.status === 'completed';
  return `<a class="match" href="#/mac/${m.id}"><span>${esc(nm(m.home_id))}</span><span class="score ${done ? '' : 'vs'}">${done ? `${m.home_score} - ${m.away_score}` : 'vs'}</span><span>${esc(nm(m.away_id))}</span><small>${fmt(m.played_at)} <span class="tag ${done ? 'done' : ''}">${done ? 'Tamamlandı' : 'Planlandı'}</span></small></a>`;
}
function leaders(key, title, unit) {
  const t = [...S.d.stats].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name, 'tr'))[0];
  return `<div class="card"><h3>${title}</h3>${t && t[key] > 0 ? `<p class="big">${esc(t.name)} · ${t[key]} ${unit}</p>` : '<p class="muted">Henüz kayıt yok.</p>'}</div>`;
}

function home() {
  const d = S.d;
  const up = d.matches.filter((m) => m.status === 'planned').sort((a, b) => a.played_at.localeCompare(b.played_at)).slice(0, 3);
  const rec = d.matches.filter((m) => m.status === 'completed').slice(0, 3);
  return `${flash()}<h1>${esc(d.league.name)}</h1>
  <p class="muted">${d.users.length} oyuncu · galibiyet ${d.league.win_pts}, beraberlik ${d.league.draw_pts}, mağlubiyet ${d.league.loss_pts} puan · ${d.matches.filter((m) => m.status === 'completed').length} maç oynandı</p>
  ${isAdmin() ? `<div class="row card"><a class="btn" href="#/mac-duzenle/yeni">Maç ekle</a><a class="btn alt" href="#/maclar">Sonuç gir (maçı seç)</a></div>` : ''}
  <h2>Puan durumu</h2>${tableHtml(true)}<p><a href="#/puan">Tüm tabloyu aç</a></p>
  <div class="grid"><div><h2>Yaklaşan maçlar</h2>${up.map(matchCard).join('') || empty('Planlı maç yok.')}</div>
  <div><h2>Son maçlar</h2>${rec.map(matchCard).join('') || empty('Henüz oynanmış maç yok.')}</div></div>
  <div class="grid">${leaders('goals', 'Gol lideri', 'gol')}${leaders('assists', 'Asist lideri', 'asist')}</div>`;
}
const puan = () => `<h1>Puan Tablosu</h1>${tableHtml(false)}<p class="muted">Sıralama: puan, averaj, atılan gol. Veriler tamamlanan maçlardan hesaplanır.</p>`;

function maclar() {
  const f = S.filter;
  let list = S.d.matches.filter((m) => f === 'all' || (f === 'planned') === (m.status === 'planned'));
  if (f === 'planned') list = [...list].sort((a, b) => a.played_at.localeCompare(b.played_at));
  after = () => app.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { S.filter = b.dataset.f; render(); }));
  const tab = (k, t) => `<button class="btn sm ${f === k ? '' : 'alt'}" data-f="${k}" aria-pressed="${f === k}">${t}</button>`;
  return `${flash()}<h1>Maçlar</h1><div class="row card">${tab('all', 'Tümü')}${tab('planned', 'Yaklaşan')}${tab('completed', 'Tamamlanan')}${isAdmin() ? '<a class="btn sm" href="#/mac-duzenle/yeni">Maç ekle</a>' : ''}</div>
  ${list.map(matchCard).join('') || empty('Bu filtrede maç yok.' + (isAdmin() ? ' İlk maçı eklemek için "Maç ekle"ye bas.' : ''))}`;
}

function detail(id) {
  const m = S.d.matches.find((x) => x.id === Number(id));
  if (!m) return box('Maç bulunamadı.') + '<a href="#/maclar">Maçlara dön</a>';
  const done = m.status === 'completed';
  after = () => { const b = document.getElementById('del'); if (b) b.addEventListener('click', () => act(async () => {
    if (!confirm('Bu maç ve golleri silinsin mi?')) return;
    await api('DELETE', '/api/matches/' + m.id); S.flash = 'Maç silindi.'; await load(); location.hash = '#/maclar';
  }, document.getElementById('err'))); };
  return `${flash()}<h1>Maç detayı</h1>${matchCard(m)}<div id="err"></div>
  <div class="card"><h2>Goller</h2>${done ? (m.goals.length ? `<ul class="rank">${m.goals.map((g) => `<li><span>${esc(nm(g.scorer_id))} (${esc(nm(g.side === 'home' ? m.home_id : m.away_id))} tarafı)</span><span class="muted">${g.assist_id ? 'Asist: ' + esc(nm(g.assist_id)) : 'Asist yok'}</span></li>`).join('')}</ul>` : '<p class="muted">Gol atılmadı.</p>') : '<p class="muted">Maç henüz oynanmadı.</p>'}</div>
  <div class="card"><h2>Not</h2><p>${m.note ? esc(m.note) : '<span class="muted">Not yok.</span>'}</p></div>
  <div class="row"><a class="btn alt" href="#/maclar">Maçlara dön</a>${isAdmin() ? `<a class="btn" href="#/mac-duzenle/${m.id}">Düzenle / sonuç gir</a><button class="btn danger" id="del" type="button">Maçı sil</button>` : ''}</div>`;
}

function king(key, title, unit) {
  const rows = [...S.d.stats].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name, 'tr'));
  const any = rows.some((r) => r[key] > 0);
  return `<h1>${title}</h1>${any ? `<div class="card"><ol class="rank">${rows.map((r, i) => `<li><span>${i + 1}. ${esc(r.name)}</span><span>${r[key]} ${unit}</span></li>`).join('')}</ol></div>` : empty('Henüz ' + unit + ' kaydı yok. Tamamlanan maçların sonuçlarına göre burada görünecek.')}`;
}

const POS = ['Kaleci', 'Defans', 'Orta saha', 'Forvet'];
function oyuncular() {
  const me = S.d.stats.find((x) => x.id === S.me.id) || {};
  after = () => { const f = document.getElementById('pf'), err = document.getElementById('perr');
    f.addEventListener('submit', (e) => { e.preventDefault(); act(async () => {
      await api('PUT', '/api/profile', { first_name: f.first_name.value, last_name: f.last_name.value, country: f.country.value, position: f.position.value });
      S.flash = 'Kartın güncellendi.'; await load();
    }, err); }); };
  return `${flash()}<h1>Oyuncular / Hesaplar</h1><div class="grid">${S.d.stats.map((s) => {
    const full = [s.first_name, s.last_name].filter(Boolean).join(' ') || s.name;
    return `<div class="card"><h2>${esc(full)}</h2><p class="muted">${esc(s.country || 'Ülke girilmedi')} · ${esc(s.position || 'Mevki seçilmedi')}</p><p class="muted">Kullanıcı adı: ${esc(s.username)}</p>
  <div class="stats"><div><b>${s.goals}</b>Gol</div><div><b>${s.assists}</b>Asist</div><div><b>${s.p}</b>Maç</div><div><b>${s.w}</b>Galibiyet</div></div></div>`; }).join('')}</div>
  <form id="pf" class="card" novalidate><h2>Kartımı düzenle</h2>
  <div class="grid"><div><label for="fn">İsim</label><input id="fn" name="first_name" maxlength="40" value="${esc(me.first_name)}"></div>
  <div><label for="ln2">Soyisim</label><input id="ln2" name="last_name" maxlength="40" value="${esc(me.last_name)}"></div>
  <div><label for="ct">Ülke</label><input id="ct" name="country" maxlength="40" value="${esc(me.country)}"></div>
  <div><label for="ps">Mevki</label><select id="ps" name="position"><option value="">Seçilmedi</option>${POS.map((p) => `<option ${me.position === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>
  <div id="perr"></div><button class="btn" type="submit">Kartımı kaydet</button></form>`;
}

const opts = (sel) => S.d.users.map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.display_name)}</option>`).join('');
function goalRow(g = {}) {
  return `<div class="goal"><div><label>Takım</label><select name="side" aria-label="Takım"><option value="home" ${g.side !== 'away' ? 'selected' : ''}></option><option value="away" ${g.side === 'away' ? 'selected' : ''}></option></select></div>
  <div><label>Gol atan</label><select name="scorer_id" aria-label="Gol atan">${opts(g.scorer_id)}</select></div>
  <div><label>Asist (isteğe bağlı)</label><select name="assist_id" aria-label="Asist"><option value="">Asist yok</option>${opts(g.assist_id)}</select></div>
  <button class="btn danger sm rm" type="button">Sil</button></div>`;
}

function macForm(arg) {
  if (!isAdmin()) return box('Bu sayfa için yönetici yetkisi gerekir.');
  const m = S.d.matches.find((x) => x.id === Number(arg)) || { home_id: S.d.users[0]?.id, away_id: S.d.users[1]?.id, played_at: new Date().toISOString(), status: 'planned', note: '', goals: [] };
  const isNew = arg === 'yeni';
  if (!isNew && !m.id) return box('Maç bulunamadı.');
  after = () => {
    const f = document.getElementById('mf'), gl = document.getElementById('goals'), err = document.getElementById('err');
    const refresh = () => { const h = f.home_id.selectedOptions[0].text, a = f.away_id.selectedOptions[0].text;
      f.querySelectorAll('[name=side]').forEach((s) => { s.options[0].text = h + ' tarafı'; s.options[1].text = a + ' tarafı'; }); };
    const toggle = () => { document.getElementById('goalsec').hidden = f.status.value !== 'completed'; };
    gl.insertAdjacentHTML('beforeend', m.goals.map(goalRow).join('')); refresh(); toggle();
    f.status.addEventListener('change', toggle); f.home_id.addEventListener('change', refresh); f.away_id.addEventListener('change', refresh);
    document.getElementById('addg').addEventListener('click', () => { gl.insertAdjacentHTML('beforeend', goalRow()); refresh(); });
    gl.addEventListener('click', (e) => { if (e.target.classList.contains('rm')) e.target.closest('.goal').remove(); });
    f.addEventListener('submit', (e) => { e.preventDefault(); act(async () => {
      if (!f.played_at.value) throw new Error('Tarih ve saat gir.');
      const body = { home_id: f.home_id.value, away_id: f.away_id.value, played_at: new Date(f.played_at.value).toISOString(), status: f.status.value, note: f.note.value,
        goals: [...gl.querySelectorAll('.goal')].map((r) => ({ side: r.querySelector('[name=side]').value, scorer_id: r.querySelector('[name=scorer_id]').value, assist_id: r.querySelector('[name=assist_id]').value })) };
      const r = isNew ? await api('POST', '/api/matches', body) : await api('PUT', '/api/matches/' + m.id, body);
      S.flash = 'Maç kaydedildi.'; await load(); location.hash = '#/mac/' + r.id;
    }, err); });
  };
  return `<h1>${isNew ? 'Yeni maç' : 'Maçı düzenle'}</h1><form id="mf" class="card" novalidate>
  <div class="grid"><div><label for="home_id">Ev sahibi</label><select id="home_id" name="home_id">${opts(m.home_id)}</select></div>
  <div><label for="away_id">Deplasman</label><select id="away_id" name="away_id">${opts(m.away_id)}</select></div></div>
  <label for="played_at">Tarih ve saat</label><input id="played_at" name="played_at" type="datetime-local" value="${toLocal(m.played_at)}" required>
  <label for="status">Durum</label><select id="status" name="status"><option value="planned" ${m.status === 'planned' ? 'selected' : ''}>Planlandı</option><option value="completed" ${m.status === 'completed' ? 'selected' : ''}>Tamamlandı</option></select>
  <div id="goalsec"><h2 class="pad">Goller</h2><p class="muted">Skor, girdiğin gollerden hesaplanır. Gol yoksa 0 - 0 biter.</p><div id="goals"></div><button class="btn alt sm" id="addg" type="button">Gol ekle</button></div>
  <label for="note">Not (isteğe bağlı)</label><textarea id="note" name="note" rows="3" maxlength="500">${esc(m.note)}</textarea>
  <div id="err"></div><div class="row"><button class="btn" type="submit">Kaydet</button><a class="btn alt" href="#/maclar">Vazgeç</a></div></form>`;
}

function yonetim() {
  if (!isAdmin()) return box('Bu sayfa için yönetici yetkisi gerekir.');
  const L = S.d.league;
  after = () => {
    const lf = document.getElementById('lf'), le = document.getElementById('lerr');
    lf.addEventListener('submit', (e) => { e.preventDefault(); act(async () => {
      await api('PUT', '/api/league', { name: lf.name.value, win_pts: lf.win_pts.value, draw_pts: lf.draw_pts.value, loss_pts: lf.loss_pts.value });
      S.flash = 'Lig ayarları kaydedildi.'; await load();
    }, le); });
    app.querySelectorAll('.pwf').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); const pe = f.querySelector('.perr');
      act(async () => { await api('PUT', `/api/users/${f.dataset.id}/password`, { password: f.password.value }); f.reset(); pe.innerHTML = box('Şifre güncellendi.', 'ok'); }, pe); }));
  };
  return `${flash()}<h1>Yönetim</h1><div class="row card"><a class="btn" href="#/mac-duzenle/yeni">Maç ekle</a><a class="btn alt" href="#/maclar">Maçları yönet</a></div>
  <form id="lf" class="card" novalidate><h2>Lig ayarları</h2><label for="ln">Lig adı</label><input id="ln" name="name" value="${esc(L.name)}" maxlength="60" required>
  <div class="grid"><div><label for="wp">Galibiyet puanı</label><input id="wp" name="win_pts" type="number" min="0" max="10" value="${L.win_pts}"></div>
  <div><label for="dp">Beraberlik puanı</label><input id="dp" name="draw_pts" type="number" min="0" max="10" value="${L.draw_pts}"></div>
  <div><label for="lp">Mağlubiyet puanı</label><input id="lp" name="loss_pts" type="number" min="0" max="10" value="${L.loss_pts}"></div></div>
  <div id="lerr"></div><button class="btn" type="submit">Ayarları kaydet</button></form>
  <div class="card"><h2>Şifre sıfırla</h2>${S.d.users.map((u) => `<form class="pwf" data-id="${u.id}" novalidate><label for="pw${u.id}">${esc(u.display_name)} için yeni şifre (en az 8 karakter)</label>
  <div class="row"><input id="pw${u.id}" name="password" type="password" autocomplete="new-password" minlength="8" required><button class="btn sm" type="submit">Güncelle</button></div><div class="perr"></div></form>`).join('')}</div>`;
}

function loginView() {
  after = () => { const f = document.getElementById('lg'), err = document.getElementById('err');
    f.addEventListener('submit', (e) => { e.preventDefault(); act(async () => {
      await api('POST', '/api/login', { username: f.username.value, password: f.password.value }); await load();
    }, err); }); };
  return `<form id="lg" class="card login" novalidate><h1>Giriş yap</h1><label for="u">Kullanıcı adı</label><input id="u" name="username" autocomplete="username" required>
  <label for="p">Şifre</label><input id="p" name="password" type="password" autocomplete="current-password" required><div id="err"></div><p><button class="btn" type="submit">Giriş yap</button></p></form>`;
}

// ---------- Yönlendirme ----------
const routes = { '': home, puan, maclar, mac: detail, 'mac-duzenle': macForm, gol: () => king('goals', 'Gol Krallığı', 'gol'), asist: () => king('assists', 'Asist Krallığı', 'asist'), oyuncular, yonetim };
function header(r) {
  const act = r.startsWith('mac') ? 'maclar' : r;
  const items = [['', 'Ana Sayfa'], ['puan', 'Puan Tablosu'], ['maclar', 'Maçlar'], ['gol', 'Gol Krallığı'], ['asist', 'Asist Krallığı'], ['oyuncular', 'Oyuncular / Hesaplar']];
  if (isAdmin()) items.push(['yonetim', 'Yönetim']);
  topEl.innerHTML = `<div class="bar"><span class="brand">⚽ ${esc(S.d.league.name)}</span><span class="row">${esc(S.me.display_name)} <button class="btn alt sm" id="out" type="button">Çıkış</button></span></div>
  <nav aria-label="Ana menü">${items.map(([k, t]) => `<a href="#/${k}" ${k === act ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
  document.getElementById('out').addEventListener('click', async () => { await api('POST', '/api/logout').catch(() => {}); S.me = null; S.d = null; location.hash = ''; render(); });
}
function render() {
  after = null;
  if (!S.me || !S.d) { topEl.innerHTML = ''; app.innerHTML = loginView(); if (after) after(); return; }
  const [r, arg] = location.hash.slice(2).split('/');
  header(r || '');
  const v = routes[r || ''];
  app.innerHTML = v ? v(arg) : box('Sayfa bulunamadı.') + '<a href="#/">Ana sayfaya dön</a>';
  if (after) after();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); app.focus(); });
load();
