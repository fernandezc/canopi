import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { canvasCommandDefinitions } from '../../app/canvas-commands'
import { focusOwner } from '../../app/keyboard/focus-owner'
import { phoneLayout } from '../../app/shell/phone-layout'
import { useMapSelectionSummary, type MapSelectionSummary } from '../../app/map-selection/summary'
import { describeMapSelection } from '../../app/map-selection/summary-text'
import { ariaKeyShortcuts } from '../../app/shell-commands/shortcut-text'
import { loneEditableZoneId, openRenameZoneDialog } from '../../app/rename-zone/state'
import { currentCanvasQuerySurface, currentCanvasSceneEditCommandSurface } from '../../canvas/session'
import { locale } from '../../app/settings/state'
import {
  formatPlantSpacingIntervalInput,
  parsePlantRowCountInput,
  parsePlantSpacingIntervalInput,
} from '../../canvas/plant-spacing-interval'
import type { CanvasPlantRowSpacing, CanvasSelectedPlantRow } from '../../canvas/runtime/runtime'
import { t } from '../../i18n'
import { SpeciesCommonName } from '../shared/SpeciesIdentity'
import styles from './SelectionChip.module.css'

/**
 * The bottom status chip that names the map selection ("Apricot", "12 plants ·
 * 3 species · 0.52 m apart", "Zone · Z04 · 118 m² · 46 m", "Rectangle zone ·
 * 120 m² · 44 m") in the visible map area, above the view chip and
 * the zoom group, so it never meets the top finder chip. It reads the
 * selection through read-only runtime queries and offers Select all of this
 * species, Rename… for a lone zone and Clear selection; the rest lives in the
 * right-click menu. On some plants of a planted row it offers Select row, which
 * selects all of them, so Select shows the row's points; on a selected row it
 * shows the row's spacing and its [Interval | Plants] switch, which re-space the
 * row (plan §4 "2.0 plant along a path", A7).
 */
const SELECT_SAME_SPECIES = canvasCommandDefinitions.find((definition) =>
  definition.kind === 'edit' && definition.id === 'select-same-species')!

export function SelectionChip() {
  const summary = useMapSelectionSummary()
  const queries = currentCanvasQuerySurface.value
  const overview = queries?.view.mode.value === 'overview'
  if (!summary || overview) return null
  const { head, headEnglishFallback, details } = describeMapSelection(summary, locale.value)
  const [only] = summary.species
  const wholeSpecies = summary.species.length === 1 && isOnlyPlants(summary) && only!.selectedCount < only!.designCount
  // The summary hook re-renders the chip on selection and scene changes (locks included).
  const renameZoneId = loneEditableZoneId(queries?.getDesignObjectSelection() ?? null)
  const row = queries?.getSelectedPlantRow?.() ?? null
  // On a phone a selected row's spacing takes the place of Select all of this species (the canvas menu keeps it) and
  // of the plants' distance apart (the spacing stands for it), so the chip stays short.
  const shortRow = row?.whole === true && phoneLayout.value !== null
  return (
    <div className={styles.chip} role="group" aria-label={t('canvas.selectionChip.label')} data-selection-chip="bottom">
      <span className={styles.text} role="status" aria-live="polite">
        <b><SpeciesCommonName name={head} englishFallback={headEnglishFallback} /></b>
        {details.filter((detail) => !(shortRow && detail.measure)).map((detail, index) => (
          <span key={index} className={detail.measure ? `${styles.muted} ${styles.measure}` : styles.muted}>
            {' · '}<SpeciesCommonName name={detail.text} englishFallback={detail.englishFallback} />
          </span>
        ))}
      </span>
      {row?.whole && <RowSpacing key={row.id} row={row} />}
      {row && !row.whole && (
        <button
          type="button"
          className={styles.button}
          onClick={() => currentCanvasSceneEditCommandSurface.value?.selectPlantRow?.()}
        >
          {t('canvas.selectionChip.selectRow')}
        </button>
      )}
      {wholeSpecies && !shortRow && (
        <button
          type="button"
          className={styles.button}
          aria-keyshortcuts={SELECT_SAME_SPECIES.shortcuts?.[0] ? ariaKeyShortcuts(SELECT_SAME_SPECIES.shortcuts[0]) : undefined}
          onClick={() => currentCanvasSceneEditCommandSurface.value?.selectSpecies([only!.canonicalName])}
        >
          {t(SELECT_SAME_SPECIES.labelKey)}
        </button>
      )}
      {renameZoneId !== null && (
        <button
          type="button"
          className={styles.button}
          aria-haspopup="dialog"
          onClick={() => openRenameZoneDialog({
            zoneId: renameZoneId,
            name: summary.zones[0]?.name ?? null,
            rename: (zoneId, name) => currentCanvasSceneEditCommandSurface.value?.renameZone(zoneId, name),
          })}
        >
          {t('canvas.selectionChip.rename')}
        </button>
      )}
      <button
        type="button"
        className={styles.quiet}
        onClick={() => currentCanvasSceneEditCommandSurface.value?.clearSelection()}
      >
        {t('canvas.selectionChip.clear')}
      </button>
    </div>
  )
}

function isOnlyPlants(summary: MapSelectionSummary): boolean {
  return summary.zones.length === 0 && summary.noteCount === 0 && summary.measurementCount === 0
}

/** What a re-spaced row (an edit, an Undo) changes: the field then shows the row's own spacing again. */
function rowSpacingKey(row: CanvasSelectedPlantRow): string {
  const { spacing } = row
  return `${row.id}:${row.spots}:${spacing.kind === 'interval' ? `${spacing.metres}m` : spacing.count}:${row.locked}`
}

/**
 * A selected row's spacing: every N m or N plants, the first counted. Enter re-spaces the row with an edited spacing
 * and gives the map its focus back; leaving an edited field re-spaces it too; Esc puts the row's spacing back. The
 * switch re-spaces the row from where the other mode starts (its spots now, or its exact gap now, which the field may
 * show rounded) and focuses the field (A7: at Enter, blur or switch). A spacing the row refuses is marked invalid. Never the device's Plant a row interval. A locked row (a
 * locked plant, or the Plants layer) shows both disabled.
 */
function RowSpacing({ row }: { readonly row: CanvasSelectedPlantRow }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'interval' | 'count'>(row.spacing.kind)
  const [text, setText] = useState(() => rowSpacingText(row, row.spacing.kind))
  const [invalid, setInvalid] = useState(false)
  // Read by the blur that follows a commit's re-render: an edit not yet kept.
  const edited = useRef(false)
  const count = mode === 'count'

  // The row changed: the field starts over at its spacing, staying mounted so the switch or field keeps its focus.
  const key = rowSpacingKey(row)
  const shownKey = useRef(key)
  useEffect(() => {
    if (shownKey.current === key) return
    shownKey.current = key
    setMode(row.spacing.kind)
    setText(rowSpacingText(row, row.spacing.kind))
    setInvalid(false)
    edited.current = false
  }, [key])

  // A spacing that does not parse, or that the row refuses (no plant fits, or too many), is invalid.
  const commit = (spacing: CanvasPlantRowSpacing | null): boolean => {
    const taken = spacing !== null && currentCanvasSceneEditCommandSurface.value?.setPlantRowSpacing?.(row.id, spacing) === true
    setInvalid(!taken)
    if (taken) edited.current = false
    return taken
  }
  // The switch applies the row's exact gap or spots, never the field's rounded text, so it moves no plant and the
  // row it makes is the one the field shows: its arrival keeps what the user has typed since.
  const switchTo = (next: 'interval' | 'count') => {
    if (next === mode) return
    const spacing = rowSpacingAs(row, next)
    setMode(next)
    setText(rowSpacingText(row, next))
    edited.current = false
    if (commit(spacing)) shownKey.current = rowSpacingKey({ ...row, spacing })
    requestAnimationFrame(() => input.current?.select())
  }

  // The switch and the field are the chip's own items, so on a narrow phone the field shares Clear's line.
  return (
    <>
      <span className={styles.modes} role="group" aria-label={t('canvas.plantSpacing.mode')}>
        {(['interval', 'count'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={styles.mode}
            aria-pressed={mode === option}
            data-plant-row-mode={option}
            disabled={row.locked}
            onClick={() => switchTo(option)}
          >
            {t(option === 'interval' ? 'canvas.plantSpacing.modeInterval' : 'canvas.plantSpacing.modeCount')}
          </button>
        ))}
      </span>
      <label className={styles.hiddenLabel} for={id}>{t(count ? 'canvas.plantSpacing.count' : 'canvas.plantSpacing.interval')}</label>
      <input
        ref={input}
        id={id}
        className={styles.field}
        type="text"
        inputMode={count ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellcheck={false}
        value={text}
        disabled={row.locked}
        aria-invalid={invalid}
        {...(count ? { 'data-plant-row-count-input': '' } : { 'data-plant-row-spacing-input': '' })}
        onInput={(event) => {
          edited.current = true
          setText(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return
          // Enter and Esc inside an IME composition are the IME's (WebKit sends the key that ends one with keyCode 229).
          if (event.isComposing || event.keyCode === 229) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') {
            edited.current = false
            setText(rowSpacingText(row, mode))
            setInvalid(false)
          } else if (edited.current ? commit(parseRowSpacing(mode, event.currentTarget.value)) : !invalid) {
            // An unedited field keeps the row as it is: its text may round the row's gap.
            focusOwner.focusMap()
          }
        }}
        onBlur={(event) => {
          if (edited.current) commit(parseRowSpacing(mode, event.currentTarget.value))
        }}
      />
    </>
  )
}

/** The field's text for `mode`: the row's own spacing, else where the other mode starts (today's gap or spots). */
function rowSpacingText(row: CanvasSelectedPlantRow, mode: 'interval' | 'count'): string {
  if (mode === 'count') return String(row.spacing.kind === 'count' ? row.spacing.count : row.spots)
  return formatPlantSpacingIntervalInput(row.spacing.kind === 'interval' ? row.spacing.metres : row.gapM)
}

/** The spacing `mode` gives the row as it stands: its own, else its spots now or its gap now. */
function rowSpacingAs(row: CanvasSelectedPlantRow, mode: 'interval' | 'count'): CanvasPlantRowSpacing {
  if (row.spacing.kind === mode) return row.spacing
  return mode === 'count' ? { kind: 'count', count: row.spots } : { kind: 'interval', metres: row.gapM }
}

function parseRowSpacing(mode: 'interval' | 'count', text: string): CanvasPlantRowSpacing | null {
  if (mode === 'count') {
    const parsed = parsePlantRowCountInput(text)
    return parsed.valid ? { kind: 'count', count: parsed.count } : null
  }
  const parsed = parsePlantSpacingIntervalInput(text)
  return parsed.valid ? { kind: 'interval', metres: parsed.meters } : null
}
