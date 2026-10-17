# System qualities

Status: Accepted (2026-10-17, Canopi 2.1 target; built by the 2.1 foundation phases; ledger [2.1-Q70 to 2.1-Q77, 2.1-Q123 to 2.1-Q126, 2.1-Q135, 2.1-E7, 2.1-M7, 2.1-M8, 2.1-M18](../decisions/2-1.md))

## Context

Canopi is designed for millions of users (2.1-Q70) with no backend ever (2.1-Q71), no collaboration (2.1-Q72) and diagnostics sent only by the user (2.1-Q74). Its first-class platforms are Linux and Windows (WebView2) Desktop, and Web on desktop browsers, phones and tablets (2.1-Q73); the macOS dmg is still published, unsigned as today, with no new macOS investment until the user decides (2.1-Q125, 2.1-Q135). The user has only Linux, so every other platform is checked on CI hosted runners and nothing assumes a hand check (2.1-Q77).

In 2.0 the only copy of a Web user's work can be evicted, a Web deploy strands open tabs, only Linux runs the real app in CI, and Web runs only in Chromium and WebKit.

## Decision

Each quality names its mechanism and its check. A check "planned" is created by the phase the plan names.

- **On-device data safety.** No byte of user work is lost or half-written by a crash, a full disk, a rollback or the browser.
  - Mechanism: `publish_durably` behind the `DurableFs` fault seam (ADR 0023) and the Draft store's `IDBFactory`; chained, frozen migrations on a verified copy (ADR 0026); the pre-upgrade `.canopi` copy (2.1-Q35r); rollback by one release destroys no work, and every upgrade keeps the form it replaces once beside the store (2.1-E4, 2.1-M9, 2.1-E7, 2.1-M15 to 2.1-M17).
  - Web: persistence is requested on the first Draft with a one-line reason; if refused, the welcome screen and save status warn and offer Download .canopi (2.1-Q82). A deploy keeps the previous release's files, so an open tab keeps working and shows one "New version: Reload" notice, saving before it reloads (2.1-Q83).
  - Check: the model-based Session, Draft, user-DB and LiDAR suites over the fault seams; the migration harness; the Draft-store suite; a deploy-skew e2e (an old tab loads a lazy chunk after a new deploy).
- **Untrusted input.** Every file, Draft, catalog artifact, tile, geocoder reply and settings record is hostile until admitted.
  - Mechanism: a threat model per input in the native guide (source, size cap, parser, isolation; written by Phase 1 1a); size caps before parsing (`.canopi` 64 MiB on both editions, GeoJSON through one bounded reader, rasters by the cell cap); readers return typed refusals and never panic (clippy `unwrap_used`, `expect_used` and `panic` denied in reader modules); wasm and decoders run in workers on Web; the Web CSP is generated from the one origin table, report-only for its first deploy, then enforcing (2.1-M3).
  - Check: cargo-fuzz on `canopi-format` admission and chain, the GeoJSON reader and the LiDAR and raster readers (scheduled lane; each crash a corpus case and a test); a CSP test that every origin the code contacts is in the table.
- **Platform matrix.** Every platform runs the real app in CI.
  - Desktop: Linux WebKitGTK and Windows WebView2 run the Desktop real-app suite (2.1-M2, 2.1-M7), a WebdriverIO suite in `e2e/platform/` over tauri-driver; Playwright cannot drive a WebDriver session, so the shared Playwright suite stays the browser suite. It covers the paths only the real shell has: file home save and Save as, the close guard and Quit, single instance, the asset protocol, the native catalog, the library and a job. Native file dialogs are answered by a debug-feature dialog seam in the desktop host.
  - macOS Desktop keeps today's CI build, native tests and dmg package (2.1-Q135), but is not tested by the Desktop real-app suite or a smoke, and no 2.1 work designs for WKWebView, until the user decides (2.1-Q125). Safari users are covered by WebKit in the browser suite.
  - Web: Chromium, WebKit and Firefox (2.1-Q84) run the browser suite; phone and tablet layouts run as a smoke in the iOS simulator on a macOS runner and an Android emulator on a Linux runner. The iOS simulator smoke is the one macOS-runner test job 2.1 adds, and it checks Web on phones, not macOS Desktop (2.1-M18).
  - Check: the CI lanes themselves; a platform lane that cannot run fails, it is never skipped silently.
- **Release safety.** A user installs only what Canopi's release built, and the app installs only an update Canopi signed.
  - Distribution: Windows NSIS exe and MSI; Linux AppImage and `.deb` downloads with published checksums, no apt repository (2.1-Q126; Flatpak is a possible later channel, not planned); the macOS dmg published unsigned as today, with no Developer ID or notarization, not tested by the Desktop real-app suite (2.1-Q135); it self-updates only if the unsigned update probe is clean (2.1-Q136).
  - Windows signing (2.1-Q124): SignPath Foundation is the target. Until it is granted, releases keep today's unsigned exe and MSI for current users, with the SmartScreen warning as the named residual risk; from the grant, one stable publisher identity signs every Windows artifact.
  - Self-update (2.1-Q123): the Tauri updater. Its artifacts are signed with the updater key (a CI secret; the public half ships in the app), each channel is one static endpoint published with the release, and the app refuses an update whose signature fails. On Linux only the AppImage self-updates; About tells a `.deb` user to download the new version.
  - Check: the release smoke installs and launches each artifact on Linux and Windows; an update artifact without a valid updater signature or channel entry fails the release, and so does an unsigned Windows artifact once the grant exists; an updater e2e moves an installed N-1 to N through a local static endpoint.
- **Accessibility.** axe-core, ARIA snapshots of each surface and keyboard-only flows for every user path block CI on Linux (Chromium, WebKit and Firefox, 2.1-Q84). Screen-reader runs (NVDA on Windows; VoiceOver waits for a macOS decision, 2.1-Q135) are a non-blocking smoke whose findings become beads.
- **Performance budgets.** Measured, not optimised: bundle size per chunk, cold start to an interactive start screen, opening the large fixture Design, and a fixed scripted pan and zoom of the large fixture Design in Chromium on Linux, measured as the median of five runs of long tasks over 50 ms and frames over 50 ms; raw frame time is recorded as information, not gated, because hosted runners draw WebGL in software on shared cores.
  - Each budget is a ratchet entry with a tolerance, baselined at 2.0.1 by Phase 0 F3; a rise past it fails and becomes a bead, never a raised budget without the user's dated decision.
- **Static Web serving.** No server logic.
  - Mechanism: every asset and catalog file has an immutable, content-versioned URL; one small `no-cache` manifest names them; `.parquet` files have a cache rule so range requests work; no file exceeds 25 MiB (the Pages cap of 26,214,400 bytes).
  - The DuckDB-WASM binaries are larger than the cap (35 to 41 MB in 1.33), so they are served from a Canopi-owned R2 bucket on a `projectcanopi.com` subdomain under immutable versioned keys, never a third-party CDN (2.1-M8). They are named in the manifest and the CSP origin table and served with CORS, so the service worker can cache them. The Pages artifact still refuses a raw DuckDB wasm.
  - Previous release kept (2.1-Q83): each upload is this release's files plus every file named by the previous release's manifest, taken from the previous release artifact and verified by its checksums; files only N-2 named are dropped. The 20,000-file and 25 MiB checks run on the merged set.
  - Service worker (2.1-Q116): it caches the app shell and the DuckDB binaries, and caches each catalog piece as it is read: fixed-size blocks of an immutable catalog file, each stored as a whole entry keyed by file and offset, because the Cache API stores no 206 and matches no Range; "Keep the catalog for offline use" fetches every block. It answers HEAD and Range requests itself, assembling a 206 with Content-Range and Accept-Ranges from cached blocks and fetching only missing ones. Web opens and edits Drafts offline.
  - DuckDB runs in a same-origin worker URL, not a blob wrapper, so its requests pass through the service worker. Caches are named per release, and the previous release's cache is kept while a client uses it. Reload sends `skipWaiting` to the waiting worker and reloads on `controllerchange`, so it never reloads into the old release.
  - W1 first proves two risks: a probe that the R2 host serves the wasm with Range and the CORS headers the worker needs, and a prototype of DuckDB offline through the service worker in Chromium, WebKit and Firefox (synchronous XHR from a worker under a service worker is unproven in WebKit).
  - Check: `web_release.py` refuses, on the merged set, a mutable asset name, a file over 25 MiB, a raw DuckDB wasm or a missing manifest entry; the deploy-skew e2e deploys N-1 and then N to a Pages preview project and drives an N-1 tab through a lazy chunk and a catalog read; an offline e2e opens a Draft and searches the kept catalog; a CI probe against the deployed site and the R2 host checks the range, CORS and cache headers.

## Alternatives rejected

- **A hand check per platform before release.** The user has only Linux.
- **A signed apt repository.** The user chose downloads only (2.1-Q126).
- **A macOS smoke, Developer ID or notarization now.** The user keeps the dmg as today for existing users and defers new macOS work (2.1-Q125, 2.1-Q135).
- **Screen readers as a blocking gate.** Automation is real only for VoiceOver and NVDA, and it is not yet stable enough to gate.

## Checks

- The lanes and checks named above (planned: Phase 0 F3 and F5, Phase 1 1a, Phase 2b, Phase 3 N1 and W1, Phase 4 D3).
