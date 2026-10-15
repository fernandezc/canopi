# Relief display and LiDAR fixes: 2.0 plan

Status: agreed 2026-10-15, amended by the step's design check the same day (`.rq-scratch/gate-logs/relief-step-design-check.md`); build 2026-10-15 to 2026-10-17, release 2026-10-18 (canopi-2v5a). Quality decides, not the date (user, 2026-10-15): work that has not passed its review by Saturday evening drops in the order vggx, 44vf, seams, Relief, never ships rushed.

## 1. What users get

- **Relief** (canopi-2add): an imported MNT, MNS or MNH draws as IGN-style grey shaded relief by default; Colours is the other choice in the open item. Values, pin, Profile, slope and other analyses keep reading the numeric rasters.
- **Readable LiDAR failures** (canopi-bkbh, canopi-9m01, slice): no raw English reaches users. Import and Retry refusals are named in every locale; job failures show the existing generic message, with the detail kept for diagnostics.
- **Delete everywhere frees the disk** (canopi-44vf): the item's original, source COG and display derivatives go, unless another item still uses them.
- **A failed profile read says so** (canopi-vggx), with Retry; Copy values gets the board's copy icon.
- **Raster tile seams** (canopi-f47t.49): probed first; fixed in 2.0 only if the cause is Canopi's code.

## 2. User decisions (2026-10-15)

| # | Decision |
|---|---|
| D1 | Relief is precomputed, like IGN's LiDAR HD layers (`IGNF_LIDAR-HD_*_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW`), not live. Option C (IGN's relief tiles as a map layer) is dropped. |
| D2 | Light from the northwest (azimuth 315°, altitude 45°), grey only, Relief the default for MNT, MNS and MNH. |
| D3 | Each zoom level is shaded from that level's own averaged elevation (per-level), not averaged from the full-detail shading. |
| D4 | The light turns with a rotated map, as on IGN's maps; no hint. |
| D5 | No backward compatibility: a stored `ramp: null` on those kinds now draws as Relief. |
| D6 | LiDAR errors: the slice above; the full typed reasons go to 2.1 (canopi-q70t). |
| D7 | canopi-m6sm (keyless Satellite offline notice) stays out of 2.0 (Q12, 2026-10-13). |
| D8 | The import prepares the kind's default view: Relief for MNT, MNS and MNH, so a new item draws at once; Colours is prepared the first time it is picked. |
| D9 | Delete everywhere while another raster job runs deletes at once; its files are freed straight away when nothing else runs, otherwise at the next start. |

## 3. Contracts

- **Identity.** The display variant is part of a derivative's identity: Rust `plan_key(kind, entity, generation, relief)` and TS `displayKey(kind, id, generation, variant)`, so Relief and Colours never share a pending plan, cache entry or failure. One `displayVariant(itemType, entry)` in `item-types.ts` derives it from the resolved ramp; display, preview and Site data all call it. A relief derivative's key is the asset key plus `-relief`, inside the prefix `forget_derivatives` matches.
- **Shading.** Horn 3×3 with gdaldem's formula and defaults (z = 1), on the source file's own projected grid, before the nearest-neighbour web-map warp (shading after it draws a crosshatch, prototype). One-sided differences at file and NoData edges. Stored as Float32 integers 1–255 with the display NoData. GeoLibre's `run_shade_core` is a 5×5 Florinsky stencil; Horn is chosen to match IGN and the gdaldem oracle (ADR 0002 reason).
- **Per-level.** The relief derivative has exactly the elevation derivative's level count. Native level k is k stacked `cog::Halved` readers over the source (made `pub(super)`, no second averager); level k is shaded with its own ground cell size and warped onto lattice level k by `warp.rs`. The COG writer takes one source per level.
- **Memory.** The relief writer holds at most the extraction budget (25 M cells) plus one streamed chunk and one tile, about 165 MB for any source; a `Shaded` reader takes window plus a one-cell halo from the stack. Proved by an `extraction_limit_probe` test; output written in several windows is bit-identical to one window.
- **Ground size.** East-west and north-south cell sizes are computed per row: degrees through the WGS84 radii of `cell_ground_size_m`, EPSG:3857 as nominal × cos(lat), other projected grids nominal (as gdaldem); a new per-axis function beside `cell_ground_size_m`, whose callers stay unchanged.
- **Model.** `LidarRamp::Relief`, listed first for the three kinds, so `null` means Relief; it draws with `gray` at 0–255 and hides Reverse, Legend and Range; the stored range and Reverse are kept for Colours; Reset stays reachable. The swatch is a fixed shaded-hill image from `legendGradient('Relief')`. Cut outliers reads and stores only the elevation derivative. Derived items (no analysis outputs an elevation kind in 2.0, guarded by a registry test) get `Unavailable` for a relief request.
- **Freshness.** The relief fixture's bytes enter `profile_digest_inputs`, so a shading change bumps the display profile.
- **Refusals.** `LidarImportRefusal` (common-types, tagged `kind`) is returned by Import and Retry: TooManyFiles, SourceTooLarge, ImportTooLarge, SourceMissing, Unreadable, NotGeotiff, NoCrs, UnsupportedCrs, JobRunning, LibraryUnavailable, Internal. The probe chain returns `ProbeError`. The frontend's one mapper (`lidar-failures.ts`) gives each kind its `canvas.lidar.failure.*` string and anything else the generic one, with the detail sent to diagnostics; a job row never shows stored text.
- **Delete.** Delete drops the entity's queued display plans, then forgets every no-longer-referenced COG's derivatives and each deleted generation's; a failing remove is logged and never fails a committed Delete. At start, after the unreferenced-assets prune and when no job runs, rows of `display_cogs` whose source or generation is gone are dropped with their files (D9).
- **Profile.** A failed read shows a read-failed state with a Retry the user presses (no automatic retry); the copy icon is 16 px.
- **Format changes** to name at handoff: `ramp` gains `"Relief"`; `null` means Relief for MNT, MNS and MNH; the display profile digest changes.

## 4. Streams

Files and owners: `.rq-scratch/tools/relief-owners.tsv` (`c0` is commit 0, `*` shared by locale key namespace or main agent only). A stream owns its locale key namespace in all 11 locales: R `siteData.display.*`, L `canvas.lidar.failure.*`, `canvas.lidar.layers.failed` and `analyses.details.refreshFailed`, P `siteData.chart.*`.

| Stream | Beads | First commit |
|---|---|---|
| R | canopi-2add, canopi-f47t.49 | Probes, stopping if the first two fail: the per-level writer on the real IGN LiDAR HD tile against gdaldem (ignored comparison-lane test, interior within ±1 grey, edges counted); the seam counter (gap, step, under-line) through the real cog-tiler. Then the relief fixture through the real cog-tiler, the memory high-water test, one plane in Lambert-93, EPSG:4326 and EPSG:3857 shading alike within 1 grey, the swatch in WebKitGTK and Chromium |
| L | canopi-bkbh, canopi-9m01, then canopi-44vf | The typed refusals of Import and Retry (EPSG:2263 gives UnsupportedCrs), then the delete fix on the same branch: a delete during a held import keeps that import intact and frees the item's files at the next start; a failing remove leaves Delete Ok. Delete waits only for the deleted item's own cancelled jobs |
| P | canopi-vggx | — |

Commit 0 (main agent): the contracts above (ramp, request `relief` field and descriptor echo, refusal type, `ProbeError`, variant keys, derivative prefix helpers, `readLidarEntryDisplay`), generated types, and each user path's test marked expected-fail with its owner and bead. Commit 0's R tests include D8: a new MNT draws Relief straight after import, Colours is prepared on first pick. The free-space ask is unchanged (its 5× term covers the relief output). Release notes are the main agent's, at the merges.

## 5. Evidence

- Rust and Frontend gates of `AGENTS.md`, plus the shared-contract row and `native_command_policy::tests` (L changes commands).
- Live check on a review instance: import an IGN MNT and MNS (Villard-de-Lans, 45.07N 5.55E; tiles kept in `.rq-scratch/relief-data/`), Relief at full detail and zoomed out, file edges, rotation; Colours round trip; delete everywhere and check the disk; a failing import in French.
- One review round per stream; a second for R and for 44vf (it deletes from disk). Pre-push review of the whole diff.

## 6. Follow-ups to file

Full typed LiDAR failure reasons (canopi-q70t, 2.1); live relief with screen-fixed light (canopi-jfa9); relief for Windows parts and derived elevation, when an analysis first outputs one; seam causes inside cog-tiler, if the probe finds them, reported upstream. canopi-h90p.9.2 (hillshade analysis) is closed as replaced when Relief merges.
