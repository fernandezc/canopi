import { currentCanvasTool } from '../../canvas/session'
import { SelectionChip } from './SelectionChip'
import { ToolCard } from './ToolCard'

/**
 * The phone's context bar (answers 18 and 22-26): what the map's context shows on a phone, as the panel sheet's first
 * row (PhoneSheet `bar`), so it moves with the sheet and the sheet's one registration with the visible-map-area seam
 * covers it; on a phone nothing else floats over the map but the zoom column. It shows one context, never two: the armed
 * tool's card (any tool but Select and Pan), else the selection (the selection chip, one line), else nothing. The card
 * stays mounted under Select and Pan, showing nothing, so its live region announces the next tool. Phones are the Web Edition's; the edition renders the bar only while a
 * Design is open, and the sheet steps aside while "Where is your site?" or a story is shown.
 */
export function PhoneContextBar() {
  const tool = currentCanvasTool.value
  const card = tool !== 'select' && tool !== 'hand'
  return (
    <>
      <ToolCard placement="bar" />
      {!card && <SelectionChip placement="bar" />}
    </>
  )
}
