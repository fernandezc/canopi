# Relief display and LiDAR fixes: 2.0 plan

Status: agreed 2026-10-15; build 2026-10-15 to 2026-10-17, release 2026-10-18 (canopi-2v5a). Quality decides, not the date (user, 2026-10-15): work that has not passed its review by Saturday evening drops in the order vggx, 44vf, seams, Relief, never ships rushed.

## 1. What users get

- **Relief** (canopi-2add): an imported MNT, MNS or MNH draws as IGN-style grey shaded relief by default; Colours is the other choice in the open item. Values, pin, Profile, slope and other analyses keep reading the numeric rasters.
- **Readable LiDAR failures** (canopi-bkbh, canopi-9m01, slice): no raw English reaches users. Import refusals are named in every locale; job failures show the existing generic message, with the detail kept for diagnostics.
- **Delete everywhere frees the disk** (canopi-44vf): the item's original and source COG go, unless another item still uses them.
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
| D6 | LiDAR errors: the slice above; the full typed reasons go to 2.1 (follow-up bead). |
| D7 | canopi-m6sm (keyless Satellite offline notice) stays out of 2.0 (Q12, 2026-10-13). |

## 3. Contracts

- **Shading.** Horn 3×3 with gdaldem's formula and defaults (z = 1), on the source file's own projected grid, before the web-map warp: shading after the nearest-neighbour warp draws a crosshatch (prototype, 2026-10-15). One-sided differences at file and NoData edges: per-file shading of an IGN 1 km file differs from whole-area shading by 0.8 grey on the joining column, invisible. GeoLibre's `run_shade_core` (whitebox-wasm `basic_terrain_tools.rs`) is a 5×5 Florinsky stencil; Horn is chosen to match IGN and the gdaldem test oracle (ADR 0002 reason).
- **Per-level.** Per file: average the elevation by 2 on the native grid, shade each level with its own cell size, warp each shaded level into the matching level of the display derivative. The COG writer gains one source per level; the elevation derivative keeps its averaged overviews.
- **Geographic sources.** A source in degrees gets its cell size in ground metres (cell × 111 320 m × cos(lat) east-west).
- **Model.** `LidarRamp::Relief`, listed first for the three kinds, so `null` means Relief; it draws with `gray` at 0–255 and hides Reverse, Legend and Range; the stored range is kept for Colours. The display request carries `relief: bool`; a relief derivative's key keeps the asset prefix `forget_asset_derivatives` matches. Relief is prepared on first request, not in the import job.
- **Format changes** to name at handoff: `ramp` gains `"Relief"`; `null` means Relief for MNT, MNS and MNH.

## 4. Streams

Cut by feature; files in `.rq-scratch/tools/relief-owners.tsv`, written in the amendment commit after the step's design-check brief re-verifies them. A stream owns its locale key namespace in all 11 locales.

| Stream | Beads | Owns (summary) | First commit |
|---|---|---|---|
| R | canopi-2add, canopi-f47t.49 | `display_cog.rs`, `rust_engine/{cog,mod}.rs`, new `rust_engine/relief.rs`, `app/lidar/{display,item-types,display-legend}.ts`, `RasterDisplayControls.tsx` and its CSS module, `siteData.display.*` keys, `docs/guides/data-library.md` | Probes: per-level writer on a real IGN tile against gdaldem; the seam counter through the real cog-tiler |
| L | canopi-bkbh, canopi-9m01, then canopi-44vf | `services/lidar/{admission,crs,import,paths,mod}.rs`, `commands/lidar.rs`, `fixed_library_tests.rs`, `app/lidar/actions.ts`, `ImportDataDialog`, `DataLibraryView`, `SiteData`, `canvas.lidar.failure.*` keys | Error slice, then the delete fix on the same branch |
| P | canopi-vggx | `app/lidar/profile.ts`, `ProfileChart.tsx`, `ControlIcon.tsx`, `profile.module.css`, `siteData.chart.*` keys | — |

Commit 0 (main agent): `LidarRamp::Relief`, the request's `relief` field, the refusal type for L, generated types, and each user path's test marked expected-fail. Release notes are the main agent's, at the merges.

## 5. Evidence

- Rust and Frontend gates of `AGENTS.md`, plus the shared-contract row and `native_command_policy::tests` (L changes commands).
- Live check on a review instance: import an IGN MNT and MNS (Villard-de-Lans, 45.07N 5.55E), Relief at full detail and zoomed out, file edges, rotation; Colours round trip; delete everywhere and check the disk; a failing import in French.
- One review round per stream; a second for R and for 44vf (it deletes from disk). Pre-push review of the whole diff.

## 6. Follow-ups to file

Full typed LiDAR failure reasons (2.1); live relief with screen-fixed light (needs raw tiles from cog-tiler upstream); seam causes inside cog-tiler, if the probe finds them, reported upstream. canopi-h90p.9.2 (hillshade analysis) is closed as replaced when Relief merges.
