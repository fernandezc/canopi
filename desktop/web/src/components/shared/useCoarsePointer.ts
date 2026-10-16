import { useEffect, useState } from 'preact/hooks'

const COARSE_POINTER_QUERY = '(pointer: coarse)'

/**
 * Whether the primary pointer is coarse (a touch screen), following a mouse plugged in or out: copy that names a
 * gesture says tap and drag there, not click and move (the tool card, the inspection lens's hint).
 */
export function useCoarsePointer(): boolean {
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
