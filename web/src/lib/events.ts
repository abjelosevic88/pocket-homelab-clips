import { useEffect, useRef } from 'react'

/** Something was added or changed (from the shell, the palette or a page): lists and counts reload. */
export const announceChange = () => window.dispatchEvent(new CustomEvent('pc:changed'))

export function useOnChange(cb: () => void) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    const h = () => ref.current()
    window.addEventListener('pc:changed', h)
    return () => window.removeEventListener('pc:changed', h)
  }, [])
}
