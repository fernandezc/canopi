import { createPortal } from 'preact/compat'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { keyboardFocus, placeTooltip, tooltipLayer, watchInputModality, type TooltipSide } from '../../utils/tooltip-layer'
import styles from './ButtonTooltip.module.css'

interface ButtonTooltipProps {
  label: string
  description?: string
  shortcut?: string
  /**
   * The side it prefers: `top` opens above the button and `bottom` below it, both ending at its end edge (for bars
   * along the bottom or top of the window). It flips or shifts to stay whole inside the window.
   */
  side?: TooltipSide
  /** Shown whatever the hover or focus: a reason a tap asked for on a touch screen, which has no hover. */
  shown?: boolean
}

/**
 * The tooltip of the button it is placed in. It is drawn in the window-level tooltip layer (utils/tooltip-layer.ts),
 * so no frame covers or clips it, while a mouse or pen hovers the button or keyboard focus is on it, and whenever
 * `shown`. A finger's hover never shows it (a tap leaves the button hovered); a press hides it.
 */
export function ButtonTooltip({
  label,
  description,
  shortcut,
  side = 'right',
  shown = false,
}: ButtonTooltipProps) {
  const id = useId()
  const marker = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = shown || hovered || focused

  useEffect(() => {
    const button = marker.current?.closest('button')
    if (!button) return
    watchInputModality()
    const enter = (event: PointerEvent) => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') setHovered(true) }
    const leave = () => setHovered(false)
    const focusIn = () => setFocused(keyboardFocus(button))
    const focusOut = () => setFocused(false)
    const press = () => { setHovered(false); setFocused(false) }
    button.addEventListener('pointerenter', enter)
    button.addEventListener('pointerleave', leave)
    button.addEventListener('focusin', focusIn)
    button.addEventListener('focusout', focusOut)
    button.addEventListener('pointerdown', press)
    if (button.matches(':hover') && !window.matchMedia?.('(hover: none)').matches) setHovered(true)
    return () => {
      button.removeEventListener('pointerenter', enter)
      button.removeEventListener('pointerleave', leave)
      button.removeEventListener('focusin', focusIn)
      button.removeEventListener('focusout', focusOut)
      button.removeEventListener('pointerdown', press)
    }
  }, [])

  // A scroll moves the button from under the pointer, and a window left behind takes no hover.
  useEffect(() => {
    if (!hovered && !focused) return
    const dismiss = () => { setHovered(false); setFocused(false) }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('blur', dismiss)
    }
  }, [hovered, focused])

  // Placed from the button's window box after every render while open (a new label or a moved button).
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const button = marker.current?.closest('button')
      const element = bubble.current
      if (!button || !element) return
      const placed = placeTooltip(
        button.getBoundingClientRect(),
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        side,
      )
      element.style.left = `${placed.left}px`
      element.style.top = `${placed.top}px`
      element.dataset.side = placed.side
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  })

  return (
    <>
      <span ref={marker} hidden data-tooltip-anchor={id} />
      {open && createPortal(
        <span ref={bubble} data-tooltip-for={id} className={`${styles.tooltip}${hovered || focused ? '' : ` ${styles.tooltipShown}`}`} role="tooltip">
          <span className={styles.tooltipName}>{label}</span>
          {shortcut && <span className={styles.tooltipShortcut}>{shortcut}</span>}
          {description && (
            <>
              <br />
              <span className={styles.tooltipDesc}>{description}</span>
            </>
          )}
        </span>,
        tooltipLayer(),
      )}
    </>
  )
}
