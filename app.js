'use strict';

// Common omamori purposes: [Japanese, English]. The form also allows free text.
const PURPOSES = [
  ['交通安全', 'Traffic safety'],
  ['学業成就', 'Academic success'],
  ['合格祈願', 'Passing exams'],
  ['縁結び', 'Matchmaking / good relationships'],
  ['恋愛成就', 'Success in love'],
  ['家内安全', 'Safety of the household'],
  ['健康祈願', 'Good health'],
  ['健康長寿', 'Good health and long life'],
  ['無病息災', 'Freedom from illness and misfortune'],
  ['身体健全', 'Sound body and health'],
  ['病気平癒', 'Recovery from illness'],
  ['厄除け', 'Warding off misfortune'],
  ['八方除け', 'Protection from all directions'],
  ['開運', 'Good luck'],
  ['商売繁盛', 'Business prosperity'],
  ['金運', 'Wealth'],
  ['仕事運', 'Success at work'],
  ['安産', 'Safe childbirth'],
  ['子宝', 'Blessing of children'],
  ['旅行安全', 'Safe travel'],
  ['必勝', 'Victory'],
  ['芸能上達', 'Progress in the arts'],
  ['心願成就', 'Wishes come true'],
];

// The question for "Ask Claude". The fixed reply layout lets the app read the answer back in later.
const CLAUDE_QUESTION = `These photos show the front and back of a Japanese omamori (a charm from a shrine or temple). Please read all the writing on it, including any embroidered text, and identify the shrine or temple.

Reply in plain text (no bold, headings or bullet points), starting with exactly these lines:

Shrine or temple (Japanese):
Shrine or temple (English):
Location:
Purpose (Japanese):
Purpose (English):
Design:
Notes:

Shrine or temple (English) is the romanised name, e.g. Fushimi Inari Taisha. Location is the city or ward and prefecture. Purpose (Japanese) is the purpose as written on the omamori, e.g. 交通安全. Design is a short description of the design and how it relates to the protection the omamori offers. Notes is anything else worth recording. If you are guessing, add "(guess)". If you can't tell, leave it blank. You can add more after these lines if you like.`;

const view = document.getElementById('view');
let routeId = 0;        // goes up on every screen change, so slow screens can tell they're out of date
let objectUrls = [];    // photo URLs for the current screen, released when leaving it
let formDirty = false;  // true while the add/edit form has unsaved changes
let listSearch = '';    // remembered so the search survives opening an entry and coming back
let pendingAnswer = ''; // Claude's reply read from the clipboard, waiting for the fill screen

// ---------- Small helpers ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function storedUrl(stored) {
  return blobUrl(Images.toBlob(stored));
}

function setHeader(title, left = '', right = '') {
  document.getElementById('title').textContent = title;
  document.getElementById('topbar-left').innerHTML = left;
  document.getElementById('topbar-right').innerHTML = right;
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2500);
}

function newId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function purposeLabel(purpose) {
  const preset = PURPOSES.find(([ja]) => ja === purpose);
  return preset ? `${preset[0]} · ${preset[1]}` : purpose;
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function displayName(rec) {
  return rec.nameJa || rec.nameEn || 'Untitled omamori';
}

function photoFile(rec, photo, side) {
  const name = (rec.nameEn || rec.nameJa || '').replace(/[\\/:*?"<>|]+/g, '').trim() || 'omamori';
  return new File([photo.data], `${name} ${side}.jpg`, { type: photo.type });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// Asks the browser not to clear our storage when the device is low on space.
function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}

function getLastBackup() {
  try { return localStorage.getItem('lastBackupAt'); } catch { return null; }
}

function setLastBackup() {
  try { localStorage.setItem('lastBackupAt', new Date().toISOString()); } catch { /* not important */ }
}

// ---------- Pasting text (from iOS Live Text) ----------

// Live Text often adds line breaks, and spaces between Japanese characters.
// Single-line fields get everything joined onto one line; notes keep their lines.
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々〆〇';
const CJK_GAP = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'gu');

function tidyText(text, multiline) {
  const t = text.replace(/\r\n?/g, '\n');
  if (!multiline) return t.replace(/\s+/g, ' ').replace(CJK_GAP, '$1').trim();
  return t.split('\n')
    .map(line => line.replace(/[ \t　]+/g, ' ').replace(CJK_GAP, '$1').trim())
    .join('\n')
    .trim();
}

function insertText(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function pasteInto(el) {
  if (!navigator.clipboard?.readText) {
    alert('Tap and hold inside the box, then choose Paste.');
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { toast('Nothing to paste'); return; }
    insertText(el, tidyText(text, el.tagName === 'TEXTAREA'));
  } catch {
    alert('Could not paste. Tap and hold inside the box, then choose Paste.');
  }
}

// ---------- Screens ----------

async function route() {
  const id = ++routeId;
  objectUrls.forEach(url => URL.revokeObjectURL(url));
  objectUrls = [];
  formDirty = false;
  window.scrollTo(0, 0);

  const [page, param] = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (page === 'add') await showForm(null);
    else if (page === 'edit') await showForm(param);
    else if (page === 'item') await showDetail(param);
    else if (page === 'fill') await showFill(param);
    else if (page === 'backup') await showBackup();
    else await showList();
  } catch (err) {
    console.error(err);
    if (id !== routeId) return;
    setHeader('Omamori', '<a class="hbtn" href="#/">‹ All</a>');
    view.innerHTML = `<p class="message">Something went wrong: ${esc(err.message)}</p>`;
  }
}

function showNotFound() {
  setHeader('Not found', '<a class="hbtn" href="#/">‹ All</a>');
  view.innerHTML = '<p class="message">This omamori could not be found. It may have been deleted.</p>';
}

// --- List ---

async function showList() {
  const myRoute = routeId;
  setHeader('Omamori',
    '<a class="hbtn" href="#/backup">Backup</a>',
    '<a class="hbtn strong" href="#/add">+ Add</a>');

  const records = await DB.allRecords();
  if (myRoute !== routeId) return;

  // Newest acquired first; entries without a date go by when they were added.
  records.sort((a, b) => (b.dateAcquired || b.createdAt || '').localeCompare(a.dateAcquired || a.createdAt || ''));

  const thumbs = new Map(records.filter(r => r.thumb).map(r => [r.id, storedUrl(r.thumb)]));

  view.innerHTML = `
    ${records.length ? `<input type="search" id="search" class="search" placeholder="Search ${records.length} omamori" autocomplete="off" lang="ja">` : ''}
    <div id="grid" class="grid"></div>
    <p class="version">Omamori Collection · version ${esc(APP_VERSION)}</p>`;

  const grid = document.getElementById('grid');
  const search = document.getElementById('search');

  function render() {
    const q = listSearch.trim().toLowerCase();
    const shown = q
      ? records.filter(r => [r.nameJa, r.nameEn, r.location, r.purpose, purposeLabel(r.purpose || ''), r.notes]
          .some(v => (v || '').toLowerCase().includes(q)))
      : records;

    if (!records.length) {
      grid.innerHTML = '<p class="message">No omamori yet.<br>Tap <strong>+ Add</strong> to record your first one.</p>';
      return;
    }
    if (!shown.length) {
      grid.innerHTML = '<p class="message">Nothing matches your search.</p>';
      return;
    }
    grid.innerHTML = shown.map(r => `
      <a class="card" href="#/item/${esc(r.id)}">
        <div class="thumb">${thumbs.has(r.id) ? `<img src="${thumbs.get(r.id)}" alt="">` : '<span class="nophoto" lang="ja">守</span>'}</div>
        <div class="card-body" lang="ja">
          <div class="name-ja">${esc(r.nameJa || r.nameEn || 'Untitled')}</div>
          ${r.nameJa && r.nameEn ? `<div class="name-en">${esc(r.nameEn)}</div>` : ''}
          <div class="meta">${esc([r.purpose, formatDate(r.dateAcquired)].filter(Boolean).join(' · '))}</div>
        </div>
      </a>`).join('');
  }

  if (search) {
    search.value = listSearch;
    search.addEventListener('input', () => { listSearch = search.value; render(); });
  }
  render();
}

// --- Detail ---

async function showDetail(id) {
  const myRoute = routeId;
  const rec = await DB.getRecord(id);
  if (myRoute !== routeId) return;
  if (!rec) return showNotFound();

  const [front, back] = await Promise.all([DB.getPhoto(id, 'front'), DB.getPhoto(id, 'back')]);
  if (myRoute !== routeId) return;

  setHeader(displayName(rec),
    '<a class="hbtn" href="#/">‹ All</a>',
    `<a class="hbtn strong" href="#/edit/${esc(id)}">Edit</a>`);

  const figure = (photo, label) => photo
    ? `<div>
        <figure class="photo"><img src="${storedUrl(photo)}" alt="${label}"><figcaption>${label}</figcaption></figure>
        <button type="button" class="mini save-photo" data-side="${label.toLowerCase()}">Save ${label.toLowerCase()} photo</button>
      </div>`
    : `<div><figure class="photo empty"><span>No ${label.toLowerCase()} photo</span></figure></div>`;

  const rows = [
    ['Location', rec.location],
    ['Purpose', rec.purpose && purposeLabel(rec.purpose)],
    ['Date acquired', formatDate(rec.dateAcquired)],
    ['Notes', rec.notes],
  ].filter(([, value]) => value);

  view.innerHTML = `
    <div class="photos">${figure(front, 'Front')}${figure(back, 'Back')}</div>
    <div class="detail" lang="ja">
      <h2>${esc(displayName(rec))}</h2>
      ${rec.nameJa && rec.nameEn ? `<p class="subtitle">${esc(rec.nameEn)}</p>` : ''}
      <dl>${rows.map(([label, value]) => `<dt lang="en">${label}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
    </div>
    ${front || back ? `
      <button type="button" class="button" id="ask-claude">Ask Claude about this omamori</button>
      <p class="muted help">Copies a question and opens the Share sheet with the photos.
        Choose <strong>Claude</strong>, paste the question into the message, and send.</p>
      <button type="button" class="button" id="fill-claude">Fill in from Claude’s answer</button>
      <p class="muted help">In the Claude app, press and hold the reply and tap <strong>Copy</strong>, then come back and tap this.</p>` : ''}
    <button type="button" class="button danger" id="delete">Delete this omamori</button>`;

  const photoImgs = [...view.querySelectorAll('.photo img')];
  const viewerPhotos = photoImgs.map(img => ({ src: img.src, label: img.alt }));
  photoImgs.forEach((img, i) => img.addEventListener('click', () => Viewer.open(viewerPhotos, i)));

  // Opens the Share sheet, where "Save Image" puts the photo in the Photos library.
  const photos = { front, back };
  view.querySelectorAll('.save-photo').forEach(btn => btn.addEventListener('click', () => {
    shareFile(photoFile(rec, photos[btn.dataset.side], btn.dataset.side));
  }));

  document.getElementById('ask-claude')?.addEventListener('click', () => {
    const files = ['front', 'back'].filter(side => photos[side]).map(side => photoFile(rec, photos[side], side));
    if (!navigator.canShare?.({ files })) {
      alert('This device can’t share photos from here. Use “Save photo” instead, then add the photos in the Claude app.');
      return;
    }
    // Both start straight away (not one after the other), because iOS only allows them right after a tap.
    navigator.clipboard?.writeText(CLAUDE_QUESTION).catch(() => {
      alert('The question couldn’t be copied, so you’ll need to type your own in Claude.');
    });
    navigator.share({ files }).catch(err => {
      if (err.name !== 'AbortError') alert('Could not open the Share sheet: ' + err.message);
    });
  });

  document.getElementById('fill-claude')?.addEventListener('click', async () => {
    // Read the clipboard now, while it still counts as a tap; the fill screen picks it up.
    try {
      pendingAnswer = await navigator.clipboard.readText();
    } catch {
      pendingAnswer = '';
    }
    location.hash = '#/fill/' + id;
  });

  document.getElementById('delete').addEventListener('click', async () => {
    if (!confirm(`Delete “${displayName(rec)}”?\n\nThis can’t be undone (unless you have a backup).`)) return;
    await DB.remove(id);
    toast('Deleted');
    location.replace('#/');
  });
}

// --- Fill in from Claude's answer ---

// The labels in Claude's reply (see CLAUDE_QUESTION), lower-case letters only.
// Replies to the older question say "Shrine" rather than "Shrine or temple".
const ANSWER_FIELDS = {
  shrinejapanese: 'nameJa',
  shrineenglish: 'nameEn',
  shrineortemplejapanese: 'nameJa',
  shrineortempleenglish: 'nameEn',
  location: 'location',
  purposejapanese: 'purposeJa',
  purposeenglish: 'purposeEn',
  design: 'design',
  notes: 'notes',
};

// Reads the "Label: value" lines from Claude's reply. A value can carry on
// over the following lines, up to a blank line or the next label.
function parseClaudeAnswer(text) {
  const found = {};
  let current = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\*\*|__/g, '').trim();
    const match = /^[-*•#>\s]*([A-Za-z][A-Za-z ()]*?)\s*[:：]\s*(.*)$/.exec(line);
    const key = match && ANSWER_FIELDS[match[1].toLowerCase().replace(/[^a-z]/g, '')];
    if (key) {
      found[key] = match[2].trim();
      current = key;
    } else if (!line) {
      current = null;
    } else if (current) {
      found[current] = (found[current] + ' ' + line).trim();
    }
  }
  return found;
}

// The changes Claude's answer would make to a record, leaving out anything already there.
function suggestionsFrom(answer, rec) {
  const purposeJa = answer.purposeJa || '';
  const purpose = PURPOSES.some(([ja]) => ja === purposeJa)
    ? purposeJa
    : [purposeJa, answer.purposeEn].filter(Boolean).join(' · ');
  const notes = [answer.design && 'Design: ' + answer.design, answer.notes].filter(Boolean).join('\n\n');

  return [
    { key: 'nameJa', label: 'Shrine or temple (Japanese)', value: answer.nameJa },
    { key: 'nameEn', label: 'Shrine or temple (English)', value: answer.nameEn },
    { key: 'location', label: 'Location', value: answer.location },
    { key: 'purpose', label: 'Purpose', value: purpose },
    { key: 'notes', label: 'Notes', value: notes, append: true },
  ].filter(s => s.value && s.value !== (rec[s.key] || '') && !(s.append && (rec.notes || '').includes(s.value)));
}

async function showFill(id) {
  const myRoute = routeId;
  const rec = await DB.getRecord(id);
  if (myRoute !== routeId) return;
  if (!rec) return showNotFound();

  setHeader('Claude’s answer',
    '<button type="button" class="hbtn" id="cancel">Cancel</button>',
    '<button type="button" class="hbtn strong" id="apply-top">Apply</button>');

  view.innerHTML = `
    <div class="field">
      <div class="label-row">
        <label for="answer">Claude’s answer</label>
        <span class="tools"><button type="button" class="mini" id="paste-answer">Paste</button></span>
      </div>
      <textarea id="answer" rows="4" lang="ja" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
    </div>
    <div id="review"></div>
    <button type="button" class="button primary" id="apply">Apply</button>`;

  const answerBox = document.getElementById('answer');
  const review = document.getElementById('review');
  const applyBtn = document.getElementById('apply');
  let suggestions = [];

  answerBox.value = pendingAnswer;
  pendingAnswer = '';

  function updateApply() {
    const count = review.querySelectorAll('input:checked').length;
    applyBtn.disabled = !count;
    applyBtn.textContent = count ? `Apply ${count} change${count > 1 ? 's' : ''}` : 'Apply';
  }

  function render() {
    const answer = parseClaudeAnswer(answerBox.value);
    suggestions = suggestionsFrom(answer, rec);

    if (!answerBox.value.trim()) {
      review.innerHTML = '<p class="muted help">In the Claude app, press and hold the reply, tap <strong>Copy</strong>, then tap <strong>Paste</strong> above.</p>';
    } else if (Object.keys(answer).length < 2) {
      review.innerHTML = '<p class="muted help">This doesn’t look like a reply to the Ask Claude question. Check you copied Claude’s whole reply.</p>';
    } else if (!suggestions.length) {
      review.innerHTML = '<p class="muted help">Nothing new: this omamori already has everything in the answer.</p>';
    } else {
      review.innerHTML = `
        <p class="muted help">Tick the changes you want. Fields you’ve already filled in start unticked.</p>
        ${suggestions.map(s => `
          <label class="fill-row">
            <input type="checkbox" data-key="${s.key}" ${s.append || !rec[s.key] ? 'checked' : ''}>
            <span class="fill-text">
              <span class="fill-label">${s.label}</span>
              <span class="fill-old" lang="ja">${s.append
                ? (rec.notes ? 'Added after your notes' : 'Now: empty')
                : `Now: ${rec[s.key] ? esc(s.key === 'purpose' ? purposeLabel(rec.purpose) : rec[s.key]) : 'empty'}`}</span>
              <span class="fill-new" lang="ja">${esc(s.key === 'purpose' ? purposeLabel(s.value) : s.value)}</span>
            </span>
          </label>`).join('')}`;
    }
    updateApply();
  }

  answerBox.addEventListener('input', render);
  review.addEventListener('change', updateApply);

  document.getElementById('paste-answer').addEventListener('click', async () => {
    try {
      answerBox.value = await navigator.clipboard.readText();
      render();
    } catch {
      alert('Could not paste. Tap and hold inside the box, then choose Paste.');
    }
  });

  document.getElementById('cancel').addEventListener('click', () => location.replace('#/item/' + id));
  document.getElementById('apply-top').addEventListener('click', () => applyBtn.click());

  applyBtn.addEventListener('click', async () => {
    const chosen = new Set([...review.querySelectorAll('input:checked')].map(box => box.dataset.key));
    if (!chosen.size) return;
    applyBtn.disabled = true;
    const updated = { ...rec, updatedAt: new Date().toISOString() };
    for (const s of suggestions) {
      if (!chosen.has(s.key)) continue;
      updated[s.key] = s.append && rec.notes ? rec.notes + '\n\n' + s.value : s.value;
    }
    try {
      await DB.save(updated);
      toast('Updated');
      location.replace('#/item/' + id);
    } catch (err) {
      alert('Could not save: ' + err.message);
      applyBtn.disabled = false;
    }
  });

  render();
}

// --- Full-screen photo viewer ---
// Swipe sideways for the other side of the omamori. Pinch or double-tap to
// zoom, drag to move around. A finger held still is left alone, so iOS's
// press-and-hold menu for images still works.
const Viewer = (() => {
  const el = document.getElementById('viewer');
  const stage = el.querySelector('.viewer-stage');
  const img = stage.querySelector('img');
  const label = el.querySelector('.viewer-label');
  const hint = el.querySelector('.viewer-hint');
  const MAX_SCALE = 6;
  const HOLD_MS = 350;      // held this long before moving = press-and-hold, not a drag
  const SWIPE_PX = 60;      // how far a swipe must go to change photo
  const pointers = new Map();
  let photos = [];          // [{ src, label }]
  let index = 0;
  let scale = 1, x = 0, y = 0;
  let swipeX = 0;           // how far the current swipe has moved the photo
  let pinch = null;
  let lastTap = 0;

  function apply() {
    img.style.transform = `translate(${x + swipeX}px, ${y}px) scale(${scale})`;
  }

  function show(i) {
    index = (i + photos.length) % photos.length;
    scale = 1; x = 0; y = 0; swipeX = 0;
    img.classList.remove('animate');
    apply();
    img.src = photos[index].src;
    label.textContent = `${photos[index].label} · ${index + 1} of ${photos.length}`;
    label.hidden = photos.length < 2;
    hint.textContent = (photos.length > 1 ? 'Swipe for the other side · ' : '') + 'Pinch or double-tap to zoom';
  }

  // Don't let the photo be dragged off screen.
  function clamp() {
    if (scale <= 1) { scale = 1; x = 0; y = 0; return; }
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    x = Math.min(maxX, Math.max(-maxX, x));
    y = Math.min(maxY, Math.max(-maxY, y));
  }

  // Position of a screen point relative to the middle of the viewer.
  function fromCentre(px, py) {
    const r = stage.getBoundingClientRect();
    return [px - (r.left + r.width / 2), py - (r.top + r.height / 2)];
  }

  // Zoom to newScale while keeping the point (fx, fy) in the same place.
  function zoomAround(fx, fy, fromScale, fromX, fromY, newScale) {
    x = fx - (fx - fromX) * (newScale / fromScale);
    y = fy - (fy - fromY) * (newScale / fromScale);
    scale = newScale;
  }

  function twoFingers() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  stage.addEventListener('pointerdown', e => {
    img.classList.remove('animate');
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, time: Date.now(), moved: false });
    if (pointers.size === 2) {
      pointers.forEach(p => { p.moved = true; });
      swipeX = 0;
      pinch = { ...twoFingers(), scale, x, y };
    }
  });

  stage.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (pinch && pointers.size === 2) {
      const now = twoFingers();
      const [fx, fy] = fromCentre(pinch.midX, pinch.midY);
      zoomAround(fx, fy, pinch.scale, pinch.x, pinch.y, Math.min(MAX_SCALE, Math.max(1, pinch.scale * now.dist / pinch.dist)));
      x += now.midX - pinch.midX;
      y += now.midY - pinch.midY;
      clamp();
      apply();
      return;
    }

    if (!p.moved) {
      if (Math.hypot(p.x - p.startX, p.y - p.startY) < 8) return;
      if (Date.now() - p.time > HOLD_MS) { pointers.delete(e.pointerId); return; } // selecting text
      p.moved = true;
    }
    if (scale > 1) {
      x += dx;
      y += dy;
      clamp();
      apply();
    } else if (photos.length > 1) {
      swipeX = p.x - p.startX; // the photo follows the finger
      apply();
    }
  });

  function release(e) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;

    // End of a swipe: change photo if it went far enough sideways, otherwise slide back.
    if (swipeX && !pointers.size) {
      const sideways = p && Math.abs(swipeX) > Math.abs(p.y - p.startY);
      if (e.type === 'pointerup' && sideways && Math.abs(swipeX) > SWIPE_PX) {
        show(index + (swipeX < 0 ? 1 : -1));
      } else {
        swipeX = 0;
        img.classList.add('animate');
        apply();
      }
      return;
    }

    // Double tap: zoom in on that spot, or back out.
    if (e.type !== 'pointerup' || !p || p.moved || pointers.size || Date.now() - p.time > 300) return;
    const now = Date.now();
    if (now - lastTap > 300) { lastTap = now; return; }
    lastTap = 0;
    img.classList.add('animate');
    if (scale > 1) {
      scale = 1;
    } else {
      const [fx, fy] = fromCentre(e.clientX, e.clientY);
      zoomAround(fx, fy, 1, 0, 0, 2.5);
    }
    clamp();
    apply();
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // Stops iPhone Safari zooming the whole page instead of the photo.
  stage.addEventListener('gesturestart', e => e.preventDefault());

  function close() {
    el.hidden = true;
    img.removeAttribute('src');
  }
  el.querySelector('.viewer-close').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) close(); });

  return {
    // list: [{ src, label }]; start: which one to show first
    open(list, start = 0) {
      photos = list;
      pointers.clear();
      pinch = null;
      show(start);
      el.hidden = false;
    },
  };
})();

// --- Add / edit form ---

function textField(id, label, { multiline = false, placeholder = '' } = {}) {
  const attrs = `id="${id}" lang="ja" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${esc(placeholder)}"`;
  return `
    <div class="field">
      <div class="label-row">
        <label for="${id}">${label}</label>
        <span class="tools">
          <button type="button" class="mini" data-paste="${id}">Paste</button>
          <button type="button" class="mini" data-clear="${id}" aria-label="Clear ${label}">Clear</button>
        </span>
      </div>
      ${multiline ? `<textarea ${attrs} rows="5"></textarea>` : `<input type="text" ${attrs}>`}
    </div>`;
}

async function showForm(id) {
  const myRoute = routeId;
  const editing = Boolean(id);
  const rec = editing ? await DB.getRecord(id) : null;
  if (myRoute !== routeId) return;
  if (editing && !rec) return showNotFound();

  // For each side: the current photo (a Blob, or null) and whether it was changed.
  const photos = { front: { blob: null, changed: false }, back: { blob: null, changed: false } };
  if (editing) {
    const [front, back] = await Promise.all([DB.getPhoto(id, 'front'), DB.getPhoto(id, 'back')]);
    if (myRoute !== routeId) return;
    photos.front.blob = front && Images.toBlob(front);
    photos.back.blob = back && Images.toBlob(back);
  }

  setHeader(editing ? 'Edit' : 'New omamori',
    '<button type="button" class="hbtn" id="cancel">Cancel</button>',
    '<button type="button" class="hbtn strong" id="save-top">Save</button>');

  view.innerHTML = `
    <form id="form" class="form" novalidate>
      <div class="pickers">
        ${['front', 'back'].map(side => `
          <div class="picker" data-side="${side}">
            <label class="picker-box">
              <img alt="" hidden>
              <span class="picker-hint">+ ${side === 'front' ? 'Front' : 'Back'} photo</span>
              <input type="file" accept="image/*" class="visually-hidden">
            </label>
            <div class="picker-actions">
              <button type="button" class="linkbtn" data-view hidden aria-label="View ${side} photo full screen">View</button>
              <button type="button" class="linkbtn danger" data-remove hidden aria-label="Remove ${side} photo">Remove</button>
            </div>
          </div>`).join('')}
      </div>

      ${textField('nameJa', 'Shrine or temple name (Japanese)', { placeholder: '例: 伏見稲荷大社' })}
      ${textField('nameEn', 'Shrine or temple name (English / romanised)', { placeholder: 'e.g. Fushimi Inari Taisha' })}
      ${textField('location', 'Location', { placeholder: 'e.g. Fushimi-ku, Kyoto' })}

      <div class="field">
        <div class="label-row"><label for="purposeSelect">Purpose</label></div>
        <select id="purposeSelect">
          <option value="">— Not set —</option>
          ${PURPOSES.map(([ja, en]) => `<option value="${ja}">${ja} · ${en}</option>`).join('')}
          <option value="__other">Other (type your own)…</option>
        </select>
      </div>
      <div id="purposeOtherField" hidden>
        ${textField('purposeOther', 'Purpose (your own words)', { placeholder: 'e.g. 諸願成就' })}
      </div>

      <div class="field">
        <div class="label-row">
          <label for="dateAcquired">Date acquired</label>
          <span class="tools"><button type="button" class="mini" data-clear="dateAcquired">Clear</button></span>
        </div>
        <input type="date" id="dateAcquired">
      </div>

      ${textField('notes', 'Notes', { multiline: true })}

      <button type="submit" class="button primary" id="save">Save</button>
    </form>`;

  const form = document.getElementById('form');
  const field = name => document.getElementById(name);
  const purposeSelect = field('purposeSelect');
  const purposeOtherField = field('purposeOtherField');

  // Fill in the existing values
  if (rec) {
    for (const name of ['nameJa', 'nameEn', 'location', 'dateAcquired', 'notes']) field(name).value = rec[name] || '';
    if (rec.purpose && PURPOSES.some(([ja]) => ja === rec.purpose)) {
      purposeSelect.value = rec.purpose;
    } else if (rec.purpose) {
      purposeSelect.value = '__other';
      field('purposeOther').value = rec.purpose;
    }
  }
  purposeOtherField.hidden = purposeSelect.value !== '__other';
  purposeSelect.addEventListener('change', () => {
    purposeOtherField.hidden = purposeSelect.value !== '__other';
  });

  form.addEventListener('input', () => { formDirty = true; });
  form.addEventListener('change', () => { formDirty = true; });

  // Paste / Clear buttons, and tidying of anything pasted
  form.querySelectorAll('[data-paste]').forEach(btn => {
    btn.addEventListener('click', () => pasteInto(field(btn.dataset.paste)));
  });
  form.querySelectorAll('[data-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = field(btn.dataset.clear);
      if (el.tagName === 'TEXTAREA' && el.value.length > 40 && !confirm('Clear all the notes?')) return;
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  form.querySelectorAll('input[type=text], textarea').forEach(el => {
    el.addEventListener('paste', e => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      insertText(el, tidyText(text, el.tagName === 'TEXTAREA'));
    });
  });

  // Photo pickers
  form.querySelectorAll('.picker').forEach(picker => {
    const side = picker.dataset.side;
    const state = photos[side];
    const img = picker.querySelector('img');
    const hint = picker.querySelector('.picker-hint');
    const input = picker.querySelector('input[type=file]');
    const removeBtn = picker.querySelector('[data-remove]');
    const viewBtn = picker.querySelector('[data-view]');
    const defaultHint = hint.textContent;

    const showPhoto = () => {
      img.hidden = !state.blob;
      hint.hidden = Boolean(state.blob);
      removeBtn.hidden = !state.blob;
      viewBtn.hidden = !state.blob;
      if (state.blob) img.src = blobUrl(state.blob);
    };

    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      hint.textContent = 'Processing…';
      try {
        state.blob = await Images.compress(file, 1600, 0.82);
        state.changed = true;
        formDirty = true;
      } catch {
        alert('Could not read that photo. Please try another one.');
      }
      hint.textContent = defaultHint;
      showPhoto();
    });

    viewBtn.addEventListener('click', () => {
      const shown = ['front', 'back'].filter(s => photos[s].blob).map(s => ({
        side: s,
        src: form.querySelector(`.picker[data-side=${s}] img`).src,
        label: s === 'front' ? 'Front' : 'Back',
      }));
      Viewer.open(shown, shown.findIndex(p => p.side === side));
    });

    removeBtn.addEventListener('click', () => {
      state.blob = null;
      state.changed = true;
      formDirty = true;
      showPhoto();
    });

    showPhoto();
  });

  field('cancel').addEventListener('click', () => {
    if (formDirty && !confirm('Discard your changes?')) return;
    formDirty = false;
    location.replace(editing ? '#/item/' + id : '#/');
  });
  field('save-top').addEventListener('click', () => field('save').click());

  let saving = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (saving) return;

    const data = {
      nameJa: field('nameJa').value.trim(),
      nameEn: field('nameEn').value.trim(),
      location: field('location').value.trim(),
      purpose: purposeSelect.value === '__other' ? field('purposeOther').value.trim() : purposeSelect.value,
      dateAcquired: field('dateAcquired').value,
      notes: field('notes').value.trim(),
    };
    if (!data.nameJa && !data.nameEn && !photos.front.blob && !photos.back.blob) {
      alert('Please add at least a shrine or temple name, or a photo.');
      return;
    }

    saving = true;
    const saveBtn = field('save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const now = new Date().toISOString();
      const record = {
        ...(rec || {}),
        ...data,
        id: rec ? rec.id : newId(),
        createdAt: rec ? rec.createdAt : now,
        updatedAt: now,
      };

      const photoChanges = {};
      for (const side of ['front', 'back']) {
        if (photos[side].changed) photoChanges[side] = photos[side].blob ? await Images.toStored(photos[side].blob) : null;
      }
      // The list thumbnail comes from the front photo, or the back if there's no front.
      if (!rec || photos.front.changed || photos.back.changed) {
        const source = photos.front.blob || photos.back.blob;
        record.thumb = source ? await Images.toStored(await Images.compress(source, 400, 0.75)) : null;
      }

      await DB.save(record, photoChanges);
      requestPersistence();
      formDirty = false;
      toast('Saved');
      location.replace('#/item/' + record.id);
    } catch (err) {
      console.error(err);
      alert('Could not save: ' + err.message);
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

// --- Backup / import ---

const BACKUP_APP = 'omamori-collection';

async function buildBackup() {
  const records = await DB.allRecords();
  // Built from parts so we never hold one enormous string in memory.
  const parts = [`{"app":"${BACKUP_APP}","format":1,"appVersion":${JSON.stringify(APP_VERSION)},"exportedAt":"${new Date().toISOString()}","records":[`];
  for (const [i, rec] of records.entries()) {
    const [front, back] = await Promise.all([DB.getPhoto(rec.id, 'front'), DB.getPhoto(rec.id, 'back')]);
    const entry = {
      ...rec,
      thumb: rec.thumb ? await Images.toDataURL(rec.thumb) : null,
      photos: {
        front: front ? await Images.toDataURL(front) : null,
        back: back ? await Images.toDataURL(back) : null,
      },
    };
    parts.push((i ? ',' : '') + JSON.stringify(entry));
  }
  parts.push(']}');
  return { blob: new Blob(parts, { type: 'application/json' }), count: records.length };
}

function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// Opens the Share sheet for a file, or downloads it where sharing isn't available.
// Resolves true once shared or downloaded, false if the Share sheet was cancelled.
async function shareFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  downloadFile(file);
  return true;
}

async function showBackup() {
  const myRoute = routeId;
  setHeader('Backup', '<a class="hbtn" href="#/">‹ All</a>');

  const records = await DB.allRecords();
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  if (myRoute !== routeId) return;

  const last = getLastBackup();
  view.innerHTML = `
    <section class="panel">
      <h2>Export a backup</h2>
      <p>Saves all ${records.length} omamori, including photos, into one file.
         Keep it somewhere safe, such as iCloud Drive in the Files app.</p>
      <p class="muted">Last backup: ${last ? esc(new Date(last).toLocaleString()) : 'never'}</p>
      <button type="button" class="button primary" id="prepare">Prepare backup file</button>
      <div id="ready" hidden>
        <p id="readyInfo"></p>
        <button type="button" class="button primary" id="share">Save backup file…</button>
      </div>
    </section>

    <section class="panel">
      <h2>Import a backup</h2>
      <p>Adds the omamori from a backup file. Entries that are already here are replaced by the
         version in the file; everything else is kept.</p>
      <label class="button">Choose backup file…<input type="file" id="importFile" class="visually-hidden"></label>
      <p id="importStatus" class="muted" aria-live="polite"></p>
    </section>

    <section class="panel">
      <h2>About</h2>
      <p>Version <strong>${esc(APP_VERSION)}</strong></p>
      ${estimate?.usage != null ? `<p>Storage used: ${formatBytes(estimate.usage)}</p>` : ''}
      <p class="muted">Your collection is stored only on this device, inside this app.
         Removing the app from the Home Screen deletes it, so export a backup regularly.</p>
    </section>`;

  // Exporting happens in two taps: iOS only allows the Share sheet to open
  // straight after a tap, and preparing a large backup can take a few seconds.
  let backupFile = null;
  const prepareBtn = document.getElementById('prepare');
  prepareBtn.addEventListener('click', async () => {
    prepareBtn.disabled = true;
    prepareBtn.textContent = 'Preparing…';
    try {
      const { blob, count } = await buildBackup();
      const name = `omamori-backup-${new Date().toISOString().slice(0, 10)}.json`;
      backupFile = new File([blob], name, { type: 'application/json' });
      document.getElementById('readyInfo').textContent = `Ready: ${count} omamori, ${formatBytes(blob.size)}.`;
      document.getElementById('ready').hidden = false;
      prepareBtn.hidden = true;
    } catch (err) {
      console.error(err);
      alert('Could not prepare the backup: ' + err.message);
      prepareBtn.disabled = false;
      prepareBtn.textContent = 'Prepare backup file';
    }
  });

  document.getElementById('share').addEventListener('click', async () => {
    if (await shareFile(backupFile)) {
      setLastBackup();
      toast('Backup saved');
    }
  });

  const importFile = document.getElementById('importFile');
  const status = document.getElementById('importStatus');
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    importFile.value = '';
    if (!file) return;

    status.textContent = 'Reading file…';
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      backup = null;
    }
    if (backup?.app !== BACKUP_APP || !Array.isArray(backup.records)) {
      status.textContent = 'That file isn’t a backup from this app.';
      return;
    }

    const entries = backup.records.filter(r => r && r.id);
    const existing = new Set((await DB.allRecords()).map(r => r.id));
    const overlap = entries.filter(r => existing.has(r.id)).length;
    const question = `Import ${entries.length} omamori from this backup?` +
      (overlap ? `\n\n${overlap} of them are already here and will be replaced with the backup’s version.` : '');
    if (!confirm(question)) { status.textContent = ''; return; }

    let done = 0;
    try {
      for (const entry of entries) {
        const { photos = {}, thumb, ...record } = entry;
        record.thumb = thumb ? Images.fromDataURL(thumb) : null;
        await DB.save(record, {
          front: photos.front ? Images.fromDataURL(photos.front) : null,
          back: photos.back ? Images.fromDataURL(photos.back) : null,
        });
        done++;
        status.textContent = `Imported ${done} of ${entries.length}…`;
      }
      requestPersistence();
      status.textContent = `Done — imported ${done} omamori.`;
    } catch (err) {
      console.error(err);
      status.textContent = `Stopped after ${done} of ${entries.length}: ${err.message}`;
    }
  });
}

// ---------- Start up ----------

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) {
  let hadController = Boolean(navigator.serviceWorker.controller);

  // A new version has taken over: reload to use it (unless a form is half filled in).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (formDirty) toast('A new version is ready. It will load next time you open the app.');
    else location.reload();
  });

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // Home Screen apps often resume rather than restart, so check for updates when shown.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(err => console.warn('Service worker not registered', err));
}
