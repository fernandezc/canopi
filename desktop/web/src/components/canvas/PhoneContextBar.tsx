import { useEffect } from 'preact/hooks'
import { phoneToolOptions } from '../../app/shell/phone-layout'
import { useMapSelectionSummary } from '../../app/map-selection/summary'
import { readPlantStampSource } from '../../canvas/plant-stamp-source'
import { currentCanvasQuerySurface, currentCanvasTool, currentCanvasToolGuidance } from '../../canvas/session'
import { OverviewNotice } from './CanvasOverview'
import { BarMapNotice } from './MapNotice'
import { PlantLabelsChip } from './PlantLabelsChip'
import { SelectionChip } from './SelectionChip'
import { plantsHighlighted, SpeciesFocusChip } from './SpeciesFocusChip'
import { ToolCard } from './ToolCard'
import styles from './PhoneContextBar.module.css'

/**
 * The phone's context bar (answers 18 and 22-26): what the map's context shows on a phone, as the panel sheet's first
 * row (PhoneSheet `bar`), so it moves with the sheet and the sheet's one registration with the visible-map-area seam
 * covers it; on a phone nothing else floats over the map but the zoom column. The map notice, with its Retry, is a
 * status row on top of the bar, shown with whatever it holds (answer 24). It shows one context, never two, the first
 * that holds: in overview its notice; the armed tool's row (any tool but Select and Pan; one touch row, answer 30); the
 * selection (the selection chip, one line); the highlighted plants (the highlight chip); the labels chip's few seconds
 * after the labels change; else nothing. The tool's row stays mounted under Select and Pan, showing nothing, so its live
 * region announces the next tool, and the labels chip stays mounted, so its window runs while another context shows.
 * Phones are the Web Edition's; the edition renders the bar only while a Design is open, and the sheet steps aside while
 * "Where is your site?" or a story is shown.
 *
 * The bar owns when the tool's options open and close by themselves (answer 30): Place plants with no species chosen
 * is its chooser, so arming it, or a tap on the map that asks for a species first, opens them at half; another tool,
 * and the bar going with the Design, closes them, which gives the sheet back its panel as it was.
 */
export function PhoneContextBar() {
  const tool = currentCanvasTool.value
  const summary = useMapSelectionSummary()
  const overview = currentCanvasQuerySurface.value?.view.mode.value === 'overview'
  const card = !overview && tool !== 'select' && tool !== 'hand'
  const selection = !overview && !card && summary !== null
  const highlight = !overview && !card && !selection && plantsHighlighted()
  const promptSpecies = currentCanvasToolGuidance.value.promptSpecies
  useEffect(() => {
    phoneToolOptions.value = tool === 'plant-stamp' && readPlantStampSource() === null ? 'half' : null
  }, [tool])
  useEffect(() => {
    if (promptSpecies) phoneToolOptions.value = 'half'
  }, [promptSpecies])
  useEffect(() => () => { phoneToolOptions.value = null }, [])
  return (
    <>
      <BarMapNotice />
      {overview && <div className={styles.row}><OverviewNotice /></div>}
      <ToolCard placement="bar" />
      {!card && <SelectionChip placement="bar" />}
      {highlight && <div className={styles.row}><SpeciesFocusChip /></div>}
      <div className={styles.row}><PlantLabelsChip hidden={overview || card || selection || highlight} /></div>
    </>
  )
}
