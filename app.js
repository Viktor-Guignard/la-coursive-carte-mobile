/* =========================================================
   Ma carte — La Coursive des Alpes. Web app du restaurant.
   Depuis le téléphone : masquer / réafficher un plat, le modifier
   (nom, traduction, prix, pictos), en ajouter, en supprimer.

   Les données vivent dans le dépôt de l'éditeur (la-coursive-carte,
   voir gh.js) : cette app n'a rien à elle. Les changements sont notés
   comme une liste d'opérations, rejouées au moment de « Publier » sur
     1. published.json  → la carte des clients (QR) ;
     2. une nouvelle version dans versions/<carte>/ → l'éditeur l'affiche
        au prochain chargement, et une publication depuis l'éditeur ne
        défait pas le changement.
   Les deux fichiers sont relus juste avant l'écriture : seuls les plats
   touchés changent, le reste est réécrit tel quel.
   ========================================================= */

/* Même découpage que l'éditeur (menus-config.js de la-coursive-carte). */
const MENUS = [
  { key: 'carte',     label: 'Carte',      slug: 'carte',            tags: true },
  { key: 'partager',  label: 'À partager', slug: 'a-partager' },
  { key: 'vins',      label: 'Vins',       slug: 'vins' },
  { key: 'boissons',  label: 'Boissons',   slug: 'alcools-boissons' },
  { key: 'cocktails', label: 'Cocktails',  slug: 'cocktails' },
];
const RAW_PUBLISHED = `https://raw.githubusercontent.com/${GHUB.conf.owner}/${GHUB.conf.repo}/${GHUB.conf.branch}/published.json`;

const state = {
  base: null,            // published.json tel que chargé
  ops: [],               // opérations en attente, dans l'ordre
  view: null,            // { items, changes } recalculé à chaque changement
  filter: 'all',         // 'all' | 'hidden' | clé de carte
  q: '',
  saving: false,
  editing: null,         // { mode:'edit', uid } | { mode:'add', after: uid }
};

const $ = (id) => document.getElementById(id);
const menuOf = (k) => MENUS.find((m) => m.key === k) || { key: k, label: k, slug: k };
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- Utilitaires ---------- */
const parser = new DOMParser();
function plain(s) {
  // Certains textes de l'éditeur contiennent du HTML (<br>, &amp;…) : on n'en garde que le texte.
  if (s == null) return '';
  return (parser.parseFromString(String(s), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
}
/* Texte saisi → valeur stockée : l'éditeur l'injecte en HTML, donc pas de chevrons. */
function clean(s) { return String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim(); }
function cleanPrice(s) {
  const p = clean(s);
  return /^\d+([.,]\d{1,2})?$/.test(p) ? p + '€' : p;   // « 23 » → « 23€ », comme le reste de la carte
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
function newId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
const plural = (n, s, p) => n + ' ' + (n > 1 ? (p || s + 's') : s);

function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms || 3200);
}

/* ---------- Opérations ----------
   { t:'set', key, id, fields:{fr?, en?, price?, tags?, hidden?} }
   { t:'del', key, id }
   { t:'add', key, afterId, fallbackId, block }                      */
function applyOp(blocks, op) {
  if (op.t === 'set') {
    const b = blocks.find((x) => x.id === op.id);
    if (!b) return 0;
    Object.entries(op.fields).forEach(([k, v]) => {
      if (k === 'hidden') { if (v) b.hidden = true; else delete b.hidden; }
      else if (k === 'tags') { if (v.length) b.tags = v.slice(); else delete b.tags; }
      else b[k] = v;
    });
    return 1;
  }
  if (op.t === 'del') {
    const i = blocks.findIndex((x) => x.id === op.id);
    if (i < 0) return 0;
    blocks.splice(i, 1);
    return 1;
  }
  if (op.t === 'add') {
    if (blocks.some((x) => x.id === op.block.id)) return 0;
    let i = blocks.findIndex((x) => x.id === op.afterId);
    if (i < 0) i = blocks.findIndex((x) => x.id === op.fallbackId);
    if (i < 0) i = blocks.length - 1;
    blocks.splice(i + 1, 0, clone(op.block));
    return 1;
  }
  return 0;
}
function applyOps(key, blocks, ops) {
  return ops.filter((op) => op.key === key).reduce((n, op) => n + applyOp(blocks, op), 0);
}
function applyToPub(pub, ops) {
  (pub.menus || []).forEach((m) => applyOps(m.key, m.blocks || (m.blocks = []), ops));
  return pub;
}

/* ---------- Données → liste de plats ---------- */
function extract(pub) {
  const items = [];
  (pub.menus || []).forEach((m) => {
    let section = '', sectionId = '', sub = '', subId = '';
    (m.blocks || []).forEach((b) => {
      if (b.type === 'section') { section = plain(b.fr); sectionId = b.id; sub = ''; subId = ''; }
      else if (b.type === 'formule' && b.heading) { sub = plain(b.text); subId = b.id; }
      else if (b.type === 'item' && b.id) {
        items.push({
          uid: m.key + ':' + b.id, key: m.key, id: b.id,
          fr: plain(b.fr), en: plain(b.en), price: plain(b.price),
          tags: Array.isArray(b.tags) ? b.tags.slice() : [],
          hidden: !!b.hidden,
          section, sub, grp: m.key + '|' + sectionId + '|' + subId, anchorId: subId || sectionId,
        });
      }
    });
  });
  return items;
}

/* Recalcule la vue : plats effectifs + nature de chaque changement. */
function recompute() {
  const baseItems = extract(state.base);
  const baseIdx = new Map(baseItems.map((it) => [it.uid, it]));
  const items = extract(applyToPub(clone(state.base), state.ops));
  const seen = new Set();
  const changes = { add: [], edit: [], hide: [], show: [], del: [] };
  items.forEach((it) => {
    seen.add(it.uid);
    const b = baseIdx.get(it.uid);
    it.change = '';
    if (!b) { it.change = 'new'; changes.add.push(it.fr); return; }
    const edited = b.fr !== it.fr || b.en !== it.en || b.price !== it.price || b.tags.join() !== it.tags.join();
    if (edited) { it.change = 'edit'; changes.edit.push(it.fr); }
    else if (b.hidden !== it.hidden) { it.change = it.hidden ? 'hide' : 'show'; changes[it.change].push(it.fr); }
  });
  baseItems.forEach((b) => { if (!seen.has(b.uid)) changes.del.push(b.fr); });
  changes.count = changes.add.length + changes.edit.length + changes.hide.length + changes.show.length + changes.del.length;
  state.view = { items, changes };
}
function commit() {
  recompute();
  if (!state.view.changes.count) state.ops = [];
  renderChips(); render(); renderBar();
}
const itemByUid = (uid) => state.view.items.find((x) => x.uid === uid);

/* ---------- Chargement ---------- */
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
    state.base = await fetchPublished();
    commit();
  } catch (err) {
    console.error(err);
    $('list').innerHTML = '<div class="empty">La carte n\'a pas pu être chargée.<br>Vérifiez la connexion, puis <a href="" style="color:var(--or-clair)">rechargez</a>.</div>';
  }
}

/* ---------- Affichage ---------- */
function renderChips() {
  const hiddenCount = state.view.items.filter((it) => it.hidden).length;
  const present = new Set(state.view.items.map((it) => it.key));
  const chips = [{ f: 'all', label: 'Tout' }]
    .concat(MENUS.filter((m) => present.has(m.key)).map((m) => ({ f: m.key, label: m.label })))
    .concat([{ f: 'hidden', label: 'Masqués', n: hiddenCount, cls: 'hid' }]);
  $('chips').innerHTML = chips.map((c) =>
    `<button type="button" class="chip ${c.cls || ''}" data-f="${c.f}" aria-pressed="${state.filter === c.f}">${esc(c.label)}${c.n != null ? `<span class="n">${c.n}</span>` : ''}</button>`
  ).join('');
}

const EYE = `<svg class="on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`
  + `<svg class="off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M9.9 5.2A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const BADGES = {
  new: ['pending', 'Nouveau'], edit: ['pending', 'Modifié'],
  hide: ['pending', 'À masquer'], show: ['pending', 'À réafficher'],
};

function render() {
  const q = fold(state.q.trim());
  const shown = state.view.items.filter((it) => {
    if (state.filter === 'hidden' && !it.hidden) return false;
    if (state.filter !== 'all' && state.filter !== 'hidden' && it.key !== state.filter) return false;
    if (q && !fold(it.fr + ' ' + it.en + ' ' + it.sub + ' ' + it.section).includes(q)) return false;
    return true;
  });

  // Ligne de compte
  const n = shown.length;
  let txt = q || state.filter !== 'all' ? plural(n, 'résultat') : plural(n, 'produit');
  if (state.filter === 'hidden' && !n) txt = 'Aucun produit masqué : tout est à la carte.';
  $('count').innerHTML = esc(txt) + (state.filter === 'hidden' && n ? ' <button type="button" class="reset" id="showAll">Tout réafficher</button>' : '');

  const list = $('list');
  if (!n) {
    list.innerHTML = state.filter === 'hidden' ? '' : `<div class="empty">Aucun produit ne correspond à «&nbsp;${esc(state.q.trim())}&nbsp;».</div>`;
    return;
  }

  // « + Ajouter » en fin de groupe, seulement quand on voit le groupe en entier.
  const canAdd = !q && state.filter !== 'hidden';
  const showMenu = state.filter === 'all' || state.filter === 'hidden';
  let html = '';
  shown.forEach((it, i) => {
    const prev = shown[i - 1], next = shown[i + 1];
    if (!prev || prev.grp !== it.grp) {
      html += `<div class="grp">${showMenu ? `<span class="menu">${esc(menuOf(it.key).label)} · </span>` : ''}${esc(it.section || menuOf(it.key).label)}${it.sub ? `<span class="subgrp">${esc(it.sub)}</span>` : ''}</div>`;
    }
    const badge = BADGES[it.change]
      ? `<span class="badge ${BADGES[it.change][0]}">${BADGES[it.change][1]}</span>`
      : it.hidden ? '<span class="badge">Masqué</span>' : '';
    const tags = it.tags.map((t) => `<span class="tag tag-${esc(t)}">${t === 'veg' ? 'V' : '★'}</span>`).join('');
    html += `<div class="row${it.hidden ? ' is-hidden' : ''}" data-uid="${esc(it.uid)}">
      <button type="button" class="row-main" aria-label="Modifier ${esc(it.fr)}">
        <span class="fr">${highlight(it.fr || 'Sans nom', q)}${tags}${badge}</span>
        ${it.en ? `<span class="en">${highlight(it.en, q)}</span>` : ''}
      </button>
      ${it.price ? `<div class="p">${esc(it.price)}</div>` : ''}
      <button type="button" class="eye" aria-pressed="${it.hidden}" aria-label="${it.hidden ? 'Réafficher' : 'Masquer'} ${esc(it.fr)}">${EYE}</button>
    </div>`;
    if (canAdd && (!next || next.grp !== it.grp)) {
      html += `<button type="button" class="add" data-after="${esc(it.uid)}">+ Ajouter un produit</button>`;
    }
  });
  list.innerHTML = html;
}

function renderBar() {
  const c = state.view.changes;
  const bar = $('bar');
  bar.classList.remove('done');
  bar.hidden = !c.count;
  $('saveBtn').textContent = 'Publier ' + plural(c.count, 'changement');
  $('saveBtn').disabled = false;
}

/* ---------- Interactions : liste ---------- */
function needToken() {
  if (GHUB.hasToken()) return false;
  openSheet('tokenSheet');
  toast('Activez d\'abord ce téléphone pour modifier la carte.');
  return true;
}

$('list').addEventListener('click', (e) => {
  if (state.saving) return;
  const eye = e.target.closest('.eye');
  const main = e.target.closest('.row-main');
  const add = e.target.closest('.add');
  if (!eye && !main && !add) return;
  if (needToken()) return;
  if (add) { openEditor({ mode: 'add', after: add.dataset.after }); return; }
  const it = itemByUid(e.target.closest('.row').dataset.uid);
  if (!it) return;
  if (main) { openEditor({ mode: 'edit', uid: it.uid }); return; }
  state.ops.push({ t: 'set', key: it.key, id: it.id, fields: { hidden: !it.hidden } });
  try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* sans importance */ }
  commit();
});

$('count').addEventListener('click', (e) => {
  if (e.target.id !== 'showAll' || needToken()) return;
  state.view.items.filter((it) => it.hidden).forEach((it) => {
    state.ops.push({ t: 'set', key: it.key, id: it.id, fields: { hidden: false } });
  });
  commit();
  toast('Tout sera réaffiché à la publication.');
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
  state.ops = [];
  commit();
  toast('Changements annulés.');
});

/* ---------- Fiche produit (modifier / ajouter) ---------- */
function openEditor(ed) {
  const ref = itemByUid(ed.mode === 'edit' ? ed.uid : ed.after);
  if (!ref) return;
  state.editing = ed;
  const isAdd = ed.mode === 'add';
  $('editTitle').textContent = isAdd ? 'Nouveau produit' : 'Modifier';
  $('editCtx').textContent = [menuOf(ref.key).label, ref.section, ref.sub].filter(Boolean).join(' · ');
  $('fFr').value = isAdd ? '' : ref.fr;
  $('fEn').value = isAdd ? '' : ref.en;
  $('fPrice').value = isAdd ? '' : ref.price;
  $('fVisible').checked = isAdd ? true : !ref.hidden;
  const tagsBox = $('fTags');
  tagsBox.hidden = !menuOf(ref.key).tags;
  tagsBox.querySelectorAll('input').forEach((c) => { c.checked = !isAdd && ref.tags.includes(c.value); });
  $('delBtn').hidden = isAdd;
  resetDelBtn();
  $('editOk').textContent = isAdd ? 'Ajouter' : 'Valider';
  openSheet('editSheet');
  if (isAdd) setTimeout(() => $('fFr').focus(), 250);
}

$('editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const ed = state.editing;
  if (!ed) return;
  const fr = clean($('fFr').value);
  if (!fr) { toast('Le nom est obligatoire.'); $('fFr').focus(); return; }
  const vals = {
    fr, en: clean($('fEn').value), price: cleanPrice($('fPrice').value),
    tags: [...$('fTags').querySelectorAll('input:checked')].map((c) => c.value),
    hidden: !$('fVisible').checked,
  };
  if (ed.mode === 'add') {
    const after = itemByUid(ed.after);
    const block = { id: newId(), type: 'item', fr: vals.fr, en: vals.en, price: vals.price };
    if (menuOf(after.key).tags && vals.tags.length) block.tags = vals.tags;
    if (vals.hidden) block.hidden = true;
    state.ops.push({ t: 'add', key: after.key, afterId: after.id, fallbackId: after.anchorId, block });
    toast('Ajouté. Pensez à publier.');
  } else {
    const it = itemByUid(ed.uid);
    const fields = {};
    if (vals.fr !== it.fr) fields.fr = vals.fr;
    if (vals.en !== it.en) fields.en = vals.en;
    if (vals.price !== it.price) fields.price = vals.price;
    if (menuOf(it.key).tags && vals.tags.join() !== it.tags.join()) fields.tags = vals.tags;
    if (vals.hidden !== it.hidden) fields.hidden = vals.hidden;
    if (Object.keys(fields).length) state.ops.push({ t: 'set', key: it.key, id: it.id, fields });
  }
  closeSheet('editSheet');
  commit();
});

/* Supprimer : deux appuis, pour éviter l'accident. */
function resetDelBtn() {
  const b = $('delBtn');
  clearTimeout(resetDelBtn._t);
  b.classList.remove('armed');
  b.textContent = 'Supprimer ce produit';
}
$('delBtn').addEventListener('click', () => {
  const b = $('delBtn');
  if (!b.classList.contains('armed')) {
    b.classList.add('armed');
    b.textContent = 'Confirmer la suppression';
    resetDelBtn._t = setTimeout(resetDelBtn, 4000);
    return;
  }
  const it = itemByUid(state.editing.uid);
  state.ops.push({ t: 'del', key: it.key, id: it.id });
  closeSheet('editSheet');
  commit();
  toast('Supprimé. Pour un produit épuisé, masquer suffit.', 4000);
});
$('editCancel').addEventListener('click', () => closeSheet('editSheet'));

/* ---------- Publier ---------- */
function commitMessage(c) {
  return [
    c.add.length ? 'Ajouté : ' + c.add.join(', ') : '',
    c.edit.length ? 'Modifié : ' + c.edit.join(', ') : '',
    c.del.length ? 'Supprimé : ' + c.del.join(', ') : '',
    c.hide.length ? 'Masqué : ' + c.hide.join(', ') : '',
    c.show.length ? 'Réaffiché : ' + c.show.join(', ') : '',
  ].filter(Boolean).join(' · ') + ' (app mobile)';
}

async function saveVersion(key, data) {
  const name = menuOf(key).slug + '_' + GHUB.timestampSuffix();
  let res = await GHUB.createJson(`versions/${key}/${name}.json`, data, 'Version ' + name + ' (app mobile)');
  if (res.status === 422) {   // même minute qu'une autre version
    const name2 = name + 's' + GHUB.pad(new Date().getSeconds());
    res = await GHUB.createJson(`versions/${key}/${name2}.json`, data, 'Version ' + name2 + ' (app mobile)');
  }
  if (!res.ok) throw new Error('GitHub API ' + res.status);
}

$('saveBtn').addEventListener('click', async () => {
  if (!state.view.changes.count || state.saving || needToken()) return;
  const ops = state.ops.slice();
  const keys = [...new Set(ops.map((op) => op.key))];
  const message = commitMessage(state.view.changes);

  state.saving = true;
  const btn = $('saveBtn');
  btn.disabled = true; btn.textContent = 'Publication…';
  try {
    // 1. La carte des clients, relue fraîche juste avant d'écrire.
    const pub = await GHUB.getFile('published.json');
    if (!pub) throw new Error('NO_PUBLISHED');
    applyToPub(pub.data, ops);
    pub.data.updatedAt = new Date().toISOString();
    await GHUB.putJson('published.json', pub.data, message);

    // 2. L'éditeur : une nouvelle version à partir de la dernière enregistrée.
    let versionFail = false;
    for (const key of keys) {
      try {
        const latest = (await GHUB.listDir('versions/' + key))[0];
        if (!latest) continue;
        const f = await GHUB.getFile(latest.path);
        if (!f) continue;
        const data = Array.isArray(f.data) ? { style: null, blocks: f.data } : f.data;
        if (applyOps(key, data.blocks, ops)) await saveVersion(key, data);
      } catch (e) { console.error(e); versionFail = true; }
    }

    // Réussi : l'état publié devient la référence.
    state.base = pub.data;
    state.ops = [];
    commit();
    const bar = $('bar');
    bar.hidden = false;
    bar.classList.add('done');
    btn.textContent = '✓ Publié';
    setTimeout(() => { if (!state.view.changes.count) bar.hidden = true; }, 2200);
    toast(versionFail
      ? 'Carte des clients à jour. L\'éditeur n\'a pas pu suivre : réessayez plus tard.'
      : 'C\'est en ligne ! Le QR code affiche la nouvelle carte d\'ici quelques minutes.', 4500);
  } catch (err) {
    console.error(err);
    renderBar();
    if (err.message === 'BAD_TOKEN') { toast('Jeton refusé : vérifiez les réglages.'); openSheet('tokenSheet'); }
    else toast('Échec de la publication. Vérifiez la connexion et réessayez.', 4500);
  } finally {
    state.saving = false;
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.view && state.view.changes.count) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- Feuilles (réglages, fiche, installation) ---------- */
function openSheet(id) {
  if (id === 'tokenSheet') {
    $('tokenInput').value = GHUB.getToken();
    $('magicText').hidden = true;
    updateStatus();
  }
  $(id).hidden = false;
}
function closeSheet(id) {
  $(id).hidden = true;
  if (id === 'editSheet') state.editing = null;
}
document.querySelectorAll('.sheet-backdrop').forEach((bd) => {
  bd.addEventListener('click', (e) => { if (e.target === bd) closeSheet(bd.id); });
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(b.dataset.close)));

function updateStatus() {
  const b = $('statusBtn');
  b.classList.toggle('ok', GHUB.hasToken());
  b.classList.toggle('warn', !GHUB.hasToken());
  b.querySelector('.txt').textContent = GHUB.hasToken() ? 'Prêt' : 'À activer';
  $('magicBox').hidden = !GHUB.hasToken();
}
$('statusBtn').addEventListener('click', () => openSheet('tokenSheet'));
$('tokenForm').addEventListener('submit', (e) => {
  e.preventDefault();
  // On accepte le jeton seul ou le lien magique entier (utile dans l'app installée sur iPhone).
  let v = $('tokenInput').value.trim();
  const m = v.match(/#jeton=([^\s]+)/);
  if (m) v = decodeURIComponent(m[1]);
  GHUB.setToken(v);
  updateStatus();
  toast(GHUB.hasToken() ? 'Ce téléphone peut modifier la carte.' : 'Jeton effacé.');
  if (GHUB.hasToken()) closeSheet('tokenSheet');
});
$('copyMagic').addEventListener('click', async () => {
  const url = GHUB.magicUrl(location.origin + location.pathname);
  try { await navigator.clipboard.writeText(url); toast('Lien magique copié. À ouvrir sur l\'autre téléphone.'); }
  catch (e) { const i = $('magicText'); i.hidden = false; i.value = url; i.select(); }
});

GHUB.consumeMagicLink(() => { updateStatus(); toast('Lien magique reconnu : ce téléphone peut modifier la carte.'); });
window.addEventListener('hashchange', () => GHUB.consumeMagicLink(() => { updateStatus(); toast('Activé.'); }));

/* ---------- Installation (web app) ---------- */
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* navigation privée */ } }

function renderInstall() {
  $('installBtn').hidden = standalone;
  $('installCard').hidden = standalone || lsGet('coursive_app_install_vu') === '1';
  $('installIos').hidden = !isIOS;
  $('installIosNote').hidden = !isIOS;
  $('installAndroid').hidden = isIOS;
  $('installNow').hidden = !installPrompt;
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; lsSet('coursive_app_install_vu', '1'); renderInstall(); toast('App installée.'); });
$('installBtn').addEventListener('click', () => openSheet('installSheet'));
$('installCardOpen').addEventListener('click', () => openSheet('installSheet'));
$('installCardClose').addEventListener('click', () => { lsSet('coursive_app_install_vu', '1'); renderInstall(); });
$('installNow').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  closeSheet('installSheet');
  renderInstall();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}

updateStatus();
renderInstall();
load();
