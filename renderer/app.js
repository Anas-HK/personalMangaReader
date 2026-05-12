/* Manga Reader — renderer */
const api = window.api;
const $app = document.getElementById('app');
const $crumb = document.getElementById('breadcrumb');
const $back = document.getElementById('back-btn');
const $toast = document.getElementById('toast');
const $titlebar = document.getElementById('titlebar');

const params = new URLSearchParams(window.location.search);
const PIP_MODE = params.get('mode') === 'pip';
if (PIP_MODE) document.body.classList.add('pip-mode');

const state = {
  view: 'library',
  libraryRoot: '',
  series: [],
  query: '',
  currentSeries: null,
  chapters: [],
  chapterIdx: 0,
  persisted: {},
  toolbarHidden: false,
  toolbarTimer: 0,
  pipOpen: false,
  alwaysOnTop: false,
  fullscreen: false,
};

/* ---------------- Utils ---------------- */
function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') e.className = props[k];
    else if (k === 'style') Object.assign(e.style, props[k]);
    else if (k === 'html') e.innerHTML = props[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), props[k]);
    else if (k in e) e[k] = props[k];
    else e.setAttribute(k, props[k]);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}
function toast(msg, ms = 1800) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout($toast._t);
  $toast._t = setTimeout(() => $toast.classList.remove('show'), ms);
}
async function refreshIcons() {
  const aot = await api.window.isAOT();
  const fs = await api.window.isFullscreen();
  const pip = await api.window.isPipOpen();
  state.alwaysOnTop = aot;
  state.fullscreen = fs;
  state.pipOpen = pip;
  document.getElementById('aot-btn')?.classList.toggle('active', aot);
  document.getElementById('full-btn')?.classList.toggle('active', fs);
  document.getElementById('pip-btn')?.classList.toggle('active', pip);
}
function setBreadcrumb(parts) {
  $crumb.innerHTML = '';
  parts.forEach((p, i) => {
    if (i > 0) $crumb.appendChild(el('span', { class: 'sep' }, ['›']));
    $crumb.appendChild(el(i === parts.length - 1 ? 'b' : 'span', {}, [p]));
  });
}
function showBack(show) { $back.hidden = !show; }

/* ---------------- View: Library ---------------- */
async function viewLibrary() {
  state.view = 'library';
  showBack(false);
  setBreadcrumb([]);

  $app.innerHTML = '';
  const container = el('div', { class: 'library' });
  $app.appendChild(container);

  const header = el('div', { class: 'library-header' }, [
    el('div', {}, [
      el('h1', {}, ['Library']),
      el('div', { class: 'root-path', id: 'root-path' }, [state.libraryRoot || '(no folder set)']),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: refreshLibrary }, ['Refresh']),
      el('button', { class: 'btn', onclick: pickRoot }, ['Change folder…']),
    ])
  ]);
  container.appendChild(header);

  container.appendChild(el('div', { class: 'search-row' }, [
    el('input', {
      class: 'search-input',
      type: 'search',
      placeholder: 'Filter series…',
      value: state.query,
      oninput: (e) => { state.query = e.target.value; renderGrid(); }
    })
  ]));

  const gridWrap = el('div', { id: 'grid-wrap' });
  container.appendChild(gridWrap);
  renderGrid();
}

function renderGrid() {
  const wrap = document.getElementById('grid-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const q = state.query.trim().toLowerCase();
  const filtered = state.series.filter(s => !q || s.name.toLowerCase().includes(q));
  if (!filtered.length) {
    wrap.appendChild(el('div', { class: 'empty-state' }, [
      el('h2', {}, [state.series.length === 0 ? 'No series found.' : 'No matches for that filter.']),
      el('p', {}, [
        state.series.length === 0
          ? ['Drop manga folders into ', el('code', {}, [state.libraryRoot || 'your library folder']), '. Each series gets its own folder containing chapter subfolders of images.']
          : 'Try a different search term.'
      ]),
    ]));
    return;
  }
  const grid = el('div', { class: 'grid' });
  for (const s of filtered) grid.appendChild(seriesCard(s));
  wrap.appendChild(grid);
}

function seriesCard(s) {
  const persisted = (state.persisted.series || {})[s.name] || {};
  const lastIdx = persisted.lastChapterIdx;
  const progress = (typeof lastIdx === 'number' && lastIdx >= 0)
    ? `Ch. ${lastIdx + 1} / ${s.chapters}`
    : null;
  const coverUrl = s.coverPath ? api.toAssetUrl(s.coverPath) : null;
  return el('div', {
    class: 'card',
    onclick: () => openSeries(s),
    role: 'button', tabindex: '0',
    onkeydown: (e) => { if (e.key === 'Enter') openSeries(s); }
  }, [
    el('div', {
      class: coverUrl ? 'cover' : 'cover empty',
      style: coverUrl ? { backgroundImage: `url("${coverUrl}")` } : {}
    }, [
      progress ? el('div', { class: 'progress-pill' }, [progress]) : null,
      coverUrl ? null : el('span', {}, ['no cover'])
    ]),
    el('div', { class: 'info' }, [
      el('div', { class: 'name' }, [s.name]),
      el('div', { class: 'stats' }, [`${s.chapters} chapters • ${s.totalPages} pages`]),
    ])
  ]);
}

async function refreshLibrary() {
  const result = await api.library.scan(state.libraryRoot);
  if (result.error) {
    toast(`Library error: ${result.error}`);
    state.series = [];
  } else {
    state.series = result.series;
  }
  if (state.view === 'library') renderGrid();
  document.getElementById('root-path') && (document.getElementById('root-path').textContent = state.libraryRoot);
}

async function pickRoot() {
  const newRoot = await api.library.pickRoot();
  if (!newRoot) return;
  state.libraryRoot = newRoot;
  await refreshLibrary();
  toast('Library folder updated');
}

/* ---------------- View: Series detail ---------------- */
async function openSeries(s) {
  state.currentSeries = s;
  state.view = 'series';
  showBack(true);
  setBreadcrumb([s.name]);
  $app.innerHTML = '<div class="spinner"></div>';
  const chapters = await api.chapters.scan(s.path);
  state.chapters = chapters;
  renderSeriesDetail();
}

function renderSeriesDetail() {
  const s = state.currentSeries;
  const persisted = (state.persisted.series || {})[s.name] || {};
  const lastIdx = (typeof persisted.lastChapterIdx === 'number') ? persisted.lastChapterIdx : -1;
  const coverUrl = s.coverPath ? api.toAssetUrl(s.coverPath) : null;

  $app.innerHTML = '';
  const root = el('div', { class: 'series-detail' });
  const hero = el('div', { class: 'series-hero' }, [
    el('div', {
      class: 'hero-cover',
      style: coverUrl ? { backgroundImage: `url("${coverUrl}")` } : { background: '#1a1a22' }
    }),
    el('div', { class: 'hero-info' }, [
      el('h1', {}, [s.name]),
      el('div', { class: 'meta' }, [
        el('span', {}, [`${state.chapters.length} chapters`]),
        el('span', {}, [`${state.chapters.reduce((a, c) => a + c.pages, 0)} pages`]),
        lastIdx >= 0 ? el('span', {}, [`Last read: ${state.chapters[lastIdx]?.name || 'unknown'}`]) : null,
      ]),
      el('div', { class: 'hero-actions' }, [
        el('button', {
          class: 'btn primary',
          onclick: () => openReader(lastIdx >= 0 ? lastIdx : 0)
        }, [lastIdx >= 0 ? 'Continue reading' : 'Read from start']),
        lastIdx >= 0 ? el('button', {
          class: 'btn ghost',
          onclick: () => openReader(0)
        }, ['Restart']) : null,
      ])
    ])
  ]);
  root.appendChild(hero);

  const list = el('div', { class: 'chapter-list' }, [
    el('div', { class: 'row-header' }, [
      el('h2', {}, [`${state.chapters.length} chapters`]),
    ]),
    el('div', { class: 'chapters', id: 'chapter-rows' }, [])
  ]);
  root.appendChild(list);
  $app.appendChild(root);

  const rows = document.getElementById('chapter-rows');
  state.chapters.forEach((c, i) => {
    const isRead = (persisted.read || []).includes(i);
    const isCurrent = lastIdx === i;
    rows.appendChild(el('div', {
      class: `chapter-row ${isRead ? 'read' : ''} ${isCurrent ? 'current' : ''}`.trim(),
      onclick: () => openReader(i),
      tabindex: '0',
      onkeydown: (e) => { if (e.key === 'Enter') openReader(i); }
    }, [
      el('div', { class: 'num' }, [c.name]),
      el('div', { class: 'name' }, ['']),
      el('div', { class: 'pages' }, [`${c.pages} pages`]),
      isRead ? el('div', { class: 'read-dot' }) : null,
    ]));
  });
  $app.scrollTop = 0;
}

/* ---------------- View: Reader ---------------- */
async function openReader(idx) {
  if (!state.chapters.length) return;
  if (idx < 0 || idx >= state.chapters.length) return;
  state.view = 'reader';
  state.chapterIdx = idx;
  showBack(true);
  const ch = state.chapters[idx];
  setBreadcrumb([state.currentSeries.name, ch.name]);
  renderReader();
  // Persist current chapter
  state.persisted.series = state.persisted.series || {};
  const cur = state.persisted.series[state.currentSeries.name] || {};
  cur.lastChapterIdx = idx;
  cur.read = cur.read || [];
  if (!cur.read.includes(idx)) cur.read.push(idx);
  state.persisted.series[state.currentSeries.name] = cur;
  await api.state.mergeSeries(state.currentSeries.name, cur);
}

function renderReader() {
  const s = state.currentSeries;
  const ch = state.chapters[state.chapterIdx];

  $app.innerHTML = '';
  const view = el('div', { class: 'reader-view', id: 'reader-view' });
  const picker = el('select', {
    class: 'picker',
    onchange: (e) => openReader(+e.target.value)
  });
  state.chapters.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = c.name;
    if (i === state.chapterIdx) opt.selected = true;
    picker.appendChild(opt);
  });

  const toolbar = el('div', { class: 'reader-toolbar' }, [
    el('button', {
      class: 'icon-btn',
      title: 'Previous chapter (J)',
      onclick: () => prevChapter(),
      disabled: state.chapterIdx === 0
    }, [iconSvg('M15 19l-7-7 7-7')]),
    picker,
    el('button', {
      class: 'icon-btn',
      title: 'Next chapter (K)',
      onclick: () => nextChapter(),
      disabled: state.chapterIdx === state.chapters.length - 1
    }, [iconSvg('M9 5l7 7-7 7')]),
    el('span', { class: 'pages-indicator', id: 'pages-indicator' }, [`${state.chapterIdx + 1} / ${state.chapters.length}`]),
  ]);
  view.appendChild(toolbar);

  const pages = el('div', { class: 'reader-pages', id: 'reader-pages' });
  for (let i = 0; i < ch.images.length; i++) {
    const filename = ch.images[i];
    const fullPath = `${ch.path}\\${filename}`;
    const url = api.toAssetUrl(fullPath);
    const img = document.createElement('img');
    img.alt = `page ${i + 1}`;
    img.decoding = 'async';
    img.loading = i < 3 ? 'eager' : 'lazy';
    img.addEventListener('error', () => {
      console.error('[img ERR]', img.src, 'from raw url', url);
    });
    img.addEventListener('load', () => {
      if (i === 0) console.log('[img OK]', img.src);
    });
    img.src = url;
    if (i === 0) console.log('[reader] first image url=', url, 'fullPath=', fullPath);
    pages.appendChild(img);
  }
  view.appendChild(pages);

  const isLast = state.chapterIdx === state.chapters.length - 1;
  view.appendChild(el('div', {
    class: isLast ? 'chapter-divider end' : 'chapter-divider'
  }, [
    el('div', {}, [`End of ${ch.name}`]),
    !isLast ? el('div', { class: 'next-up' }, [
      `Next: ${state.chapters[state.chapterIdx + 1].name} — `,
      el('a', {
        href: '#',
        style: { color: 'var(--accent)' },
        onclick: (e) => { e.preventDefault(); nextChapter(); }
      }, ['continue →'])
    ]) : el('div', { class: 'next-up' }, ['You\'ve reached the end.']),
  ]));

  view.appendChild(el('div', { class: 'page-progress', id: 'page-progress' }, ['0 / ' + ch.images.length]));
  $app.appendChild(view);
  $app.scrollTop = 0;
  setupReaderObservers();
}

function iconSvg(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

let lastScrollTop = 0;
function setupReaderObservers() {
  const view = document.getElementById('reader-view');
  if (!view) return;
  const indicator = document.getElementById('page-progress');
  const images = view.querySelectorAll('.reader-pages img');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const idx = [...images].indexOf(entry.target) + 1;
        if (indicator) indicator.textContent = `${idx} / ${images.length}`;
      }
    }
  }, { root: $app, threshold: 0.5 });
  images.forEach(img => observer.observe(img));

  // Auto-hide toolbar on scroll down, reveal on scroll up or mouse near top
  $app.onscroll = () => {
    const cur = $app.scrollTop;
    const goingDown = cur > lastScrollTop + 4;
    const goingUp = cur < lastScrollTop - 4;
    if (goingDown && cur > 120) hideToolbar();
    if (goingUp) showToolbar();
    lastScrollTop = cur;
  };
  $app.onmousemove = (e) => {
    if (e.clientY < 80) showToolbar();
  };
}
function hideToolbar() {
  const v = document.getElementById('reader-view');
  v?.classList.add('toolbar-hidden');
  state.toolbarHidden = true;
}
function showToolbar() {
  const v = document.getElementById('reader-view');
  v?.classList.remove('toolbar-hidden');
  state.toolbarHidden = false;
}

function prevChapter() { openReader(state.chapterIdx - 1); }
function nextChapter() { openReader(state.chapterIdx + 1); }

/* ---------------- Navigation ---------------- */
function goBack() {
  if (PIP_MODE) return; // PiP window can only close
  if (state.view === 'reader') {
    renderSeriesDetail();
    state.view = 'series';
    setBreadcrumb([state.currentSeries.name]);
  } else if (state.view === 'series') {
    state.currentSeries = null;
    state.chapters = [];
    viewLibrary();
  }
}

/* ---------------- Window controls ---------------- */
async function bindWindowButtons() {
  document.getElementById('min-btn').onclick = () => api.window.minimize();
  document.getElementById('max-btn').onclick = () => api.window.maximize();
  document.getElementById('close-btn').onclick = () => api.window.close();
  document.getElementById('aot-btn').onclick = async () => {
    const next = await api.window.toggleAOT();
    document.getElementById('aot-btn').classList.toggle('active', next);
    toast(next ? 'Always on top: on' : 'Always on top: off');
  };
  document.getElementById('full-btn').onclick = async () => {
    const next = await api.window.toggleFullscreen();
    document.getElementById('full-btn').classList.toggle('active', next);
  };
  document.getElementById('pip-btn').onclick = togglePip;
  $back.onclick = goBack;
}

async function togglePip() {
  if (PIP_MODE) {
    api.window.close();
    return;
  }
  const isOpen = await api.window.isPipOpen();
  if (isOpen) {
    await api.window.closePip();
    document.getElementById('pip-btn').classList.remove('active');
    toast('PiP closed');
  } else {
    if (state.view !== 'reader' || !state.currentSeries) {
      toast('Open a chapter first');
      return;
    }
    await api.window.openPip({
      seriesPath: state.currentSeries.path,
      seriesName: state.currentSeries.name,
      chapterIdx: String(state.chapterIdx),
    });
    document.getElementById('pip-btn').classList.add('active');
  }
}

/* ---------------- Keyboard ---------------- */
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const k = e.key;
    if (state.view === 'reader' || PIP_MODE) {
      if (k === 'j' || k === 'J' || k === 'ArrowLeft')  { prevChapter(); e.preventDefault(); return; }
      if (k === 'k' || k === 'K' || k === 'ArrowRight') { nextChapter(); e.preventDefault(); return; }
      if (k === 'Home') { $app.scrollTop = 0; e.preventDefault(); return; }
      if (k === 'End')  { $app.scrollTop = $app.scrollHeight; e.preventDefault(); return; }
      if (k === ' ')    { $app.scrollBy({ top: $app.clientHeight * 0.85, behavior: 'smooth' }); e.preventDefault(); return; }
    }
    if (k === 'p' || k === 'P') { togglePip(); e.preventDefault(); }
    else if (k === 't' || k === 'T') { document.getElementById('aot-btn')?.click(); e.preventDefault(); }
    else if (k === 'f' || k === 'F' || k === 'F11') { document.getElementById('full-btn')?.click(); e.preventDefault(); }
    else if (k === 'Escape') {
      if (state.fullscreen) { api.window.toggleFullscreen(); refreshIcons(); }
      else goBack();
    }
  });
}

/* ---------------- Boot ---------------- */
async function bootPip() {
  // PiP mode: load a single series + chapter, render reader only
  const seriesPath = params.get('seriesPath');
  const seriesName = params.get('seriesName');
  const chapterIdx = parseInt(params.get('chapterIdx') || '0', 10);
  if (!seriesPath || !seriesName) {
    $app.innerHTML = '<div class="empty-state"><h2>PiP boot failed</h2><p>Missing series info.</p></div>';
    return;
  }
  const chapters = await api.chapters.scan(seriesPath);
  state.currentSeries = { path: seriesPath, name: seriesName };
  state.chapters = chapters;
  state.chapterIdx = Math.max(0, Math.min(chapterIdx, chapters.length - 1));
  setBreadcrumb([]);
  renderReader();
}

async function boot() {
  await bindWindowButtons();
  bindKeys();
  state.persisted = await api.state.get();
  state.libraryRoot = state.persisted.libraryRoot || '';

  if (PIP_MODE) { await bootPip(); refreshIcons(); return; }

  const result = await api.library.scan(state.libraryRoot);
  if (result.error) toast(`Library scan error: ${result.error}`);
  state.series = result.series || [];
  viewLibrary();
  refreshIcons();

  setInterval(refreshIcons, 1500);
}

boot().catch(err => {
  console.error(err);
  $app.innerHTML = `<div class="empty-state"><h2>Failed to start</h2><pre>${err.message}</pre></div>`;
});
