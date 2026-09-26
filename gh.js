/* =========================================================
   Socle GitHub partagé (aucune dépendance au DOM).
   Utilisé par l'éditeur (storage.js) et la page Publier (publier.js).
   - Lecture : API publique, aucun jeton requis.
   - Écriture : jeton fine-grained (localStorage), collé une fois
     ou activé par « lien magique » (#jeton=…).
   ========================================================= */
(function (global) {
  const GH = {
    owner: 'Viktor-Guignard',
    repo: 'la-coursive-carte',
    branch: 'main',
    tokenKey: 'carte_gh_token',
  };
  const API = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents`;

  function getToken() { return localStorage.getItem(GH.tokenKey) || ''; }
  function hasToken() { return !!getToken(); }
  function setToken(t) { if (t) localStorage.setItem(GH.tokenKey, t); else localStorage.removeItem(GH.tokenKey); }

  function utf8ToB64(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  }
  function b64ToUtf8(b64) {
    const bin = atob((b64 || '').replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  function authHeaders(extra) {
    const h = Object.assign({ 'Accept': 'application/vnd.github+json' }, extra || {});
    const t = getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  /* Clé chronologique tirée du nom (quel que soit le préfixe d'onglet). */
  function dateKey(name) {
    const m = (name || '').match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})h(\d{2})(?:s(\d{2}))?/);
    return m ? (m[1] + m[2] + m[3] + m[4] + m[5] + (m[6] || '00')) : '';
  }

  /* Liste les fichiers .json d'un dossier. -> [{name, path, sha}] trié récent→ancien (par date). */
  async function listDir(dir) {
    const res = await fetch(`${API}/${dir}?ref=${GH.branch}&t=${Date.now()}`, { headers: authHeaders() });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('GitHub API ' + res.status);
    const items = await res.json();
    if (!Array.isArray(items)) return [];
    return items
      .filter(it => it.type === 'file' && it.name.endsWith('.json'))
      .map(it => ({ name: it.name.replace(/\.json$/, ''), path: it.path, sha: it.sha }))
      .sort((a, b) => { const d = dateKey(b.name).localeCompare(dateKey(a.name)); return d !== 0 ? d : b.name.localeCompare(a.name); });
  }

  /* Récupère un fichier {content parsed, sha}. */
  async function getFile(path) {
    const res = await fetch(`${API}/${path}?ref=${GH.branch}&t=${Date.now()}`, { headers: authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('GitHub API ' + res.status);
    const json = await res.json();
    return { data: JSON.parse(b64ToUtf8(json.content)), sha: json.sha };
  }

  /* Crée un NOUVEAU fichier (échoue si existe). */
  async function createJson(path, obj, message) {
    const token = getToken();
    if (!token) throw new Error('NO_TOKEN');
    const res = await fetch(`${API}/${path}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        message: message || ('Ajout ' + path),
        content: utf8ToB64(JSON.stringify(obj, null, 1)),
        branch: GH.branch,
      }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('BAD_TOKEN');
    return res;
  }

  /* Écrit (crée ou met à jour) un fichier — récupère le sha si besoin. */
  async function putJson(path, obj, message) {
    const token = getToken();
    if (!token) throw new Error('NO_TOKEN');
    let sha = null;
    try { const ex = await getFile(path); if (ex) sha = ex.sha; } catch (e) { /* 404 => création */ }
    const body = {
      message: message || ('Mise à jour ' + path),
      content: utf8ToB64(JSON.stringify(obj, null, 1)),
      branch: GH.branch,
    };
    if (sha) body.sha = sha;
    const res = await fetch(`${API}/${path}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) throw new Error('BAD_TOKEN');
    if (!res.ok) throw new Error('GitHub API ' + res.status);
    return res;
  }

  async function deleteFile(path, sha, message) {
    const token = getToken();
    if (!token) throw new Error('NO_TOKEN');
    const res = await fetch(`${API}/${path}`, {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: message || ('Suppression ' + path), sha, branch: GH.branch }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('BAD_TOKEN');
    if (!res.ok) throw new Error('GitHub API ' + res.status);
    return res;
  }

  /* Lien magique : #jeton=… -> mémorise le jeton et nettoie l'URL. */
  function consumeMagicLink(onDone) {
    try {
      const h = location.hash || '';
      if (!h.startsWith('#jeton=')) return false;
      const tok = decodeURIComponent(h.slice(7)).trim();
      if (!tok) return false;
      setToken(tok);
      try { history.replaceState(null, '', location.pathname + location.search); }
      catch (e) { try { location.hash = ''; } catch (e2) {} }
      if (onDone) setTimeout(onDone, 200);
      return true;
    } catch (e) { return false; }
  }
  function magicUrl(baseUrl) {
    return (baseUrl || (location.origin + location.pathname)) + '#jeton=' + encodeURIComponent(getToken());
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function timestampSuffix() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
  }
  function timestampName(prefix) {
    return `${prefix || 'carte'}_${timestampSuffix()}`;
  }

  global.GHUB = {
    conf: GH, getToken, hasToken, setToken,
    listDir, getFile, createJson, putJson, deleteFile,
    consumeMagicLink, magicUrl, timestampName, timestampSuffix, dateKey, pad,
  };
})(window);
