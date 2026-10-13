# Canvas workspace

Read the [design system](../system.md) and [canvas navigation](canvas-navigation.md) first. Runtime: [map workspace](../../docs/guides/map-workspace.md). Boards: Workspace, Navigation, SiteFound, Overview, NamesOnMap, PlacePlants, PlantRow, StampPlace, Selection, Appearance, ZoneDraw, ZoneSelected, MeasureText, StoryPresent, StoryPhone.

## Chrome

- Tool rail: groups separated by rules; the active tool solid ochre with `aria-pressed`; arrows move between tools. Labels and key hints show until a tool's first use (per device), then 52 px icons with tooltips. The labelled rail is 224 px; it keeps to icons when it would leave under 360 px of map or cut a label.
- In a short window the last tools fold, in order, into More tools before Undo and Redo, which never fold. The rail never scrolls or covers the view chip. The panel rail folds the same way and never covers the inspection launcher or the zoom group.
- View chip: Grid and Snap to grid as pressed toggles with a check icon; only Snap is on by default.
- Zoom group: scale bar, zoom out, scale ratio (a menu of common scales), zoom in, Fit to Design (Shift F), then the compass. The attribution pill sits left of it, folding into an (i) button only when its band leaves under 360 px.
- Below 0.1 px/m the Design is one pin ("Return to …"), editing tools are disabled and a top-centre chip says "Zoom in to edit. Plants are hidden at this scale."
- The map is a keyboard stop with the focus ring inside its edge, one of the four F6 areas. Arrows pan 64 px with nothing selected, else nudge 10 cm (one undo per series); Ctrl or Cmd: 256 px or 1 m; locked objects stay put.

## Map annotations

- Measurements: light tag (95% surface, ink, 13/600, tabular); the live value a dark tag. Zone names and notes follow the map, not the UI theme: cream with a dark halo over satellite and the Dark basemap, dark with a cream halo over light maps and paper; no pill. Lengths: one decimal below 100 m, none above, two below 1 m; areas in ha or m².
- Every overlay stroke has a dark casing.
- Highlight rings (finder matches, panels pointing at plants): solid ochre, 2 px over a 5 px halo, at least 8 px radius. Panels never mark a plant with a filled disc or a colour of their own.
- Labels (View › Labels ▸ None, Codes, Names; Shift L cycles): haloed text, thinned so no label touches a label or symbol. A saved view records the choice. Pinned names and a single selection's name always show; phones show no pinned-names legend.

## Selection and the right-click menu

- Selection box: 2 px ochre over a 5 px cream casing, no corner handles, an ochre ring on each selected plant. Rotatable selections keep one rotate handle above, inside the map area; a selected polygon adds its points and dots. No action bar.
- Status chip (bottom centre) names the selection: "12 plants · 3 species · 0.8 m apart", "Zone · Z04 · 118 m² · 46 m"; groups count as their members. Never an id. It carries Select all of this species (Ctrl Shift A), Rename… (one unlocked zone) and Clear selection, and no row controls; hidden in overview and during "Where is your site?".
- A still right-click on an object selects it and opens the context menu in plain words with the menu bar's shortcuts, under a quiet heading in the chip's words (its accessible name). Groups: Cut, Copy, Paste, Duplicate · plants: Select all of this species, Plant color ▸, Plant symbol ▸, Show name / Hide name, Species details · Add to calendar…, Set unit cost… · Arrange ▸ (Bring to front, Send to back · Group, Ungroup), Rotate…, Save as stamp (Desktop) · Lock, Unlock · Delete, last, in danger red.
- Zones get the menu without the plant group and Set unit cost…; a lone zone adds Rename zone… after Duplicate (disabled while locked): a small modal, one Undo. A still right-click on the empty map: Place plants here, Paste (at the pointer), Select all; the selection is kept.
- Items that do not apply stay listed with `aria-disabled`. The menu fits its longest label and shortcut (up to 400 px), at the pointer or below the selection by keyboard (Menu key, Shift F10), in view.

## Rotate…

A modal (Edit › Rotate…, the menu, Ctrl Alt R), "Rotate selection": Angle in degrees, −15° and +15° steps, a hint (about the centre, positive clockwise), Cancel and Rotate. One Undo.

## Tools

- Tool cards (320 px): the species glyph (map colour) or stamp icon before the name; the subject (bold) on its own line, the instruction under it; key hints ending with what the next Esc does ("Esc to clear the stamp", "Esc to clear the row" (picked plant only), "Esc or Backspace removes the last point" (row, Profile; Polygon: corner), "Esc to stop placing", "Esc to cancel", "Esc to go back to Select"). Select: one quiet line of its gestures (pinch, not wheel, on a trackpad).
- On phones cards and chips dock, one at a time, in the [context bar](controls-and-shell.md#web-on-phones); Select and Pan: no card.
- Place plants arms without a species; the card holds a chooser (plant finder with Stratum and Form: this Design's species, Favorites, recent picks, "Open the full catalog").
- Place plants previews under the pointer: the symbol at 85% opacity, a dashed ring for the mature width (if known) and a dashed line to the nearest plant within 320 px.
- Plant a row: click a placed plant, then points along a curve (Alt: sharp; the first point closes a loop); Enter, double-click or the check button plants ordinary plants, left selected; dragging from it plants a straight row (Ctrl or Cmd skips snapping). Card: Interval (focused on pick) or Plants, length, live count (ochre when dense, red over the limit).
- Points (a row while drawn, zone corners): drag moves; a faint dot inserts on drag or double-click; Alt-click or Delete removes; right-click or long press: Delete point, Sharp or Smooth corner (rows). It closes when the Design, selection, tool or points change.
- Place a stamp previews the stamp as ghosts. [ and ] turn a held stamp by 15° about the pointer; placed objects keep the turn and the card says so.
- Polygon: click adds corners; the first corner, a double-click, Enter or Finish shape ends it. Esc, Backspace or Ctrl Z removes the last point (also Profile and rows), Ctrl Shift Z restores. Rectangle, Ellipse and Line drag. Shift keeps 45°, squares and circles on screen; live lengths and area. Text note: click places a field; Enter finishes, Shift Enter breaks a line, Esc restores. Measure: drag between two points; the line stays as a guide.
- Drawing never moves objects. Esc follows the [design system](../system.md)'s chain; closing a field the tool opened returns focus to the map.

## Symbol and colour

Plant color ▸ and Plant symbol ▸ open popovers beside the menu (Esc returns focus to the map). Symbols: 70 px tiles in four labelled groups (Plant form, What it gives, What it does, Abstract) as one radio group, 5 columns. Colours: named swatches as a radio group plus Custom color. Footer: "Apply to N selected" (secondary) and "Set for all <species>" (primary). Choices preview until applied.

## Inspection lens

A view-only magnified preview with recentre, widen and magnify, collision-aware labels, keyboard pan and an ochre source rectangle on the map.

## Presenting a story

The map fills the window; no editing chrome. A glass card (420 px, top left): muted "<story> · Step n of m", Literata 28 title, text, images, species tags, then Previous, dots (current wide, ochre), Next, key hint. Top right, a glass pill: name, Full screen (F), Leave (Esc). The map's notice, with Retry, sits centred at the bottom right of the card; below 772 px wide it spans the bottom and the card stops short of it. The map flies to each step's view and bearing, ringing highlights.

On phones: a top bar ("Step n of m", dots, 44 px Leave), the map's notice under it (on its side: bottom right of the card), the card a bottom sheet, full-width Previous/Next in reach, swipe, safe-area insets.
