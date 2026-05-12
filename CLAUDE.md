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
per-series lastChapterIdx and read list) and window.json (window
bounds, restored on launch).

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

PiP and main windows do not sync live (would require IPC broadcast).
They share state.json so the next launch is consistent.

## Keyboard

  J / ArrowLeft       previous chapter
  K / ArrowRight      next chapter
  P                   toggle PiP
  T                   toggle always-on-top
  F / F11             toggle fullscreen
  Esc                 back / exit fullscreen
  Home / End          top / bottom of current chapter
  Space               smooth scroll one viewport down
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
