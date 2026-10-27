import * as dz from './deezer.js';
import * as sp from './spotify.js';
import { buildSongs, VERSION_TAGS, artistLine, year } from './catalog.js';
import * as E from './engine.js';

// Own prefix: the Spotify version is served from the same github.io origin and shares localStorage.
const INDEX_KEY = 'deezerRanker.artists';
const CURRENT_KEY = 'deezerRanker.current';
const dataKey = id => 'deezerRanker.data.' + id;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- persistence ----------

function defaults(artist = null) {
  return {
    source: 'deezer',
    artist,
    raw: [],
    manual: [],
    include: { sped: false, instrumental: false, remix: true, live: false },
    excluded: [],
    settings: { rounds: null, k: 50 },
    t: null,
    playlist: null,
    spotify: {},   // Deezer track id -> Spotify URI (null if not found), so exports only look each song up once
    scannedAt: null,
  };
}
// Each artist gets its own save slot; the index lists them for the Artists screen.
function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function artistIndex() { return readJSON(INDEX_KEY, []); }
function load(id) {
  const a = artistIndex().find(x => x.id === id);
  return { ...defaults(a ? { id: a.id, name: a.name, image: a.image } : null), ...readJSON(dataKey(id), {}) };
}
let D = defaults();
let saveWarned = false;
function save() {
  if (!D.artist) return;
  try {
    localStorage.setItem(dataKey(D.artist.id), JSON.stringify(D));
    const idx = artistIndex().filter(x => x.id !== D.artist.id);
    idx.unshift({
      ...D.artist,
      updated: Date.now(),
      songs: D.t ? D.t.active.length : null,
      picks: D.t ? D.t.matches.length : 0,
      stage: D.t ? D.t.stage : null,
    });
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
    localStorage.setItem(CURRENT_KEY, D.artist.id);
  } catch {
    if (!saveWarned) toast('Browser storage is full. Download a backup from the Backup tab now.', true);
    saveWarned = true;
  }
}
function openArtist(artist) {
  D = load(artist.id);
  D.artist = { id: artist.id, name: artist.name, image: artist.image };
  undoStack.length = 0;
  rebuild();
  save();
  renderBrand();
  if (!D.raw.length) return scan();
  show(D.t ? 'play' : 'songs');
}
const artistName = () => D.artist?.name || 'this artist';
function renderBrand() {
  $('#brand-artist').textContent = D.artist ? D.artist.name : '';
  document.title = D.artist ? `${D.artist.name} Ranker` : 'Artist Ranker';
}

// ---------- derived catalog ----------

let songs = [];          // deduped catalog
let byId = new Map();    // every known track id -> track
function rebuild() {
  songs = buildSongs([...D.raw, ...D.manual]);
  byId = new Map();
  for (const t of [...D.raw, ...D.manual]) byId.set(t.id, t);
  for (const s of songs) byId.set(s.id, s);
}
function includedIds() {
  const ex = new Set(D.excluded);
  return songs.filter(s => (!s.tag || D.include[s.tag]) && !ex.has(s.id)).map(s => s.id);
}
const song = id => byId.get(id) || { id, name: 'Unknown track', artists: [], album: { name: '', date: '' }, link: dz.trackLink(id) };

// ---------- ui helpers ----------

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = err ? 'err' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), err ? 7000 : 3000);
}

let view = null;
function show(v) {
  view = v;
  for (const s of $$('.view')) s.hidden = s.id !== 'view-' + v;
  $('#tabs').hidden = v === 'connect' || v === 'scan';
  for (const b of $$('#tabs button')) {
    b.classList.toggle('on', b.dataset.view === v);
    if (b.dataset.view !== 'home') b.hidden = !D.t;
  }
  if (v !== 'play') players.pauseAll();
  ({ home: renderHome, songs: renderSongs, play: renderPlay, rank: renderRank, backup: renderBackup }[v] || (() => {}))();
  window.scrollTo(0, 0);
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const sentence = m => /[.!?]$/.test(m) ? m : m + '.';
function copy(text, done) {
  navigator.clipboard.writeText(text).then(() => toast(done), () => toast('Clipboard blocked by the browser', true));
}

// ---------- connect Spotify (export only) ----------

function renderConnect() {
  $('#redirect-uri').textContent = sp.redirectUri();
  $('#client-id').value = sp.getClientId();
  // With a shared Client ID baked into config.js, friends get a one-click login and the setup steps fold away.
  $('#shared-login').hidden = !sp.sharedClientId;
  $('#own-app').open = !sp.sharedClientId;
}
$('#copy-redirect').onclick = () => navigator.clipboard.writeText(sp.redirectUri()).then(() => toast('Copied'));
$('#connect-btn').onclick = () => {
  const id = $('#client-id').value.trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) return toast('That doesn\'t look like a Client ID (32 letters and numbers).', true);
  sp.startLogin(id);
};
$('#shared-login-btn').onclick = () => sp.startLogin(sp.sharedClientId);
$('#connect-back').onclick = () => show(D.t ? 'rank' : 'home');

// ---------- artists ----------

function renderHome() {
  const idx = artistIndex();
  $('#saved-artists').hidden = !idx.length;
  $('#saved-list').innerHTML = idx.map(a => {
    const status = a.stage === 'done' ? 'Finished' : a.stage ? `${(a.picks || 0).toLocaleString()} picks in` : 'Not started';
    return `<li>
      <img src="${esc(a.image)}" alt="" loading="lazy">
      <div class="t-main"><div class="t-name">${esc(a.name)}</div><div class="t-sub">${a.songs ? a.songs + ' songs · ' : ''}${status} · ${new Date(a.updated).toLocaleDateString()}</div></div>
      <span class="row"><button class="primary small" data-open="${a.id}">${a.stage ? 'Continue' : 'Open'}</button>
      <button class="link" data-del="${a.id}">Delete</button></span></li>`;
  }).join('');
}

let searchTimer, searchSeq = 0;
$('#artist-search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { $('#artist-results').innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const res = await dz.searchArtists(q);
      if (seq !== searchSeq) return;
      $('#artist-results').innerHTML = res.map(a => `<li>
        <img src="${esc(a.image)}" alt="" loading="lazy">
        <div class="t-main"><div class="t-name">${esc(a.name)}</div><div class="t-sub">${a.albums.toLocaleString()} releases · ${a.fans.toLocaleString()} fans</div></div>
        <span><button class="primary small" data-pick-artist='${esc(JSON.stringify(a))}'>Rank them</button></span></li>`).join('')
        || '<li><span></span><span class="hint">No artists found.</span></li>';
    } catch (err) { toast(err.message, true); }
  }, 300);
});
$('#artist-results').addEventListener('click', e => {
  const raw = e.target.dataset.pickArtist;
  if (raw) openArtist(JSON.parse(raw));
});
$('#saved-list').addEventListener('click', e => {
  const open = e.target.dataset.open, del = e.target.dataset.del;
  if (open) openArtist(artistIndex().find(a => a.id === open));
  if (del) {
    const a = artistIndex().find(x => x.id === del);
    if (!confirm(`Delete your ${a.name} ranking and every pick in it? This can't be undone (download a backup first if you might want it).`)) return;
    localStorage.removeItem(dataKey(del));
    localStorage.setItem(INDEX_KEY, JSON.stringify(artistIndex().filter(x => x.id !== del)));
    if (D.artist?.id === del) { D = defaults(); localStorage.removeItem(CURRENT_KEY); renderBrand(); }
    renderHome();
  }
});
$('#share-link').onclick = () => copy(sp.redirectUri(), 'App link copied');

async function scan() {
  show('scan');
  $('#scan-title').textContent = `Digging through ${artistName()}'s catalog…`;
  $('#scan-bar').style.width = '2%';
  try {
    const raw = await dz.fetchCatalog(D.artist, p => {
      const frac = p.total ? p.done / p.total : 0;
      if (p.phase === 'tracks') {
        $('#scan-text').textContent = `Scanning releases: ${p.done} of ${p.total}`;
        $('#scan-sub').textContent = `${p.found} tracks so far · ${p.text}`;
        $('#scan-bar').style.width = (2 + 68 * frac) + '%';
      } else if (p.phase === 'features' && p.total) {
        $('#scan-text').textContent = `Checking features and other releases: ${p.done} of ${p.total}`;
        $('#scan-sub').textContent = `${p.feats} extra songs found · ${p.text}`;
        $('#scan-bar').style.width = (70 + 30 * frac) + '%';
      } else {
        $('#scan-text').textContent = p.text;
        $('#scan-sub').textContent = '';
      }
    });
    D.raw = raw;
    D.scannedAt = new Date().toISOString();
    rebuild();
    save();
    if (D.t) {
      const inT = new Set([...D.t.active, ...D.t.removed]);
      const fresh = includedIds().filter(id => !inT.has(id));
      toast(fresh.length ? `${fresh.length} songs aren't in your tournament yet. Add them from the Songs tab.` : 'No new songs found.');
      show('songs');
    } else show('songs');
  } catch (e) {
    console.error(e);
    $('#scan-text').textContent = 'The scan failed.';
    $('#scan-sub').innerHTML = esc(e.message) + ' <button class="ghost small" id="retry-scan">Try again</button>';
    $('#retry-scan').onclick = scan;
  }
}

// ---------- songs (review before start, manage after) ----------

function renderSongs() {
  const started = !!D.t;
  const q = $('#song-search').value.trim().toLowerCase();
  const inc = new Set(includedIds());
  const active = new Set(D.t?.active || []);
  const removed = new Set(D.t?.removed || []);

  $('#songs-title').textContent = started ? 'Songs in your tournament' : `Your ${artistName()} catalog`;
  const tagged = Object.fromEntries(Object.keys(VERSION_TAGS).map(k => [k, songs.filter(s => s.tag === k).length]));
  $('#songs-summary').textContent = started
    ? `${active.size} songs competing${removed.size ? `, ${removed.size} removed` : ''}.`
    : `${inc.size} songs selected, from ${D.raw.length + D.manual.length} Deezer tracks (duplicates across singles, albums and deluxes are merged). Untick anything you don't want ranked.`;

  $('#version-filters').hidden = started;
  $('#version-filters').innerHTML = Object.entries(VERSION_TAGS).map(([k, v]) =>
    `<label><input type="checkbox" data-tag="${k}" ${D.include[k] ? 'checked' : ''}> ${esc(v.label)} <span class="hint">(${tagged[k]})</span></label>`
  ).join('') + '<p class="hint">Alternate versions to include as their own entries.</p>';

  $('#songs-actions').innerHTML = started ? '' :
    '<button class="ghost small" id="all-on">Select all</button><button class="ghost small" id="all-off">Select none</button>';
  if (!started) {
    $('#all-on').onclick = () => { D.excluded = []; save(); renderSongs(); };
    $('#all-off').onclick = () => { D.excluded = songs.map(s => s.id); save(); renderSongs(); };
  }

  $('#start-panel').hidden = started;
  if (!started) renderStartPanel(inc.size);

  let list = songs;
  if (started) {
    const known = new Set(songs.map(s => s.id));
    const extra = [...active, ...removed].filter(id => !known.has(id)).map(song);
    list = [...songs.filter(s => active.has(s.id) || removed.has(s.id) || inc.has(s.id)), ...extra];
  }
  if (q) list = list.filter(s => (s.name + ' ' + artistLine(s) + ' ' + s.album.name).toLowerCase().includes(q));

  $('#song-list').innerHTML = list.map(s => {
    const badges = [
      s.tag ? `<span class="badge">${esc(VERSION_TAGS[s.tag].label.split(' /')[0].split(' (')[0])}</span>` : '',
      s.alts?.length ? `<span class="badge" title="Also on ${s.alts.length} other release(s); merged">+${s.alts.length} versions</span>` : '',
      s.dupeTitle ? '<span class="badge warn" title="Another song has the same title but a different length">same title</span>' : '',
      s.primary && s.primary !== D.artist.id ? '<span class="badge">feature</span>' : '',
    ].join('');
    let ctl;
    if (!started) ctl = `<input type="checkbox" data-inc="${s.id}" ${inc.has(s.id) ? 'checked' : ''} aria-label="Include ${esc(s.name)}">`;
    else if (active.has(s.id)) ctl = `<button class="ghost small" data-rm="${s.id}">Remove</button>`;
    else ctl = `<button class="ghost small" data-add="${s.id}">${removed.has(s.id) ? 'Add back' : 'Add'}</button>`;
    const off = started ? !active.has(s.id) : !inc.has(s.id);
    return `<li class="${off ? 'off' : ''}">
      <span>${started ? '' : ctl}</span>
      <img src="${esc(s.album.imageSmall || s.album.image)}" alt="" loading="lazy">
      <div class="t-main"><div class="t-name">${esc(s.name)}${badges}</div>
      <div class="t-sub">${esc(artistLine(s))} · ${esc(s.album.name)} · ${year(s)}</div></div>
      <span>${started ? ctl : ''}</span></li>`;
  }).join('') || '<li><span></span><span></span><span class="hint">No songs match.</span></li>';
}

function renderStartPanel(n) {
  const r = $('#rounds'), k = $('#finals-k');
  if (!D.settings.rounds) D.settings.rounds = E.suggestedRounds(n);
  r.value = D.settings.rounds;
  k.max = Math.max(10, Math.min(200, n));
  k.value = Math.min(D.settings.k, n);
  const upd = () => {
    D.settings.rounds = +r.value;
    D.settings.k = +k.value;
    $('#rounds-val').textContent = r.value + (+r.value === E.suggestedRounds(n) ? ' (recommended)' : '');
    $('#k-val').textContent = k.value;
    const est = E.estimatePicks(n, +r.value, +k.value);
    $('#estimate').textContent = `About ${est.total.toLocaleString()} picks: ${est.swiss.toLocaleString()} in the Swiss rounds, roughly ${est.finals} in the finals. Progress saves after every pick, so do it in as many sittings as you like. You can add rounds or extend the finals later.`;
    save();
  };
  r.oninput = k.oninput = upd;
  upd();
  $('#start-btn').disabled = n < 2;
}

$('#version-filters').addEventListener('change', e => {
  const tag = e.target.dataset.tag;
  if (tag) { D.include[tag] = e.target.checked; save(); renderSongs(); }
});
$('#song-list').addEventListener('change', e => {
  const id = e.target.dataset.inc;
  if (!id) return;
  D.excluded = D.excluded.filter(x => x !== id);
  if (!e.target.checked) D.excluded.push(id);
  save();
  renderSongs();
});
$('#song-list').addEventListener('click', e => {
  const rm = e.target.dataset.rm, add = e.target.dataset.add;
  if (rm) { snapshot(); E.removeSong(D.t, rm); save(); renderSongs(); }
  if (add) {
    snapshot();
    D.t.removed = D.t.removed.filter(x => x !== add);
    if (!D.t.active.includes(add)) D.t.active.push(add);
    // A song added after the Swiss stage waits until you start or extend the finals.
    save();
    renderSongs();
    toast(D.t.stage === 'swiss' ? 'Added. It joins from the next round.' : 'Added. It\'s ranked by rating; extend the finals to place it exactly.');
  }
});
$('#song-search').addEventListener('input', () => renderSongs());

$('#add-link-btn').onclick = async () => {
  const m = $('#add-link').value.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?track\/(\d+)/i);
  if (!m) return toast('Paste a link like https://www.deezer.com/track/… (open short links in your browser first to get the full one)', true);
  try {
    const t = await dz.fetchTrack(m[1]);
    if (!t.artists.some(a => a.id === D.artist.id)) toast(`Heads up: Deezer doesn't credit ${artistName()} on "${t.name}". Added anyway.`);
    if (![...D.raw, ...D.manual].some(x => x.id === t.id)) D.manual.push(t);
    D.excluded = D.excluded.filter(x => x !== t.id);
    rebuild();
    save();
    $('#add-link').value = '';
    renderSongs();
    toast(`Added "${t.name}"`);
  } catch (e) { toast(e.message, true); }
};

$('#start-btn').onclick = () => {
  const ids = includedIds();
  if (ids.length < 2) return;
  D.t = E.newTournament(ids, D.settings.rounds);
  undoStack.length = 0;
  save();
  show('play');
};

// ---------- players (30-second Deezer previews) ----------

const players = (() => {
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const P = {};
  for (const side of ['a', 'b']) {
    const el = $('#player-' + side);
    const audio = new Audio();
    audio.preload = 'auto';
    const p = P[side] = { el, audio, id: null, retried: false };
    const tick = () => {
      const d = audio.duration || 30;
      el.querySelector('.pbar > div').style.width = (100 * audio.currentTime / d) + '%';
      el.querySelector('.pclock').textContent = `${fmt(audio.currentTime)} / ${fmt(d)}`;
    };
    audio.addEventListener('timeupdate', tick);
    audio.addEventListener('loadedmetadata', tick);
    audio.addEventListener('play', () => { el.classList.add('playing'); P[side === 'a' ? 'b' : 'a'].audio.pause(); });
    audio.addEventListener('pause', () => el.classList.remove('playing'));
    audio.addEventListener('ended', () => { audio.currentTime = 0; tick(); });
    // Preview links are signed and expire; if one has, swap in a fresh link once.
    audio.addEventListener('error', async () => {
      const id = p.id;
      if (!id || p.retried || !audio.getAttribute('src')) return;
      p.retried = true;
      const url = await dz.previewUrl(id, true).catch(() => '');
      if (p.id !== id) return;
      if (url) { audio.src = url; status(side, 'Preview refreshed, press play again'); }
      else empty(side, 'Preview unavailable');
    });
  }

  function status(side, text) { P[side].el.querySelector('.pstatus').textContent = text; }
  function empty(side, text) { P[side].el.classList.add('empty'); status(side, text); }

  async function set(side, s) {
    const p = P[side];
    p.id = s.id;
    p.retried = false;
    p.audio.pause();
    p.audio.removeAttribute('src');
    p.audio.load();
    p.el.querySelector('.pbar > div').style.width = '0';
    p.el.querySelector('.pclock').textContent = '0:00 / 0:30';
    p.el.querySelector('.dz').href = s.link || dz.trackLink(s.id);
    p.el.querySelector('.sp').href = 'https://open.spotify.com/search/' +
      encodeURIComponent(`${s.name.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')} ${s.artists[0]?.name || ''}`.trim());
    empty(side, 'Loading preview…');
    const url = await dz.previewUrl(s.id).catch(() => '');
    if (p.id !== s.id) return;
    if (!url) return empty(side, 'No preview on Deezer');
    // Set the source ahead of time so a tap can start playback straight away (mobile needs that).
    p.audio.src = url;
    p.el.classList.remove('empty');
    status(side, '');
  }

  return {
    set,
    toggle(side) {
      const a = P[side].audio;
      if (!a.getAttribute('src')) return;
      if (a.paused) a.play().catch(() => status(side, "Couldn't play, try again")); else a.pause();
    },
    seek(side, frac) {
      const a = P[side].audio;
      if (a.getAttribute('src') && a.duration) a.currentTime = frac * a.duration;
    },
    pauseAll() { P.a.audio.pause(); P.b.audio.pause(); },
  };
})();

// ---------- matchups ----------

const undoStack = [];
function snapshot() {
  undoStack.push(JSON.stringify(D.t));
  if (undoStack.length > 300) undoStack.shift();
}
function undo() {
  if (!undoStack.length) return toast('Nothing to undo');
  D.t = JSON.parse(undoStack.pop());
  save();
  renderPlay();
  toast('Undone');
}

let shownPair = null;
function renderPlay() {
  const t = D.t;
  if (!t) return show('songs');
  const pr = E.progress(t);
  $('#stage-label').textContent = pr.label;
  $('#stage-count').textContent = t.stage === 'swiss' ? `${pr.inStage} / ${pr.stageSize} this round`
    : t.stage === 'finals' ? `${pr.inStage} of ${pr.stageSize} placed` : '';
  $('#pick-count').textContent = `${pr.picks.toLocaleString()} picks made` +
    (pr.remainingSwiss != null && t.stage === 'swiss' ? ` · ~${pr.remainingSwiss.toLocaleString()} left in the Swiss stage` : '');
  $('#stage-bar').style.width = (pr.stageSize ? 100 * pr.inStage / pr.stageSize : 100) + '%';

  const m = E.current(t);
  $('#matchup').hidden = $('#controls').hidden = $('#play-hint').hidden = !m;
  $('#interstitial').hidden = !!m;
  if (!m) { shownPair = null; players.pauseAll(); return renderInterstitial(); }

  const rt = E.fitRatings(t);
  for (const side of ['a', 'b']) {
    const s = song(m[side]);
    const el = $(`.side[data-side=${side}]`);
    el.classList.remove('chosen');
    el.querySelector('img').src = s.album.image || '';
    el.querySelector('.name').textContent = s.name;
    el.querySelector('.artists').textContent = artistLine(s);
    el.querySelector('.album').textContent = [s.album.name, year(s)].filter(Boolean).join(' · ');
    const r = rt.get(m[side]);
    el.querySelector('.record').textContent = r && r.games ? `${r.w}–${r.l}${r.t ? '–' + r.t : ''} so far` : 'First matchup';
  }
  $('#tie-btn').disabled = !m.allowTie;
  $('#tie-btn').title = m.allowTie ? '' : 'No ties in the finals';
  $('#skip-btn').disabled = t.stage !== 'swiss';
  $('#undo-btn').disabled = !undoStack.length;
  const key = m.a + m.b;
  if (shownPair !== key) {
    shownPair = key;
    players.set('a', song(m.a));
    players.set('b', song(m.b));
  }
}

function top(n) {
  return E.ranking(D.t).slice(0, n).map(r => `<li>${esc(song(r.id).name)} <span class="hint">${r.w}–${r.l}${r.t ? '–' + r.t : ''}</span></li>`).join('');
}

function renderInterstitial() {
  const t = D.t, box = $('#interstitial');
  if (t.stage === 'swissDone') {
    const n = t.active.length;
    const k = Math.min(D.settings.k, n);
    box.innerHTML = `<h2>Swiss stage done: ${t.swiss.total} rounds</h2>
      <p>Every song has had its shot. Current top 10:</p><ol>${top(10)}</ol>
      <p>Next, the finals: your top songs get sorted exactly, head to head. Results you've already given get reused.</p>
      <div class="row wrap">
        <label>Finals size <input type="number" id="k-in" min="2" max="${n}" value="${k}"></label>
        <button class="primary big" id="go-finals">Start the finals</button>
        <button class="ghost" id="more-round">Play another Swiss round</button>
      </div>`;
    $('#go-finals').onclick = () => {
      const kk = Math.max(2, Math.min(n, +$('#k-in').value || k));
      snapshot();
      D.settings.k = kk;
      E.startFinals(t, kk);
      save();
      renderPlay();
    };
    $('#more-round').onclick = () => { snapshot(); E.addRound(t); save(); renderPlay(); };
  } else if (t.stage === 'done') {
    const rest = t.active.length - t.finals.sorted.length;
    box.innerHTML = `<h2>Ranked.</h2>
      <p>Your exact top ${t.finals.sorted.length}:</p><ol>${top(10)}</ol>
      ${rest > 0 ? `<p class="hint">The other ${rest} songs are ordered by their rating from the Swiss rounds.</p>` : ''}
      <div class="row wrap">
        <button class="primary big" id="to-rank">See the full ranking &amp; export</button>
        ${rest > 0 ? `<button class="ghost" id="extend">Sort the next 25 exactly too</button>` : ''}
      </div>`;
    $('#to-rank').onclick = () => show('rank');
    if (rest > 0) $('#extend').onclick = () => { snapshot(); E.extendFinals(t, 25); save(); renderPlay(); };
  }
}

function choose(w) {
  const m = D.t && E.current(D.t);
  if (!m || view !== 'play') return;
  if (w === 't' && !m.allowTie) return toast('No ties in the finals. Gut call!');
  snapshot();
  if (w !== 't') $(`.side[data-side=${w}]`).classList.add('chosen');
  E.pick(D.t, w);
  save();
  setTimeout(renderPlay, w === 't' ? 0 : 120);
}

$('#matchup').addEventListener('click', e => {
  const play = e.target.closest('[data-play]')?.dataset.play;
  if (play) return players.toggle(play);
  const bar = e.target.closest('[data-seek]');
  if (bar) {
    const r = bar.getBoundingClientRect();
    return players.seek(bar.dataset.seek, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  }
  const p = e.target.closest('[data-pick]')?.dataset.pick;
  if (p) return choose(p);
  const r = e.target.closest('[data-remove]')?.dataset.remove;
  if (r) {
    const id = E.current(D.t)?.[r];
    if (!id || !confirm(`Remove "${song(id).name}" from the ranking? You can add it back from the Songs tab.`)) return;
    snapshot();
    E.removeSong(D.t, id);
    save();
    renderPlay();
  }
});
$('#tie-btn').onclick = () => choose('t');
$('#skip-btn').onclick = () => { snapshot(); E.skip(D.t); save(); renderPlay(); };
$('#undo-btn').onclick = undo;

document.addEventListener('keydown', e => {
  if (view !== 'play' || e.target.matches?.('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const act = {
    arrowleft: () => choose('a'), 1: () => choose('a'),
    arrowright: () => choose('b'), 2: () => choose('b'),
    arrowdown: () => choose('t'), t: () => choose('t'),
    s: () => $('#skip-btn').click(),
    z: undo, backspace: undo,
    a: () => players.toggle('a'), d: () => players.toggle('b'),
  }[k];
  if (act) { e.preventDefault(); act(); }
});

// ---------- rankings & export ----------

function renderRank() {
  const t = D.t;
  if (!t) return;
  const rows = E.ranking(t);
  const q = $('#rank-search').value.trim().toLowerCase();
  const locked = rows.filter(r => r.locked).length;
  $('#rank-summary').textContent = `${rows.length} songs · ${t.matches.length.toLocaleString()} picks made` +
    (locked ? ` · top ${locked} sorted exactly (gold numbers)` : ' · ordered by rating so far') +
    (t.stage !== 'done' ? '. Still in progress; you can export any time.' : '.');
  $('#sp-connect').hidden = sp.isLoggedIn();
  $('#sp-save').hidden = !sp.isLoggedIn();
  if (!$('#pl-name').value || $('#pl-name').dataset.artist !== D.artist.id) {
    $('#pl-name').value = `${artistName()}: Every Song Ranked`;
    $('#pl-name').dataset.artist = D.artist.id;
    $('#pl-count').value = Math.min(rows.length, 50);
  }
  $('#pl-count').max = rows.length;
  $('#pl-status').innerHTML = '';
  delete $('#pl-status').dataset.set;
  $('#save-pl').textContent = D.playlist ? 'Update my playlist' : 'Save as playlist';
  if (D.playlist && !$('#pl-status').dataset.set) $('#pl-status').innerHTML = `Last saved: <a href="${esc(D.playlist.url)}" target="_blank" rel="noopener">open playlist</a>. Saving again overwrites it with the current order.`;
  $('#rank-list').innerHTML = rows.map((r, i) => {
    const s = song(r.id);
    if (q && !(s.name + ' ' + artistLine(s)).toLowerCase().includes(q)) return '';
    return `<li class="${r.locked ? 'locked' : ''}">
      <span class="pos">${i + 1}</span>
      <img src="${esc(s.album.imageSmall || s.album.image)}" alt="" loading="lazy">
      <div class="t-main"><div class="t-name">${esc(s.name)}</div><div class="t-sub">${esc(artistLine(s))} · ${esc(s.album.name)} · ${year(s)}</div></div>
      <span class="stat">${r.w}–${r.l}${r.t ? '–' + r.t : ''} · ${r.rating}${r.locked ? ' <span class="lock" title="Placed exactly in the finals">🔒</span>' : ''}</span>
    </li>`;
  }).join('');
}
$('#rank-search').addEventListener('input', renderRank);

$('#sp-connect-btn').onclick = () => { renderConnect(); show('connect'); };

// Each song is looked up on Spotify once (by ISRC) and remembered, so re-saving only costs the new ones.
$('#save-pl').onclick = async () => {
  const btn = $('#save-pl'), status = $('#pl-status');
  btn.disabled = true;
  status.dataset.set = '1';
  try {
    const rows = E.ranking(D.t);
    const n = Math.max(1, Math.min(rows.length, Math.floor(+$('#pl-count').value) || rows.length));
    const picked = rows.slice(0, n).map(r => song(r.id));
    D.spotify ||= {};
    const todo = picked.filter(s => !(s.id in D.spotify));
    for (const [i, s] of todo.entries()) {
      status.textContent = `Finding songs on Spotify: ${i + 1} of ${todo.length}…`;
      D.spotify[s.id] = await sp.matchTrack(s);
      if (i % 10 === 9) save();
    }
    save();
    const uris = picked.map(s => D.spotify[s.id]).filter(Boolean);
    const missing = picked.filter(s => !D.spotify[s.id]);
    if (!uris.length) throw new Error("None of those songs could be found on Spotify");
    status.textContent = 'Saving to Spotify…';
    const res = await sp.savePlaylist({
      playlistId: D.playlist?.id,
      name: $('#pl-name').value.trim() || `${artistName()}: Every Song Ranked`,
      description: `${artistName()} songs, ranked head to head: top ${n} of ${rows.length}, ${D.t.matches.length} picks. Updated ${new Date().toLocaleDateString()}.`,
      uris,
    });
    D.playlist = res;
    save();
    status.innerHTML = `Saved ${uris.length} songs in order. <a href="${esc(res.url)}" target="_blank" rel="noopener">Open in Spotify</a>` +
      (missing.length ? ` Not found on Spotify (${missing.length}): ${esc(missing.slice(0, 5).map(s => s.name).join(', '))}${missing.length > 5 ? '…' : ''}.` : '');
    btn.textContent = 'Update my playlist';
  } catch (e) {
    console.error(e);
    save();
    status.textContent = sentence(e.message) + ' Songs already found on Spotify are remembered, so trying again carries on from there.';
  } finally { btn.disabled = false; }
};
$('#copy-text').onclick = () => copy(
  E.ranking(D.t).map((r, i) => `${i + 1}. ${song(r.id).name} - ${artistLine(song(r.id))}`).join('\n'),
  'Copied your ranking as text');
$('#copy-links').onclick = () => copy(E.ranking(D.t).map(r => song(r.id).link || dz.trackLink(r.id)).join('\n'), 'Copied Deezer links');
$('#dl-csv').onclick = () => {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['rank', 'song', 'artists', 'album', 'year', 'rating', 'wins', 'losses', 'ties', 'exact', 'isrc', 'link'].join(',')];
  E.ranking(D.t).forEach((r, i) => {
    const s = song(r.id);
    lines.push([i + 1, q(s.name), q(artistLine(s)), q(s.album.name), year(s), r.rating, r.w, r.l, r.t, r.locked ? 'yes' : 'no', s.isrc || '', s.link || dz.trackLink(r.id)].join(','));
  });
  download(`${slug()}-ranking.csv`, lines.join('\n'), 'text/csv');
};

// ---------- backup ----------

const slug = () => artistName().toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artist';

function guessArtist(raw) {
  const count = new Map();
  for (const t of raw) for (const a of t.artists) count.set(a.id, [(count.get(a.id)?.[0] || 0) + 1, a.name]);
  const [id, [, name]] = [...count].sort((x, y) => y[1][0] - x[1][0])[0];
  const img = raw.find(t => t.artists[0]?.id === id)?.album.image || '';
  return { id, name, image: img };
}

function renderBackup() {
  $('#catalog-info').textContent = D.scannedAt
    ? `${songs.length} songs from ${D.raw.length} tracks, last scanned ${new Date(D.scannedAt).toLocaleString()}.`
    : 'Not scanned yet.';
  $('#logout').textContent = sp.isLoggedIn() ? 'Log out of Spotify' : 'Connect Spotify (for playlist export)';
}
$('#export-json').onclick = () => download(`${slug()}-ranker-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(D), 'application/json');
$('#import-json').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.raw)) throw new Error('Not a Ranker backup');
    if (data.source !== 'deezer') throw new Error('that backup is from the Spotify version of Artist Ranker, so restore it there');
    // Older single-artist backups don't say whose they are: take the most-credited artist.
    if (!data.artist) data.artist = guessArtist(data.raw);
    D = { ...defaults(), ...data };
    rebuild();
    undoStack.length = 0;
    save();
    renderBrand();
    toast(`Restored your ${artistName()} ranking`);
    show(D.t ? 'play' : 'songs');
  } catch (err) { toast('Could not read that file: ' + err.message, true); }
  e.target.value = '';
};
$('#rescan').onclick = () => scan();
$('#logout').onclick = () => {
  if (sp.isLoggedIn()) { sp.logout(); toast('Logged out'); renderBackup(); return; }
  renderConnect();
  show('connect');
};
$('#reset').onclick = () => {
  if (!confirm('Reset the tournament and lose every pick?')) return;
  D.t = null;
  undoStack.length = 0;
  save();
  show('songs');
};

for (const b of $$('#tabs button')) b.onclick = () => show(b.dataset.view);

// ---------- boot ----------

async function boot() {
  // Spotify only accepts loopback redirects as an IP, so keep everyone on 127.0.0.1.
  if (location.hostname === 'localhost') return location.replace(location.href.replace('//localhost', '//127.0.0.1'));
  let connected = false;
  try { connected = await sp.handleRedirect(); }
  catch (e) { toast(e.message, true); }
  const cur = localStorage.getItem(CURRENT_KEY);
  const known = cur && artistIndex().find(a => a.id === cur);
  if (known) D = load(cur);
  rebuild();
  renderBrand();
  if (!known) return show('home');
  if (!D.raw.length) return scan();
  if (connected && D.t) { toast('Spotify connected. You can save your playlist now.'); return show('rank'); }
  show(D.t ? 'play' : 'songs');
}
boot();

// Exposed for debugging in the console.
window.artistRanker = { get data() { return D; }, E, rebuild, show };
