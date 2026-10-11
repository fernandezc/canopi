import type { FunctionComponent, RefObject } from 'preact'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { armCanvasTool } from '../../app/keyboard/arming'
import { focusOwner } from '../../app/keyboard/focus-owner'
import { useEnglishFallbackNames } from '../../app/plant-finder/catalog-names'
import { toolCardContent, type SavedStampSummary } from '../../app/tool-card/content'
import { modKeyName } from '../../app/shell-commands/shortcut-text'
import { siteLocateOpen } from '../../app/site-onboarding/state'
import { phoneLayout } from '../../app/shell/phone-layout'
import { readPlantStampSource, type PlantStampSource } from '../../canvas/plant-stamp-source'
import { speciesPlacementAppearance } from '../../canvas/runtime/species-key'
import type { PlantSymbolId } from '../../canvas/runtime/scene'
import {
  readSavedObjectStampName,
  readSavedObjectStampSource,
} from '../../canvas/saved-object-stamp-source'
import {
  currentCanvasQuerySurface,
  currentCanvasTool,
  currentCanvasToolCommandSurface,
  currentCanvasToolGuidance,
} from '../../canvas/session'
import type { CanvasPlantRowGuidance, CanvasToolGuidance } from '../../canvas/session-state'
import { scrollWheel } from '../../app/settings/state'
import { t } from '../../i18n'
import { ControlIcon } from '../shared/ControlIcon'
import { SpeciesCommonName } from '../shared/SpeciesIdentity'
import { PlantSymbolGlyph } from './PlantSymbolGlyph'
import { SpeciesChooser } from './SpeciesChooser'
import { ToolIcon } from './toolbar-icons'
import { displayedPlantColor } from '../../app/plant-display/state'
import styles from './ToolCard.module.css'

/** What the tool card hands its stamp chooser (`StampChooser`, Desktop). */
export interface StampChooserProps {
  onChosen(): void
  onEscape(): void
}

/**
 * The tool card, top left beside the tool rail: the tool's name, the live
 * instruction (naming the chosen species or stamp) and quiet key hints that
 * end with what Esc does now. Select shows its name and one quiet line of
 * modifiers, Pan what a drag does. It hides in overview and while "Where is your site?" shows. The text is one polite live region that
 * stays mounted, so choosing a tool is announced. Place plants carries the
 * species chooser while no species is chosen, or after Change species; Place a
 * stamp opens its saved stamps with Change stamp; Plant a row carries its
 * spacing field below the text and the row's count at the card's foot (both
 * outside the live region) once a plant is picked, and from its first point
 * (U58) an [Interval | Plants] switch with the count field in Plants mode
 * and a loop's rounded gap beside the field, and in the foot the row's length,
 * the last-touched point's Sharp or Smooth corner and Delete point, and the
 * check button that plants the row (44 px targets after a finger). The text
 * and the fields scroll above the foot, which stays in view.
 */
export function ToolCard({ stampChooser: StampChooser }: {
  /** Place a stamp's saved-stamp chooser; editions without saved stamps offer none. */
  readonly stampChooser?: FunctionComponent<StampChooserProps>
}) {
  const tool = currentCanvasTool.value
  const guidance = currentCanvasToolGuidance.value
  const source = readPlantStampSource()
  const savedStamp = readSavedStampSummary()
  const overview = currentCanvasQuerySurface.value?.view.mode.value === 'overview'
  const [changingSpecies, setChangingSpecies] = useState(false)
  const species = usePlantStampSpeciesName(source)
  const [choosingStamp, setChoosingStamp] = useState(false)
  const coarsePointer = useCoarsePointer()
  const section = useRef<HTMLElement>(null)
  const content = siteLocateOpen.value || overview
    ? null
    : toolCardContent({
        tool,
        guidance,
        speciesName: species?.name ?? null,
        savedStamp,
        scrollWheel: scrollWheel.value,
        coarsePointer,
        modKey: modKeyName(t),
        translate: t,
      })
  const choosing = content?.tool === 'plant-stamp' && (source === null || changingSpecies)
  const lead = content ? cardLead(content.tool, source, guidance) : null
  // Each click on the map with no species chosen points to the chooser again.
  const prompts = useRef(0)
  const lastPrompt = useRef(false)
  if (guidance.promptSpecies && !lastPrompt.current) prompts.current += 1
  lastPrompt.current = guidance.promptSpecies

  const stampChooser = StampChooser && content?.chooser?.kind === 'stamp' ? content.chooser : null
  const row = content?.tool === 'plant-spacing' && guidance.plantRow?.phase === 'row' ? guidance.plantRow : null
  // From its first point the row is a path the card can plant, switch and edit (U58).
  const rowPath = row && (row.points ?? 0) >= 2 ? row : null
  const rowMode = row?.mode ?? 'interval'
  usePublishedBottom(section, content !== null)

  useEffect(() => {
    if (tool !== 'plant-stamp') setChangingSpecies(false)
    if (tool !== 'object-stamp' && tool !== 'saved-object-stamp') setChoosingStamp(false)
  }, [tool])

  function closeChooser(): void {
    setChangingSpecies(false)
    setChoosingStamp(false)
    // The map takes focus back once a species or stamp is chosen, or the chooser closes.
    focusOwner.focusMap()
  }

  /** Esc in the species chooser: with no species chosen the chooser is all Place plants holds, so Esc leaves the tool;
   *  after Change species it only closes the chooser. */
  function escapeSpeciesChooser(): void {
    if (!source) armCanvasTool('select', { from: 'card' })
    closeChooser()
  }

  return (
    <section
      ref={section}
      className={content ? styles.card : styles.idle}
      data-tool-card={content?.tool}
      data-phone={phoneLayout.value ?? undefined}
      data-row={row ? '' : undefined}
      data-touch={row && (coarsePointer || row.touch) ? '' : undefined}
      aria-label={content?.title}
    >
      {/* First in the DOM so the title and instruction wrap around it. */}
      {content?.chooser?.kind === 'species' && source && !changingSpecies && (
        <button type="button" className={styles.link} onClick={() => setChangingSpecies(true)}>
          {t('canvas.toolCard.changeSpecies')}
        </button>
      )}
      {stampChooser && !choosingStamp && (
        <button type="button" className={styles.link} onClick={() => setChoosingStamp(true)}>
          {t(stampChooser.held ? 'canvas.toolCard.changeStamp' : 'canvas.toolCard.chooseSavedStamp')}
        </button>
      )}
      {/* The text, then Plant a row's fields: on a row the part that scrolls above the foot. */}
      <div className={styles.body}>
        <div className={styles.live} role="status" aria-live="polite">
          {content && (
            <>
              <span className={styles.title}>
                {lead && <CardLead lead={lead} />}
                {content.title}
              </span>
              {/* The subject takes its own line, so a long name never breaks the instruction. */}
              {content.subject && (
                <b className={styles.subject}>
                  {content.tool === 'plant-stamp' && species?.englishFallback
                    ? <SpeciesCommonName name={content.subject} englishFallback />
                    : content.subject}
                </b>
              )}
              {content.instruction && (
                <span className={content.subject ? `${styles.instruction} ${styles.afterSubject}` : styles.instruction}>
                  {content.instruction}
                </span>
              )}
              <span className={styles.hints}>{content.hints}</span>
            </>
          )}
        </div>
        {row && (
          // Plant a row's fields, outside the live region; one container from the pick on, so the field stays mounted
          // (and focused) as points come and go.
          <div className={styles.fieldRow}>
            {(rowPath || rowMode === 'count') && <RowModeSwitch mode={rowMode} />}
            {rowMode === 'interval' && <SpacingField row={row} kind="interval" switched={rowPath !== null} />}
            {rowMode === 'count' && <SpacingField row={row} kind="count" switched />}
            {/* A loop's rounded gap beside the spacing it rounds; it moves with the points, so it is not announced. */}
            {rowPath?.loopSpacing && (
              <span className={styles.fact} aria-live="off">
                {t('canvas.plantSpacing.loopSpacing')} <b data-plant-row-loop-spacing>{rowPath.loopSpacing}</b>
              </span>
            )}
          </div>
        )}
      </div>
      {row && (content?.rowCount || rowPath) && (
        // The row's count and length, and the check button that plants that row: the card's foot, in view
        // whatever the card holds. They move with every pointer move, so they are not announced.
        <div className={styles.rowFoot} data-path={rowPath ? '' : undefined}>
          <span className={styles.facts}>
            {content?.rowCount && (
              <span className={styles.count} aria-live="off" data-plant-spacing-generated-count data-density={content.rowCount.density}>
                {content.rowCount.text}
              </span>
            )}
            {rowPath?.length && (
              <span className={styles.fact} aria-live="off" data-plant-row-length>
                {t('canvas.plantSpacing.length')} <b>{rowPath.length}</b>
              </span>
            )}
          </span>
          {rowPath && <RowActions row={rowPath} />}
        </div>
      )}
      {choosing && (
        <SpeciesChooser
          autoFocus={changingSpecies}
          focusRequest={prompts.current}
          onChosen={closeChooser}
          onEscape={escapeSpeciesChooser}
        />
      )}
      {StampChooser && stampChooser && choosingStamp && <StampChooser onChosen={closeChooser} onEscape={closeChooser} />}
    </section>
  )
}

/**
 * The chosen species as the card names it: its name in the interface language, else
 * its English catalog name marked "(en)" (from the runtime for Design species, from
 * the catalog for the others), else the name saved with the source, else the
 * scientific name.
 */
function usePlantStampSpeciesName(source: PlantStampSource | null): { name: string; englishFallback: boolean } | null {
  const queries = currentCanvasQuerySurface.value
  void queries?.revision.plantNames.value
  const catalogEnglish = useEnglishFallbackNames(source && !source.common_name
    ? [{ canonicalName: source.canonical_name, commonName: null }]
    : NO_SPECIES)
  if (!source) return null
  const canonicalName = source.canonical_name
  const localized = queries?.getLocalizedCommonNames().get(canonicalName)
  if (localized) return { name: localized, englishFallback: false }
  const runtimeEnglish = queries?.getEnglishFallbackNames().get(canonicalName)
  if (runtimeEnglish) return { name: runtimeEnglish, englishFallback: true }
  if (source.common_name) return { name: source.common_name, englishFallback: false }
  const english = catalogEnglish.get(canonicalName)
  return english ? { name: english, englishFallback: true } : { name: canonicalName, englishFallback: false }
}

const NO_SPECIES: readonly { canonicalName: string }[] = []

type Lead = { readonly kind: 'species'; readonly symbol: PlantSymbolId; readonly color: string } | { readonly kind: 'stamp' }

/** The glyph at the start of the card: the species a click places or a row repeats, or the stamp. */
function cardLead(tool: string, source: PlantStampSource | null, guidance: CanvasToolGuidance): Lead | null {
  if (tool === 'plant-stamp' && source) {
    const scene = currentCanvasQuerySurface.value?.getSceneSnapshot()
    const appearance = speciesPlacementAppearance(
      scene ?? { plantSpeciesSymbols: {}, plantSpeciesColors: {} },
      { canonicalName: source.canonical_name, stratum: source.stratum },
    )
    return { kind: 'species', ...appearance, color: displayedPlantColor(appearance.color, source.canonical_name) }
  }
  if (tool === 'plant-spacing' && guidance.plantRow?.glyph) return { kind: 'species', ...guidance.plantRow.glyph }
  if ((tool === 'object-stamp' && guidance.stamp) || tool === 'saved-object-stamp') return { kind: 'stamp' }
  return null
}

function CardLead({ lead }: { readonly lead: Lead }) {
  if (lead.kind === 'stamp') {
    return <span className={styles.lead} aria-hidden="true" data-tool-card-lead="stamp"><ToolIcon name="object-stamp" /></span>
  }
  return (
    <span className={styles.lead} aria-hidden="true" data-tool-card-lead="species" style={{ color: lead.color }}>
      <PlantSymbolGlyph symbol={lead.symbol} size={22} />
    </span>
  )
}

/** Plant a row's [Interval | Plants] switch: every N m, or N plants with the picked one counted. */
function RowModeSwitch({ mode }: { readonly mode: 'interval' | 'count' }) {
  const path = currentCanvasToolCommandSurface.value?.plantRowPath
  return (
    <span className={styles.modes} role="group" aria-label={t('canvas.plantSpacing.mode')}>
      {(['interval', 'count'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={styles.mode}
          aria-pressed={mode === option}
          data-plant-row-mode={option}
          onClick={() => path?.setMode(option)}
        >
          {t(option === 'interval' ? 'canvas.plantSpacing.modeInterval' : 'canvas.plantSpacing.modeCount')}
        </button>
      ))}
    </span>
  )
}

/**
 * The last-touched point's buttons and the check button that plants the row. Each gives the map its focus back, so
 * Enter and Esc reach the row again.
 */
function RowActions({ row }: { readonly row: CanvasPlantRowGuidance }) {
  const path = currentCanvasToolCommandSurface.value?.plantRowPath
  const point = row.touchedPoint ?? null
  const run = (action: () => void) => () => {
    action()
    focusOwner.focusMap()
  }
  return (
    <span className={styles.rowActions}>
      {point && (
        <span className={styles.pointButtons}>
          <button type="button" className={styles.pointButton} data-plant-row-point-action={point.sharp ? 'smooth-corner' : 'sharp-corner'} onClick={run(() => path?.pointAction(point.sharp ? 'smooth-corner' : 'sharp-corner'))}>
            {/* The corner the press makes: a curve through the point, or an angle at it. */}
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
              <path d={point.sharp ? 'M4 15.5C4 6 16 6 16 15.5' : 'M4 15.5L10 4.5l6 11'} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span className={styles.actionLabel}>{t(point.sharp ? 'canvas.point.smooth' : 'canvas.point.sharp')}</span>
          </button>
          <button type="button" className={styles.pointButton} data-plant-row-point-action="delete-point" disabled={!point.canDelete} onClick={run(() => path?.pointAction('delete-point'))}>
            <ControlIcon name="trash" />
            <span className={styles.actionLabel}>{t('canvas.point.delete')}</span>
          </button>
        </span>
      )}
      <button type="button" className={styles.finish} data-plant-row-finish onClick={run(() => path?.finish())}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {/* On phones only the icons show, so the foot keeps one line; the names stay for assistive technology. */}
        <span className={styles.actionLabel}>{t('canvas.toolCard.pathFinish')}</span>
      </button>
    </span>
  )
}

/**
 * Plant a row's spacing: the runtime keeps the text and parses it; Enter keeps
 * a valid spacing and gives the map focus back, Esc steps the row back as on
 * the map (the last point, else the picked plant),
 * and leaving the field keeps a valid spacing without moving focus. In Plants
 * mode the same field takes the count (the picked plant counted). Beside the
 * mode switch (`switched`) its label is read, not shown: the switch names it.
 */
function SpacingField({ row, kind, switched = false }: {
  readonly row: CanvasPlantRowGuidance
  readonly kind: 'interval' | 'count'
  readonly switched?: boolean
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const focused = useRef(0)
  const field = currentCanvasToolCommandSurface.value?.plantRowSpacing
  const count = kind === 'count'

  useLayoutEffect(() => {
    if (row.focusRequest === focused.current) return
    focused.current = row.focusRequest
    // The focus scrolls the card's text and fields to the field: once the row grows, the field may sit below their fold.
    input.current?.focus()
  }, [row.focusRequest])

  return (
    <span className={styles.field}>
      <label className={switched ? styles.hiddenLabel : styles.fieldLabel} for={id}>{t(count ? 'canvas.plantSpacing.count' : 'canvas.plantSpacing.interval')}</label>
      <input
        ref={input}
        id={id}
        className={styles.fieldInput}
        type="text"
        inputMode={count ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellcheck={false}
        value={count ? row.countText ?? '' : row.interval}
        aria-invalid={count ? row.countValid === false : !row.intervalValid}
        {...(count ? { 'data-plant-row-count-input': '' } : { 'data-plant-spacing-interval-input': '' })}
        onInput={(event) => field?.input(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return
          // Enter and Esc inside an IME composition are the IME's (WebKit sends the key that ends one with keyCode 229).
          if (event.isComposing || event.keyCode === 229) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Enter') field?.commit(event.currentTarget.value)
          else field?.cancel()
        }}
        onBlur={(event) => field?.blur(event.currentTarget.value)}
      />
    </span>
  )
}

function readSavedStampSummary(): SavedStampSummary | null {
  const payload = readSavedObjectStampSource()
  if (!payload) return null
  return {
    name: readSavedObjectStampName(),
    plants: payload.plants.length,
    species: new Set(payload.plants.map((plant) => plant.canonicalName)).size,
  }
}

/**
 * Publishes the shown card's bottom edge on the canvas area as `--tool-card-bottom` (px from the area's top), so the top
 * chip slot can sit below the card on phones (SpeciesFocusChip.module.css); removed while no card shows.
 */
function usePublishedBottom(ref: RefObject<HTMLElement>, shown: boolean): void {
  useLayoutEffect(() => {
    const card = ref.current
    const host = card?.parentElement
    if (!shown || !card || !host || typeof ResizeObserver === 'undefined') return
    const publish = () => host.style.setProperty('--tool-card-bottom', `${card.offsetTop + card.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(card)
    return () => {
      observer.disconnect()
      host.style.removeProperty('--tool-card-bottom')
    }
  }, [ref, shown])
}

const COARSE_POINTER_QUERY = '(pointer: coarse)'

/** Whether the primary pointer is coarse (a touch screen), following a mouse plugged in or out. */
function useCoarsePointer(): boolean {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(COARSE_POINTER_QUERY) : null
  const [coarse, setCoarse] = useState(query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const update = () => setCoarse(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return coarse
}
