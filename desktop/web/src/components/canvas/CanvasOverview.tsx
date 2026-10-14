import { useEffect, useRef, useState } from 'preact/hooks'
import { designName } from '../../app/document-session/store'
import { focusOwner } from '../../app/keyboard/focus-owner'
import { DEFAULT_THRESHOLDS } from '../../canvas/runtime/input/thresholds'
import { currentCanvasQuerySurface, currentCanvasViewportCommandSurface } from '../../canvas/session'
import { t } from '../../i18n'
import { visibleDesignName } from '../shared/DesignNameField'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { ControlIcon } from '../shared/ControlIcon'
import styles from './CanvasOverview.module.css'

/**
 * Overview (below 0.1 px/m): the Design shows as a named pin at its origin, where the view publishes it (none near an
 * edge); the pin fits the Design, as Return to Design does (canopi-n2cg). Its notice is a top chip (OverviewNotice, in
 * CanvasChrome's top-centre slot). The pin sits over the map host, not in it, and is transparent to the pointer, so every
 * gesture that starts on it (a wheel, a drag, a pinch, a panel drop) is the map's, as on bare map. It is still a button
 * for the keyboard (Tab, then Enter or Space). A pointer reaches it through the window: a press on the map within its
 * box, released within the map's drag slop, is a tap that fits the Design (overview gives a still primary press no other meaning), and
 * a mouse or pen over its box shows its tooltip.
 */
export function CanvasOverview() {
  const view = currentCanvasQuerySurface.value?.view
  if (!view || view.mode.value !== 'overview') return null
  const marker = view.designPin.value
  if (!marker) return null
  return <DesignPin x={marker.x} y={marker.y} />
}

function DesignPin({ x, y }: { x: number; y: number }) {
  const pin = useRef<HTMLButtonElement>(null)
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    const over = (event: PointerEvent): boolean => {
      const box = pin.current?.getBoundingClientRect()
      return !!box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
    }
    /** The primary presses that started on the pin, by pointer, where they started; a second pointer ends every tap. */
    const presses = new Map<number, { x: number; y: number; slop: number }>()
    const down = (event: PointerEvent): void => {
      setHovered(false)
      if (event.button !== 0 || presses.size > 0 || !over(event) || !onBareMap(event.target)) {
        presses.clear()
        return
      }
      const kind = event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse'
      presses.set(event.pointerId, { x: event.clientX, y: event.clientY, slop: DEFAULT_THRESHOLDS.dragSlopPx[kind] })
    }
    const move = (event: PointerEvent): void => {
      const press = presses.get(event.pointerId)
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= press.slop) presses.delete(event.pointerId)
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') setHovered(event.buttons === 0 && over(event))
    }
    const up = (event: PointerEvent): void => {
      const press = presses.get(event.pointerId)
      presses.delete(event.pointerId)
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) < press.slop) returnToDesign()
    }
    const cancel = (event: PointerEvent): void => { presses.delete(event.pointerId) }
    const leave = (): void => setHovered(false)
    // The press and the moves in the capture phase (the map captures its pointer); the release in the bubble phase, so the
    // map has ended its own (still) pan before the Design fits.
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel, true)
    document.documentElement.addEventListener('pointerleave', leave)
    window.addEventListener('blur', leave)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel, true)
      document.documentElement.removeEventListener('pointerleave', leave)
      window.removeEventListener('blur', leave)
    }
  }, [])
  const name = visibleDesignName(designName.value)
  return (
    <button
      ref={pin}
      type="button"
      className={styles.pin}
      style={{ left: `${x}px`, top: `${y}px` }}
      aria-label={t('canvas.overview.designPin', { name })}
      onClick={(event) => { if (event.detail === 0) returnToDesign() }}
      data-overview-pin
    >
      <span className={styles.pinDot} aria-hidden="true"><ControlIcon name="pin" /></span>
      <span className={styles.pinName} aria-hidden="true">{name}</span>
      <ButtonTooltip label={t('canvas.overview.designPinHint')} side="bottom" shown={hovered} />
    </button>
  )
}

/** A press that lands on the map itself (the interaction session's `role="application"` host), not on chrome drawn over
 *  the pin's box nor on a control in the map: only such a press is the pin's. */
function onBareMap(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('[role="application"]') !== null && target.closest('button, a, input, select, textarea') === null
}

/** The pin and Return to Design leave the overview, unmounting the button pressed, so the map takes focus and its keys
 *  work at once, as after a tool picked in overview. */
function returnToDesign(): void {
  currentCanvasViewportCommandSurface.value?.returnToDesign()
  focusOwner.focusMap()
}

/** In overview, a top chip explains that plants are hidden and offers the one Return to Design action. */
export function OverviewNotice() {
  const view = currentCanvasQuerySurface.value?.view
  if (!view || view.mode.value !== 'overview') return null
  return (
    <div className={styles.notice} role="status" aria-live="polite" data-overview-notice>
      <span className={styles.noticeText}>{t('canvas.overview.zoomInToEdit')}</span>
      <button
        type="button"
        className={styles.returnButton}
        onClick={returnToDesign}
      >
        {t('canvas.overview.returnToDesign')}
      </button>
    </div>
  )
}
