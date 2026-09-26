/* =========================================================
   Ruptures du jour — La Coursive des Alpes.
   Masquer / réafficher un plat depuis le téléphone.

   Les données vivent dans le dépôt de l'éditeur (la-coursive-carte,
   voir gh.js) : cette page n'a rien à elle. « Enregistrer » écrit
     1. published.json  → la carte des clients (QR) ;
     2. une nouvelle version dans versions/<carte>/ → l'éditeur l'affiche
        au prochain chargement, et une publication depuis l'éditeur ne
        fait pas réapparaître le plat.
   Seul le drapeau `hidden` des plats touchés change : le reste des
   fichiers est relu frais juste avant l'écriture, puis réécrit tel quel.
   ========================================================= */

/* Même découpage que l'éditeur (menus-config.js de la-coursive-carte). */
const MENUS = [
  { key: 'carte',     label: 'Carte',      slug: 'carte' },
  { key: 'partager',  label: 'À partager', slug: 'a-partager' },
  { key: 'vins',      label: 'Vins',       slug: 'vins' },
  { key: 'boissons',  label: 'Boissons',   slug: 'alcools-boissons' },
  { key: 'cocktails', label: 'Cocktails',  slug: 'cocktails' },
];
const RAW_PUBLISHED = `https://raw.githubusercontent.com/${GHUB.conf.owner}/${GHUB.conf.repo}/${GHUB.conf.branch}/published.json`;

const state = {
  items: [],             // [{uid, key, id, fr, en, price, section, sub, hidden}]
  pending: new Map(),    // uid -> hidden voulu (seulement les changements réels)
  filter: 'all',         // 'all' | 'hidden' | clé de carte
  q: '',
  saving: false,
};

const $ = (id) => document.getElementById(id);

/* ---------- Utilitaires ---------- */
const parser = new DOMParser();
function plain(s) {
  // Les textes de l'éditeur peuvent contenir du HTML (<br>, &amp;…) : on n'en garde que le texte.
  if (s == null) return '';
  return (parser.parseFromString(String(s), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fold(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
/* Surligne `q` dans `text` sans tenir compte des accents ni de la casse. */
function highlight(text, q) {
  if (!q) return esc(text);
  let folded = '';
  const map = [];                       // index replié -> index d'origine
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    for (let k = 0; k < f.length; k++) { folded += f[k]; map.push(i); }
  }
  const at = folded.indexOf(q);
  if (at < 0) return esc(text);
  const a = map[at], b = map[at + q.length - 1] + 1;
  return esc(text.slice(0, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>' + esc(text.slice(b));
}

function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms || 3200);
}

const isHidden = (it) => (state.pending.has(it.uid) ? state.pending.get(it.uid) : it.hidden);

/* ---------- Chargement ---------- */
function extract(pub) {
  const items = [];
  (pub.menus || []).forEach((m) => {
    let section = '', sub = '';
    (m.blocks || []).forEach((b) => {
      if (b.type === 'section') { section = plain(b.fr); sub = ''; }
      else if (b.type === 'formule' && b.heading) sub = plain(b.text);
      else if (b.type === 'item' && b.id) {
        const fr = plain(b.fr);
        if (!fr) return;
        items.push({
          uid: m.key + ':' + b.id, key: m.key, id: b.id,
          fr, en: plain(b.en), price: plain(b.price),
          section, sub, hidden: !!b.hidden,
        });
      }
    });
  });
  return items;
}

async function fetchPublished() {
  // Avec jeton : l'API, toujours à jour. Sans : raw (cache ~5 min), puis l'API publique.
  if (GHUB.hasToken()) {
    try { const f = await GHUB.getFile('published.json'); if (f) return f.data; } catch (e) { /* repli */ }
  }
  try {
    const r = await fetch(RAW_PUBLISHED + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch (e) { /* repli */ }
  const f = await GHUB.getFile('published.json');
  if (!f) throw new Error('NO_PUBLISHED');
  return f.data;
}

async function load() {
  try {
    const pub = await fetchPublished();
    state.items = extract(pub);
    renderChips(); render();
  } catch (err) {
    console.error(err);
    $('list').innerHTML = '<div class="empty">La carte n\'a pas pu être chargée.<br>Vérifiez la connexion, puis <a href="" style="color:var(--or-clair)">rechargez</a>.</div>';
  }
}

/* ---------- Affichage ---------- */
function renderChips() {
  const hiddenCount = state.items.filter(isHidden).length;
  const present = new Set(state.items.map((it) => it.key));
  const chips = [{ f: 'all', label: 'Tout' }]
    .concat(MENUS.filter((m) => present.has(m.key)).map((m) => ({ f: m.key, label: m.label })))
    .concat([{ f: 'hidden', label: 'Masqués', n: hiddenCount, cls: 'hid' }]);
  $('chips').innerHTML = chips.map((c) =>
    `<button type="button" class="chip ${c.cls || ''}" data-f="${c.f}" aria-pressed="${state.filter === c.f}">${esc(c.label)}${c.n != null ? `<span class="n">${c.n}</span>` : ''}</button>`
  ).join('');
}

const EYE = `<svg class="on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`
  + `<svg class="off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M9.9 5.2A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function render() {
  const q = fold(state.q.trim());
  const shown = state.items.filter((it) => {
    if (state.filter === 'hidden' && !isHidden(it)) return false;
    if (state.filter !== 'all' && state.filter !== 'hidden' && it.key !== state.filter) return false;
    if (q && !fold(it.fr + ' ' + it.en + ' ' + it.sub + ' ' + it.section).includes(q)) return false;
    return true;
  });

  // Ligne de compte
  const count = $('count');
  const n = shown.length;
  let txt = q || state.filter !== 'all' ? `${n} résultat${n > 1 ? 's' : ''}` : `${n} produits`;
  if (state.filter === 'hidden' && !n) txt = 'Aucun produit masqué : tout est à la carte.';
  count.innerHTML = esc(txt) + (state.filter === 'hidden' && n ? ' <button type="button" class="reset" id="showAll">Tout réafficher</button>' : '');

  const list = $('list');
  if (!n) {
    list.innerHTML = state.filter === 'hidden' ? '' : `<div class="empty">Aucun produit ne correspond à «&nbsp;${esc(state.q.trim())}&nbsp;».</div>`;
    return;
  }

  const menuLabel = (k) => (MENUS.find((m) => m.key === k) || {}).label || k;
  let html = '', lastGrp = '';
  shown.forEach((it) => {
    const grp = it.key + '|' + it.section;
    if (grp !== lastGrp) {
      lastGrp = grp;
      const showMenu = state.filter === 'all' || state.filter === 'hidden';
      html += `<div class="grp">${showMenu ? `<span class="menu">${esc(menuLabel(it.key))} · </span>` : ''}${esc(it.section || menuLabel(it.key))}</div>`;
    }
    const hid = isHidden(it);
    const changed = state.pending.has(it.uid);
    const badge = changed
      ? `<span class="badge pending">${hid ? 'À masquer' : 'À réafficher'}</span>`
      : hid ? '<span class="badge">Masqué</span>' : '';
    html += `<div class="row${hid ? ' is-hidden' : ''}" data-uid="${esc(it.uid)}">
      <div class="row-main">
        <div class="fr">${highlight(it.fr, q)}${badge}</div>
        ${it.en ? `<div class="en">${highlight(it.en, q)}</div>` : ''}
        ${it.sub ? `<div class="sub">${esc(it.sub)}</div>` : ''}
      </div>
      ${it.price ? `<div class="p">${esc(it.price)}</div>` : ''}
      <button type="button" class="eye" aria-pressed="${hid}" aria-label="${hid ? 'Réafficher' : 'Masquer'} ${esc(it.fr)}">${EYE}</button>
    </div>`;
  });
  list.innerHTML = html;
}

function renderBar() {
  const bar = $('bar');
  const n = state.pending.size;
  bar.classList.remove('done');
  bar.hidden = !n;
  $('saveBtn').textContent = `Enregistrer${n > 1 ? ' les ' + n + ' changements' : ''}`;
  $('saveBtn').disabled = false;
}

/* ---------- Interactions ---------- */
function setHidden(it, hidden) {
  if (hidden === it.hidden) state.pending.delete(it.uid);
  else state.pending.set(it.uid, hidden);
}

$('list').addEventListener('click', (e) => {
  const btn = e.target.closest('.eye');
  if (!btn || state.saving) return;
  if (!GHUB.hasToken()) { openSheet(); toast('Activez d\'abord la sauvegarde sur ce téléphone.'); return; }
  const it = state.items.find((x) => x.uid === btn.closest('.row').dataset.uid);
  if (!it) return;
  setHidden(it, !isHidden(it));
  if (navigator.vibrate) navigator.vibrate(12);
  renderChips(); render(); renderBar();
});

$('count').addEventListener('click', (e) => {
  if (e.target.id !== 'showAll') return;
  if (!GHUB.hasToken()) { openSheet(); return; }
  state.items.filter(isHidden).forEach((it) => setHidden(it, false));
  renderChips(); render(); renderBar();
  toast('Tout sera réaffiché à l\'enregistrement.');
});

$('chips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  state.filter = c.dataset.f;
  renderChips(); render();
  window.scrollTo({ top: 0 });
});

const qInput = $('q');
qInput.addEventListener('input', () => {
  state.q = qInput.value;
  $('qClear').hidden = !qInput.value;
  render();
});
qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') qInput.blur(); });
$('qClear').addEventListener('click', () => {
  qInput.value = ''; state.q = ''; $('qClear').hidden = true;
  render(); qInput.focus();
});

$('undoBtn').addEventListener('click', () => {
  state.pending.clear();
  renderChips(); render(); renderBar();
});

/* ---------- Enregistrer ---------- */
/* Applique les changements d'une carte à une liste de blocs. -> nb de plats modifiés */
function applyTo(blocks, changes) {
  let n = 0;
  (blocks || []).forEach((b) => {
    if (!changes.has(b.id)) return;
    const want = changes.get(b.id);
    if (!!b.hidden === want) return;
    if (want) b.hidden = true; else delete b.hidden;
    n++;
  });
  return n;
}

async function saveVersion(key, data) {
  const slug = (MENUS.find((m) => m.key === key) || {}).slug || key;
  const name = slug + '_' + GHUB.timestampSuffix();
  let res = await GHUB.createJson(`versions/${key}/${name}.json`, data, 'Version ' + name + ' (ruptures, mobile)');
  if (res.status === 422) {   // même minute qu'une autre version
    const name2 = name + 's' + GHUB.pad(new Date().getSeconds());
    res = await GHUB.createJson(`versions/${key}/${name2}.json`, data, 'Version ' + name2 + ' (ruptures, mobile)');
  }
  if (!res.ok) throw new Error('GitHub API ' + res.status);
}

$('saveBtn').addEventListener('click', async () => {
  if (!state.pending.size || state.saving) return;
  if (!GHUB.hasToken()) { openSheet(); return; }

  // Changements regroupés par carte : key -> Map(id -> hidden)
  const byMenu = new Map();
  const names = { hide: [], show: [] };
  state.pending.forEach((hidden, uid) => {
    const it = state.items.find((x) => x.uid === uid);
    if (!byMenu.has(it.key)) byMenu.set(it.key, new Map());
    byMenu.get(it.key).set(it.id, hidden);
    (hidden ? names.hide : names.show).push(it.fr);
  });
  const message = [
    names.hide.length ? 'Masqué : ' + names.hide.join(', ') : '',
    names.show.length ? 'Réaffiché : ' + names.show.join(', ') : '',
  ].filter(Boolean).join(' · ') + ' (mobile)';

  state.saving = true;
  const btn = $('saveBtn');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    // 1. La carte des clients, relue fraîche juste avant d'écrire.
    const pub = await GHUB.getFile('published.json');
    if (!pub) throw new Error('NO_PUBLISHED');
    (pub.data.menus || []).forEach((m) => { if (byMenu.has(m.key)) applyTo(m.blocks, byMenu.get(m.key)); });
    pub.data.updatedAt = new Date().toISOString();
    await GHUB.putJson('published.json', pub.data, message);

    // 2. L'éditeur : une nouvelle version à partir de la dernière enregistrée.
    let versionFail = false;
    for (const [key, changes] of byMenu) {
      try {
        const latest = (await GHUB.listDir('versions/' + key))[0];
        if (!latest) continue;
        const f = await GHUB.getFile(latest.path);
        if (!f) continue;
        const data = Array.isArray(f.data) ? { style: null, blocks: f.data } : f.data;
        if (applyTo(data.blocks, changes)) await saveVersion(key, data);
      } catch (e) { console.error(e); versionFail = true; }
    }

    // Réussi : l'état enregistré devient l'état de référence.
    state.items = extract(pub.data);
    state.pending.clear();
    renderChips(); render();
    const bar = $('bar');
    bar.classList.add('done');
    btn.textContent = '✓ Enregistré';
    setTimeout(() => { if (!state.pending.size) bar.hidden = true; }, 2200);
    toast(versionFail
      ? 'Carte des clients à jour. L\'éditeur n\'a pas pu être mis à jour : réessayez plus tard.'
      : 'C\'est fait ! La carte des clients se met à jour d\'ici quelques minutes.', 4500);
  } catch (err) {
    console.error(err);
    btn.disabled = false; renderBar();
    if (err.message === 'BAD_TOKEN') { toast('Jeton refusé : vérifiez les réglages.'); openSheet(); }
    else toast('Échec de l\'enregistrement. Vérifiez la connexion et réessayez.', 4500);
  } finally {
    state.saving = false;
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.pending.size) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- Réglages / jeton ---------- */
function updateStatus() {
  const b = $('statusBtn');
  b.classList.toggle('ok', GHUB.hasToken());
  b.classList.toggle('warn', !GHUB.hasToken());
  b.querySelector('.txt').textContent = GHUB.hasToken() ? 'Prêt' : 'À activer';
  $('magicBox').hidden = !GHUB.hasToken();
}
function openSheet() {
  $('tokenInput').value = GHUB.getToken();
  $('magicText').hidden = true;
  updateStatus();
  $('sheet').hidden = false;
}
function closeSheet() { $('sheet').hidden = true; }

$('statusBtn').addEventListener('click', openSheet);
$('sheetClose').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
$('tokenForm').addEventListener('submit', (e) => {
  e.preventDefault();
  GHUB.setToken($('tokenInput').value.trim());
  updateStatus();
  toast(GHUB.hasToken() ? 'Sauvegarde activée sur ce téléphone.' : 'Jeton effacé.');
  if (GHUB.hasToken()) closeSheet();
});
$('copyMagic').addEventListener('click', async () => {
  const url = GHUB.magicUrl(location.origin + location.pathname);
  try { await navigator.clipboard.writeText(url); toast('Lien magique copié. À ouvrir sur l\'autre téléphone.'); }
  catch (e) { const i = $('magicText'); i.hidden = false; i.value = url; i.select(); }
});

GHUB.consumeMagicLink(() => { updateStatus(); toast('Lien magique reconnu : la sauvegarde est activée.'); });
window.addEventListener('hashchange', () => GHUB.consumeMagicLink(() => { updateStatus(); toast('Sauvegarde activée.'); }));

updateStatus();
load();
