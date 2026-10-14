import { designName } from '../../app/document-session/store'
import { currentCanvasQuerySurface, currentCanvasViewportCommandSurface } from '../../canvas/session'
import { t } from '../../i18n'
import { visibleDesignName } from '../shared/DesignNameField'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { ControlIcon } from '../shared/ControlIcon'
import styles from './CanvasOverview.module.css'

/**
 * Overview (below 0.1 px/m): the Design shows as a named pin at its origin, where the view publishes it (none near an
 * edge); the pin is a button that fits the Design, as Return to Design does (canopi-n2cg). Its notice is a top chip
 * (OverviewNotice, in CanvasChrome's top-centre slot).
 */
export function CanvasOverview() {
  const view = currentCanvasQuerySurface.value?.view
  if (!view || view.mode.value !== 'overview') return null
  const marker = view.designPin.value
  if (!marker) return null
  const name = visibleDesignName(designName.value)
  return (
    <button
      type="button"
      className={styles.pin}
      style={{ left: `${marker.x}px`, top: `${marker.y}px` }}
      aria-label={t('canvas.overview.designPin', { name })}
      onClick={() => currentCanvasViewportCommandSurface.value?.returnToDesign()}
      data-overview-pin
    >
      <span className={styles.pinDot} aria-hidden="true"><ControlIcon name="pin" /></span>
      <span className={styles.pinName} aria-hidden="true">{name}</span>
      <ButtonTooltip label={t('canvas.overview.designPinHint')} side="bottom" />
    </button>
  )
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
        onClick={() => currentCanvasViewportCommandSurface.value?.returnToDesign()}
      >
        {t('canvas.overview.returnToDesign')}
      </button>
    </div>
  )
}
