'use strict';
// Ek özellikler: fikstür, rekabet, rozetler, rekorlar, çark, sezon arşivi, koyu mod.
const wa = (fn) => { const a = after; after = () => { if (a) a(); fn(); }; };
const fin = () => S.d.matches.filter((m) => m.status === 'completed').sort((a, b) => a.played_at.localeCompare(b.played_at));
const inM = (m, id) => m.home_id === id || m.away_id === id;
const gf = (m, id) => (id === m.home_id ? m.home_score : m.away_score);
const ga = (m, id) => (id === m.home_id ? m.away_score : m.home_score);
const rs = (m, id) => (gf(m, id) > ga(m, id) ? 'G' : gf(m, id) === ga(m, id) ? 'B' : 'M');
const mine = (id) => fin().filter((m) => inM(m, id));
const streak = (id, ok) => { let n = 0; for (const m of mine(id).reverse()) { if (!ok(rs(m, id))) break; n++; } return n; };
const formHtml = (id) => mine(id).slice(-5).map((m) => { const r = rs(m, id); return `<span class="f f${r}" title="${{ G: 'Galibiyet', B: 'Beraberlik', M: 'Mağlubiyet' }[r]}">${r}</span>`; }).join('') || '<span class="muted">-</span>';

function badges(s) {
  const st = S.d.stats, b = [], top = (k) => Math.max(...st.map((x) => x[k])), ms = mine(s.id);
  if (s.goals > 0 && s.goals === top('goals')) b.push('🥇 Gol kralı');
  if (s.assists > 0 && s.assists === top('assists')) b.push('🎯 Asist kralı');
  if (ms.some((m) => m.goals.filter((g) => g.scorer_id === s.id).length >= 3)) b.push('🎩 Hat-trick');
  if (streak(s.id, (r) => r !== 'M') >= 3) b.push('🛡️ 3+ maçtır yenilmiyor');
  if (streak(s.id, (r) => r === 'G') >= 3) b.push('🔥 3+ galibiyet serisi');
  if (ms.filter((m) => ga(m, s.id) === 0).length >= 2) b.push('🧤 Kale kilidi');
  if (st[0].id === s.id && s.pts > 0) b.push('👑 Lider');
  return b;
}

routes.rekabet = () => {
  const us = S.d.users, rows = [];
  for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
    const a = us[i].id, b = us[j].id, ms = fin().filter((m) => inM(m, a) && inM(m, b));
    const wA = ms.filter((m) => rs(m, a) === 'G').length, wB = ms.filter((m) => rs(m, b) === 'G').length;
    rows.push(`<div class="card"><h2>${esc(nm(a))} - ${esc(nm(b))}</h2>${ms.length ? `<div class="stats"><div><b>${wA}</b>${esc(nm(a))}</div><div><b>${ms.length - wA - wB}</b>Beraberlik</div><div><b>${wB}</b>${esc(nm(b))}</div><div><b>${ms.reduce((t, m) => t + gf(m, a), 0)}-${ms.reduce((t, m) => t + gf(m, b), 0)}</b>Gol</div></div>` : '<p class="muted">Henüz karşılaşma yok.</p>'}</div>`);
  }
  const pairs = {};
  for (const m of fin()) for (const g of m.goals) if (g.assist_id) { const k = g.assist_id + '>' + g.scorer_id; pairs[k] = (pairs[k] || 0) + 1; }
  const top = Object.entries(pairs).sort((x, y) => y[1] - x[1]).slice(0, 3);
  return `<h1>Rekabet</h1>${rows.join('') || empty('Oyuncu yok.')}<h2>En iyi ikili (asist → gol)</h2>${top.length ? `<div class="card"><ol class="rank">${top.map(([k, n]) => { const [x, y] = k.split('>').map(Number); return `<li><span>${esc(nm(x))} → ${esc(nm(y))}</span><span>${n} gol</span></li>`; }).join('')}</ol></div>` : empty('Henüz asistli gol yok.')}`;
};

routes.rekor = () => {
  const f = fin(), head = '<h1>Rekorlar ve Rozetler</h1>';
  if (!f.length) return head + empty('Henüz biten maç yok. Maçlar bitince rekorlar ve rozetler burada görünür.');
  const big = [...f].sort((a, b) => Math.abs(b.home_score - b.away_score) - Math.abs(a.home_score - a.away_score))[0];
  const most = [...f].sort((a, b) => b.home_score + b.away_score - a.home_score - a.away_score)[0];
  const ws = S.d.stats.map((s) => { let best = 0, c = 0; for (const m of mine(s.id)) { c = rs(m, s.id) === 'G' ? c + 1 : 0; best = Math.max(best, c); } return [s.name, best]; }).sort((a, b) => b[1] - a[1])[0];
  const avg = (f.reduce((t, m) => t + m.home_score + m.away_score, 0) / f.length).toFixed(1);
  return `${head}<div class="grid"><div class="card"><h3>En büyük fark</h3>${matchCard(big)}</div><div class="card"><h3>En çok gollü maç</h3>${matchCard(most)}</div>
  <div class="card"><h3>En uzun galibiyet serisi</h3><p class="big">${esc(ws[0])} · ${ws[1]}</p></div><div class="card"><h3>Maç başına gol</h3><p class="big">${avg}</p></div></div>
  <h2>Rozetler</h2><div class="grid">${S.d.stats.map((s) => `<div class="card"><h3>${esc(s.name)}</h3><p>${badges(s).map((x) => `<span class="tag">${x}</span> `).join('') || '<span class="muted">Henüz rozet yok.</span>'}</p><p class="muted">Gol katkısı: ${s.goals + s.assists} · Son 5 maç: ${formHtml(s.id)}</p></div>`).join('')}</div>`;
};

routes.cark = () => {
  wa(() => { const d = document.getElementById('cres'), t = document.getElementById('citems');
    document.getElementById('spin').addEventListener('click', () => {
      const L = t.value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (L.length < 2) { d.textContent = 'En az 2 seçenek yaz.'; return; }
      let i = 0, delay = 60; d.classList.remove('win');
      const tick = () => { d.textContent = L[Math.floor(Math.random() * L.length)]; if (++i < 25) { delay += 12; setTimeout(tick, delay); } else d.classList.add('win'); };
      tick(); }); });
  return `<h1>Ceza Çarkı</h1><div class="card"><label for="citems">Seçenekler (her satıra bir tane)</label><textarea id="citems" rows="6">Bulaşıkları yıka
Çöpü çıkar
Odayı süpür
Çay demle
Masayı topla
Marketten alışveriş yap</textarea><p><button class="btn" id="spin" type="button">Çarkı çevir</button></p><p class="big" id="cres" aria-live="polite">?</p></div>`;
};

routes.sezonlar = () => `<h1>Sezonlar</h1>${S.d.seasons.length ? S.d.seasons.map((s) => `<div class="card"><h2>${esc(s.name)}</h2><p class="muted">Şampiyon: ${esc(s.champion)} · ${new Date(s.ended_at).toLocaleDateString('tr-TR')}</p><ol class="rank">${s.snapshot.stats.map((x, i) => `<li><span>${i + 1}. ${esc(x.name)}</span><span>${x.pts} puan · ${x.p} maç · ${x.goals} gol</span></li>`).join('')}</ol></div>`).join('') : empty('Henüz biten sezon yok. Yönetim sayfasından sezonu bitirebilirsin.')}`;

const _home = routes[''];
routes[''] = () => {
  const h = _home(), st = S.d.stats, info = [];
  const nx = S.d.matches.filter((m) => m.status === 'planned').sort((a, b) => a.played_at.localeCompare(b.played_at))[0];
  if (st[0] && st[1] && st[0].pts > 0) info.push(`👑 Lider ${esc(st[0].name)}, ikinciyle fark ${st[0].pts - st[1].pts} puan.`);
  if (nx) { const left = Math.ceil((new Date(nx.played_at) - Date.now()) / 36e5);
    info.push(`⏱️ Sıradaki maç: ${esc(nm(nx.home_id))} - ${esc(nm(nx.away_id))}, ${left > 0 ? (left >= 48 ? Math.floor(left / 24) + ' gün' : left + ' saat') + ' kaldı' : 'zamanı geldi'}.`); }
  return h + (info.length ? `<div class="card">${info.map((x) => `<p>${x}</p>`).join('')}</div>` : '');
};

const _puan = routes.puan;
routes.puan = () => _puan() + `<h2>Form durumu (son 5 maç)</h2><div class="card">${S.d.stats.map((s) => `<p><b>${esc(s.name)}</b> ${formHtml(s.id)}</p>`).join('')}</div>`;

const _mac = routes.mac;
routes.mac = (id) => {
  const h = _mac(id), m = S.d.matches.find((x) => x.id === Number(id));
  if (!m || m.status !== 'completed') return h;
  wa(() => { const b = document.getElementById('cp'); b.addEventListener('click', async () => {
    const gl = m.goals.map((g) => nm(g.scorer_id)).join(', ');
    try { await navigator.clipboard.writeText(`⚽ ${nm(m.home_id)} ${m.home_score}-${m.away_score} ${nm(m.away_id)}${gl ? '\nGoller: ' + gl : ''}`); b.textContent = 'Kopyalandı ✓'; } catch { b.textContent = 'Kopyalanamadı'; } }); });
  return h + '<p><button class="btn alt" id="cp" type="button">Özeti kopyala (WhatsApp için)</button></p>';
};

const _y = routes.yonetim;
routes.yonetim = () => {
  const h = _y(); if (!isAdmin()) return h;
  wa(() => {
    const ff = document.getElementById('ff'), fe = document.getElementById('ferr');
    ff.addEventListener('submit', (e) => { e.preventDefault(); act(async () => {
      if (!ff.start.value) throw new Error('İlk maç tarihini seç.');
      const r = await api('POST', '/api/fixture', { start: new Date(ff.start.value).toISOString(), days: ff.days.value });
      S.flash = r.created ? `${r.created} maç fikstüre eklendi.` : 'Eklenecek yeni maç yok, fikstür zaten tam.'; await load(); }, fe); });
    const sf = document.getElementById('sf'), se = document.getElementById('serr');
    sf.addEventListener('submit', (e) => { e.preventDefault(); act(async () => {
      if (!confirm('Sezon bitirilsin mi? Tüm maçlar arşive taşınır, tablo sıfırlanır.')) return;
      await api('POST', '/api/season/end', { name: sf.sname.value }); S.flash = 'Sezon arşive alındı, yeni sezon başladı.'; await load(); }, se); });
  });
  return h + `<form id="ff" class="card" novalidate><h2>Otomatik fikstür</h2><p class="muted">Herkes herkesle ev ve deplasman oynar. Zaten eklenmiş maçlar tekrar eklenmez.</p><label for="fs">İlk maç tarihi</label><input id="fs" name="start" type="datetime-local"><label for="fd">Maçlar arası gün</label><input id="fd" name="days" type="number" min="1" max="60" value="7"><div id="ferr"></div><button class="btn" type="submit">Fikstür oluştur</button></form>
  <form id="sf" class="card" novalidate><h2>Sezonu bitir</h2><p class="muted">Tablo arşive kaydedilir, maçlar ve puanlar yeni sezon için sıfırlanır.</p><label for="sn">Sezon adı (isteğe bağlı)</label><input id="sn" name="sname" maxlength="60"><div id="serr"></div><button class="btn danger" type="submit">Sezonu bitir ve arşivle</button></form>`;
};

const _hd = header;
header = (r) => {
  _hd(r);
  const b = document.createElement('button'), dark = () => document.documentElement.dataset.theme === 'dark';
  b.className = 'btn alt sm'; b.type = 'button'; b.textContent = dark() ? '☀️ Açık' : '🌙 Koyu';
  b.addEventListener('click', () => { const d = dark() ? 'light' : 'dark'; document.documentElement.dataset.theme = d;
    try { localStorage.setItem('tema', d); } catch { /* yok say */ } b.textContent = d === 'dark' ? '☀️ Açık' : '🌙 Koyu'; });
  topEl.querySelector('.bar .row').prepend(b);
};
try { if (localStorage.getItem('tema') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch { /* yok say */ }
