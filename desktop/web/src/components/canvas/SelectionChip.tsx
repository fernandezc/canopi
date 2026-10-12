import { useId, useRef, useState } from 'preact/hooks'
import { canvasCommandDefinitions } from '../../app/canvas-commands'
import { focusOwner } from '../../app/keyboard/focus-owner'
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
  return (
    <div className={styles.chip} role="group" aria-label={t('canvas.selectionChip.label')} data-selection-chip="bottom">
      <span className={styles.text} role="status" aria-live="polite">
        <b><SpeciesCommonName name={head} englishFallback={headEnglishFallback} /></b>
        {details.map((detail, index) => (
          <span key={index} className={detail.measure ? `${styles.muted} ${styles.measure}` : styles.muted}>
            {' · '}<SpeciesCommonName name={detail.text} englishFallback={detail.englishFallback} />
          </span>
        ))}
      </span>
      {row?.whole && <RowSpacing key={rowSpacingKey(row)} row={row} />}
      {row && !row.whole && (
        <button
          type="button"
          className={styles.button}
          onClick={() => currentCanvasSceneEditCommandSurface.value?.selectPlantRow?.()}
        >
          {t('canvas.selectionChip.selectRow')}
        </button>
      )}
      {wholeSpecies && (
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

/** A re-spaced row (an edit, an Undo) shows its own spacing again: the field starts over. */
function rowSpacingKey(row: CanvasSelectedPlantRow): string {
  const { spacing } = row
  return `${row.id}:${row.plants}:${spacing.kind === 'interval' ? `${spacing.metres}m` : spacing.count}`
}

/**
 * A selected row's spacing: every N m or N plants, the first counted. Enter re-spaces the row and gives the map its
 * focus back; leaving an edited field re-spaces it too; Esc puts the row's spacing back. The switch only changes the
 * field, which it focuses: the row changes at Enter or on leaving. Never the device's Plant a row interval.
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

  const commit = (value: string): boolean => {
    const spacing = parseRowSpacing(mode, value)
    setInvalid(spacing === null)
    if (!spacing) return false
    edited.current = false
    currentCanvasSceneEditCommandSurface.value?.setPlantRowSpacing?.(row.id, spacing)
    return true
  }
  const switchTo = (next: 'interval' | 'count') => {
    if (next === mode) return
    setMode(next)
    setText(rowSpacingText(row, next))
    setInvalid(false)
    edited.current = false
    requestAnimationFrame(() => input.current?.select())
  }

  return (
    <span className={styles.rowSpacing}>
      <span className={styles.modes} role="group" aria-label={t('canvas.plantSpacing.mode')}>
        {(['interval', 'count'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={styles.mode}
            aria-pressed={mode === option}
            data-plant-row-mode={option}
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
          } else if (commit(event.currentTarget.value)) {
            focusOwner.focusMap()
          }
        }}
        onBlur={(event) => {
          if (edited.current) commit(event.currentTarget.value)
        }}
      />
    </span>
  )
}

/** The field's text for `mode`: the row's own spacing, else where the other mode starts (today's gap or plants). */
function rowSpacingText(row: CanvasSelectedPlantRow, mode: 'interval' | 'count'): string {
  if (mode === 'count') return String(row.spacing.kind === 'count' ? row.spacing.count : row.plants)
  return formatPlantSpacingIntervalInput(row.spacing.kind === 'interval' ? row.spacing.metres : row.gapM)
}

function parseRowSpacing(mode: 'interval' | 'count', text: string): CanvasPlantRowSpacing | null {
  if (mode === 'count') {
    const parsed = parsePlantRowCountInput(text)
    return parsed.valid ? { kind: 'count', count: parsed.count } : null
  }
  const parsed = parsePlantSpacingIntervalInput(text)
  return parsed.valid ? { kind: 'interval', metres: parsed.meters } : null
}
