import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePaneMode } from '../usePaneMode'
import { PANE_OVERLAY_BREAKPOINT_PX } from '../../store/usePaneStore'

/** jsdom's window.innerWidth is a plain writable-configurable property. */
function setInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
}

describe('usePaneMode', () => {
  const originalWidth = window.innerWidth

  afterEach(() => {
    setInnerWidth(originalWidth)
  })

  it('reflects the initial window width via deriveMode', () => {
    setInnerWidth(1024)
    const { result } = renderHook(() => usePaneMode())
    expect(result.current).toBe('push')
  })

  it('starts in overlay mode on a phone-width viewport', () => {
    setInnerWidth(375)
    const { result } = renderHook(() => usePaneMode())
    expect(result.current).toBe('overlay')
  })

  it('updates on window resize crossing the breakpoint', () => {
    setInnerWidth(1024)
    const { result } = renderHook(() => usePaneMode())
    expect(result.current).toBe('push')

    act(() => {
      setInnerWidth(375)
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe('overlay')

    act(() => {
      setInnerWidth(1024)
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe('push')
  })

  it('treats exactly the breakpoint width as overlay, consistent with deriveMode', () => {
    setInnerWidth(PANE_OVERLAY_BREAKPOINT_PX)
    const { result } = renderHook(() => usePaneMode())
    expect(result.current).toBe('overlay')
  })

  it('removes the resize listener on unmount', () => {
    setInnerWidth(1024)
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => usePaneMode())
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    removeSpy.mockRestore()
  })
})
