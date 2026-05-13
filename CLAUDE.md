# Manga Reader

Local desktop manga/manhwa reader for Windows. Built with Electron.

## What this app does

Auto-discovers series folders in a library root and displays them in a
continuous vertical scroll reader optimized for manhwa/manhua. Has true
Picture-in-Picture (a separate frameless always-on-top window) so the
reader can stay open while you do other work.

Three views: library grid (series cards), series detail (cover + chapter
list + Continue Reading), and reader (continuous scroll). PiP is a
variant of the reader rendered in a smaller secondary window.

## Problem it solves

Folders of JPEGs downloaded from manga aggregators are awkward to read
in Windows. Generic image viewers (Photos, IrfanView) show one page at
a time and have no chapter awareness, no resume-reading, no continuous
scroll. Web-based readers like Kavita require running a local server.

This app is a single-binary desktop reader: drop a series folder into
the library root, it shows up. Reads where you left off, knows about
chapters, and stacks page tiles seamlessly for manhwa.

## Library folder layout

  <library-root>/
    <series-name>/
      Ch. 001/
        001.jpeg
        002.jpeg
        ...
      Ch. 002/
        ...

Default library root is C:\DownloadedMaterial\coms. User-configurable
in-app via the "Change folder..." button on the library view.

A subfolder is recognized as a series only if (1) it has at least one
subfolder with a digit in its name AND (2) that subfolder contains at
least one image (.jpg/.jpeg/.png/.webp/.gif/.avif). This is what stops
non-manga folders (like the manga-reader app folder itself, or an
extracted Electron app) from polluting the library view.

Cover image is auto-detected: cover.jpg/png/webp in the series root if
present, otherwise the first page of the first chapter.

## Architecture

- main.js: Electron main process. Custom-title-bar window management,
  IPC handlers, filesystem scanning (scanLibrary, scanChapters), state
  persistence, PiP window spawning.
- preload.js: contextBridge API exposed to the renderer as window.api.
  Includes toAssetUrl() for path-to-file-URL conversion.
- renderer/index.html: Frameless title bar + SPA shell.
- renderer/styles.css: Dark theme, custom scrollbars, auto-hide reader
  toolbar, PiP-mode style overrides.
- renderer/app.js: Vanilla-JS SPA. Three views, state machine via the
  state object. el() helper for DOM construction. PiP boot detected by
  ?mode=pip query param.

State lives in %APPDATA%\manga-reader\state.json (libraryRoot,
mainAlwaysOnTop preference, per-series lastChapterIdx and read list)
and window.json (window bounds, restored on launch).

## How images are loaded (important)

Renderer constructs file:// URLs pointing directly to disk locations
in the user's library. Main window is created with webSecurity: false
to allow cross-origin file:// loads from a file:// document. This is
the standard Electron pattern for local-file viewers; it's safe in this
context because the app only loads files the user explicitly placed
into their own library folder on their own machine.

A custom asset:// protocol was attempted first. It worked for CSS
background-image but failed for <img src=> because Chromium's URL
parser handles Windows drive-letter colons inconsistently between CSS
url() and HTML img.src for non-standard schemes. The dead asset://
protocol handler code is still in main.js as a reference; nothing
points at it now.

## Picture-in-Picture

Implementing PiP for arbitrary HTML (not just <video>) in a normal
browser requires the Document Picture-in-Picture API. In an Electron
app we get a stronger primitive: spawn a separate frameless
alwaysOnTop BrowserWindow.

The reader's PiP button calls window:open-pip via IPC. main.js creates
a 440x760 frameless alwaysOnTop window, loads renderer/index.html with
?mode=pip&seriesPath=...&seriesName=...&chapterIdx=... in the query
string. The renderer detects mode=pip and routes to bootPip() instead
of the normal boot, which renders only the reader for the given
chapter.

When PiP opens, the main window auto-hides via mainWindow.hide() so the
two never appear simultaneously (no duplicate taskbar entries, no
attention split). Closing the PiP restores the main window. The PiP
renderer never sees the main window state live; the two share state.json
so the next launch is consistent.

In PiP mode the renderer is intentionally ultra-minimal: the titlebar
stays permanently mounted at the top in its real layout position but is
fully transparent and its children are display:none. Moving the mouse
into the top ~40px adds .show-chrome to the body which fades in the
titlebar background and re-shows the close + PiP toggle buttons. After
the mouse leaves the zone for ~1.1s, .show-chrome is removed and the
chrome fades away again. The reader toolbar and bottom page-progress
indicator are display:none throughout PiP mode.

Why the titlebar must not be hidden via transform/translate: Electron
computes -webkit-app-region: drag regions from each element's bounding
client rect, and CSS transforms move the bounding rect. A
"transform: translateY(-100%)" on the titlebar moves its drag region
offscreen with it, breaking window-drag whenever chrome is hidden and
making drag intermittent after resize (the drag-region map can be slow
to recompute). Keeping the titlebar permanently at its real position
and fading only the visual chrome keeps the drag region stable at
y=[0, 28] in all states.

The PIP_TOGGLE_ACCELERATOR (top of main.js, currently Ctrl+Shift+Z) is
registered globally on app.whenReady and unregistered on app.will-quit.
toggleActiveWindowVisibility() targets the PiP window if it exists,
otherwise the main window, so the same shortcut hides/shows whichever
window is currently in use.

## Always-on-top

Two windows, two policies:
- Main window: user toggles via the title-bar button or the T key. The
  preference persists in state.json (mainAlwaysOnTop) and is restored
  on launch.
- PiP window: permanently always-on-top. The toggle-aot IPC refuses to
  turn it off and the T key in PiP mode shows a toast instead of
  toggling.

Both use Electron's 'screen-saver' level (the strongest level Electron
exposes; defined as AOT_LEVEL in main.js). The default 'floating' level
on Windows loses to other topmost windows, fullscreen video, and some
OS surfaces, so always use applyAlwaysOnTop() instead of the raw
setAlwaysOnTop() to get the correct level plus
setVisibleOnAllWorkspaces({ visibleOnFullScreen: true }).

Windows can drop the topmost flag during show/hide, restore-from-
minimize, and fullscreen transitions. bindAlwaysOnTopReinforcement()
re-asserts the flag on the 'show', 'focus', 'restore',
'enter-full-screen', and 'leave-full-screen' window events whenever
the caller-supplied intent function still returns true.

## Keyboard

  J / ArrowLeft       previous chapter
  K / ArrowRight      next chapter
  P                   toggle PiP
  T                   toggle always-on-top
  F / F11             toggle fullscreen
  Esc                 back / exit fullscreen
  Home / End          top / bottom of current chapter
  Space               smooth scroll one viewport down
  Ctrl+Shift+Z        hide / show the active window (PiP if open, else main)
  F12 / Ctrl+Shift+I  DevTools (both windows)

## Building

  npm install                  # one-time
  npm start                    # run in dev mode
  npm run dist                 # build portable .exe

Output: dist\MangaReader-<version>-portable.exe. Single self-contained
file (~70 MB after LZMA compression). End users do not need Node, npm,
or anything else installed; double-click to run.

Build prerequisites:
- Windows Developer Mode must be enabled. electron-builder unpacks
  winCodeSign-2.6.0.7z which contains macOS dylib symlinks; creating
  those needs SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE, which is
  only honored when Dev Mode is on. Without Dev Mode the build fails
  during cache extraction with "A required privilege is not held by
  the client."
- Code signing is disabled in package.json (signtoolOptions: null,
  verifyUpdateCodeSignature: false). The resulting .exe is unsigned;
  Windows SmartScreen warns once on first launch.

## Notes for future edits

- Renderer is vanilla JS by design. No React, no build pipeline, no
  TypeScript. Surface area is small enough not to justify one. Keep it
  that way.
- Custom title bar uses CSS -webkit-app-region: drag on the
  .titlebar-drag region. Any clickable element inside the drag region
  needs -webkit-app-region: no-drag or its clicks become window drags.
- All fs operations belong in main.js. Renderer talks to disk only
  through the contextBridge API in preload.js, plus image loads via
  file:// URLs.
- The asar bundle is on (default). Don't add code that reads app files
  via raw fs paths from the renderer; use loadFile or Electron's
  built-in asar resolution.
- chapter natural-sort key handles "Ch. 1", "Ch. 10", "Ch. 2" correctly
  (sorts numerically when a number is found).
- mainWindow.webContents.openDevTools should not be called on launch
  in production builds. It's only enabled via F12 / Ctrl+Shift+I.

## File map

  main.js                       Electron main
  preload.js                    contextBridge
  package.json                  deps + build config
  renderer/
    index.html                  shell + title bar
    styles.css                  dark theme + reader layout
    app.js                      SPA logic
  dist/                         (gitignored) build outputs
  node_modules/                 (gitignored)

## Market context and product strategy

Research conducted 2026-05-12 during a strategic review.

### What already exists in this space

Local-folder manhwa/webtoon readers for Windows are a crowded, mature
niche. The closest competitors:

- Yomikiru: Electron + React, local manga/manhwa/comic/webtoon/EPUB,
  vertical scroll + LTR + RTL, AniList sync, bookmarks, reader presets.
  ~460 GitHub stars. https://github.com/mienaiyami/yomikiru
- Houdoku: Electron, local AND online via Tiyo plugin + extensions
  (MangaDex, Mangakakalot), AniList/MAL sync, Discord status.
  https://github.com/xgi/houdoku
- Mangayomi: Flutter, cross-platform (Win/Mac/Linux/iOS/Android),
  manga + novel + anime, Tachiyomi-inspired. 2.7k stars.
  https://github.com/kodjodevf/mangayomi
- Suwayomi-Server + clients (Sorayomi, JUI, VaadinUI): Java desktop,
  reuses Mihon's extension ecosystem.
  https://github.com/Suwayomi/Suwayomi-Server
- YACReader: C++/Qt, "flow mode" for webtoon-style continuous scroll.
- OpenComic: Node + Electron. https://github.com/ollm/OpenComic
- Clovre: web app, local manhwa + AniList.
  https://github.com/rehhouari/clovre
- Rulia: Microsoft Store, many formats including PDF/EPUB.

Conclusion: the "local folder + chapter library + webtoon scroll" niche
is filled. This app's local-reading features alone do not differentiate.

### Where this app genuinely differs

Picture-in-Picture / always-on-top floating reader is missing from every
comparable app. Verified via GitHub feature-request search: nobody is
asking for it, nobody has shipped it. That is a real differentiator,
even though the audience for "read while multitasking" is small
(estimated hundreds to low thousands globally).

### Why streaming/extension features should NOT be added

Three reasons in priority order:

1. Legal hostility. Tachiyomi (the dominant Android manga reader) was
   shut down in January 2024 by a cease-and-desist from Kakao
   Entertainment. Mihon (its successor) survives only by refusing to
   bundle extension repos. Adding streaming via aggregator scrapers
   exposes this project to the same legal risk under the maintainer's
   real name. The repo is at Anas-HK/personalMangaReader on GitHub,
   tied to a personal identity.

2. Saturated competition. Mihon (8.5k stars), Mangayomi (2.7k stars),
   Suwayomi (reuses Mihon's entire ecosystem), Houdoku all already
   cover streaming. Each has multi-person teams or years of accumulated
   scraper code. A solo new entrant cannot catch up.

3. Maintenance treadmill. Aggregator sites change HTML every few
   months, deploy anti-bot challenges, shuffle image tiles. Tachiyomi
   has ~200 community-maintained extensions because no single dev can
   keep up. This project saw this firsthand when comic_dl's MangaDex
   scraper broke mid-session and mangabot-2.5's catalogs all 404'd
   from age.

### Strategic positioning if growth is wanted

The defensible angle is "the reader for people who already have files":

- Stay local-only. No extensions, no scrapers, no legal exposure.
- Integrate WITH existing downloaders (mangapill_dl.py,
  mangadex-downloader, Mihon's downloads folder, filesystem watchers).
  Pitch: "use any tool to download; this is the reader."
- Specialize harder than competitors on webtoon UX: infinite-scroll
  across chapter boundaries (auto-transition), reading-pace-aware
  prefetch, gap detection between scan tiles.
- Ship PiP polish that nobody else bothers with: multiple positions/
  sizes, edge-snap, transparency on hover-away, Windows 11 jumplist +
  snap-layout integration, study-mode (PiP + pomodoro timer).

### Decisions for future agents

- Do NOT propose adding extension-based streaming. The cost-benefit is
  decisively negative.
- Local-folder reading is the scope. Anything outside the user's
  filesystem is out of scope.
- Differentiation comes from the PiP/multitasking workflow and webtoon
  UX depth, not from sources/formats/library-management features.
- If the user asks about market positioning, point them at this
  section instead of re-doing the research.

### Sources (verified 2026-05-12)

- https://github.com/mienaiyami/yomikiru
- https://houdoku.org/
- https://github.com/kodjodevf/mangayomi
- https://github.com/Suwayomi/Suwayomi-Server
- https://github.com/mihonapp/mihon
- https://alternativeto.net/news/2024/1/manga-reader-app-tachiyomi-ceases-development-amid-legal-threats-from-kakao-entertainment/
- https://en.wikipedia.org/wiki/Tachiyomi
