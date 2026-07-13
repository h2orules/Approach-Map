import { useEffect, useRef } from 'react'
import type { MapRef } from 'react-map-gl'
import { useMapStore } from '../../store/useMapStore'
import { stretchScales } from '../../utils/axisZoom'
import styles from './AxisStretchFrame.module.css'

interface Props {
  mapRef: React.RefObject<MapRef | null>
  children: React.ReactNode
}

/** Marks re-dispatched (coordinate-corrected) events so the capture-phase
 * interceptor doesn't process its own clones. */
const CORRECTED = '__axisStretchCorrected'

/** Mouse event types mapbox consumes point-positionally (feature clicks,
 * interactiveLayerIds hover, double-click zoom). While stretched, these are
 * stopped in the capture phase and re-dispatched with layout-space client
 * coordinates so mapbox's own screen→lngLat math stays correct. */
const CORRECT_TYPES = ['click', 'dblclick', 'mousemove', 'contextmenu'] as const

/** Wheel-to-zoom rates, matching mapbox-gl's ScrollZoomHandler feel:
 * trackpad pinches arrive as ctrl+wheel and are much finer-grained. */
const WHEEL_ZOOM_RATE = 1 / 450
const PINCH_WHEEL_ZOOM_RATE = 1 / 100
/** px equivalent per wheel "line" for deltaMode DOM_DELTA_LINE devices. */
const WHEEL_LINE_PX = 20
/** Max zoom change from one wheel event, so free-spinning wheels don't warp. */
const WHEEL_MAX_DELTA = 2
/** Pointer movement (px) before a press becomes a drag rather than a click. */
const DRAG_SLOP_PX = 3
/** Window after a drag ends in which a stray synthetic click is swallowed. */
const POST_DRAG_CLICK_SUPPRESS_MS = 150

const isInCanvas = (t: EventTarget | null): boolean =>
  t instanceof Element && !!t.closest('.mapboxgl-canvas-container')

/**
 * Anisotropic-zoom frame around the mapbox Map.
 *
 * When `useMapStore.axisRatio` ≠ 0 the map's container is laid out SMALLER
 * than the viewport along the more-zoomed axis and CSS-scaled back up to fill
 * it (transform-origin top left, so layout↔visual conversion is a pure
 * divide/multiply). The mapbox zoom stays the less-zoomed axis, so ordinary
 * zoom mechanics scale both axes together and preserve the ratio.
 *
 * The transform breaks mapbox's own pointer math (it reads client coordinates
 * against an unstretched container), so while stretched:
 *  - mapbox's drag/scroll/box/rotate/pitch handlers are disabled and replaced
 *    by pointer/wheel handlers here that convert visual→layout deltas
 *    (double-click zoom and keyboard stay enabled — they're coordinate-safe
 *    given the corrected events below),
 *  - point-consuming mouse events headed for the canvas are intercepted in
 *    the capture phase and re-dispatched with layout-space coordinates, so
 *    feature clicks / hover / dblclick-zoom anchor correctly,
 *  - bearing/pitch are forced to 0 — the stretch is screen-axis aligned and
 *    only coherent on a north-up planar view.
 *
 * At 1:1 nothing is transformed, no listener is attached, and every native
 * mapbox handler is left in its default state — the feature is fully inert.
 */
export function AxisStretchFrame({ mapRef, children }: Props) {
  const axisRatio = useMapStore((s) => s.axisRatio)
  const outerRef = useRef<HTMLDivElement | null>(null)
  const { sx, sy } = stretchScales(axisRatio)
  const stretched = axisRatio !== 0

  // The container's layout size changes with the ratio; tell mapbox promptly
  // (its own ResizeObserver would catch it a frame later). resize() keeps the
  // geographic center at the container center, which the top-left-origin
  // scale maps back to the visual viewport center — so the view stays put.
  useEffect(() => {
    mapRef.current?.getMap()?.resize()
  }, [axisRatio, mapRef])

  // Interaction-handler swap + north-up enforcement while stretched.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !stretched) return

    if (map.getBearing() !== 0 || map.getPitch() !== 0) {
      map.easeTo({ bearing: 0, pitch: 0, duration: 200 })
    }
    map.dragPan.disable()
    map.scrollZoom.disable()
    map.boxZoom.disable()
    map.dragRotate.disable()
    map.touchZoomRotate.disable()
    map.touchPitch.disable()

    return () => {
      map.dragPan.enable()
      map.scrollZoom.enable()
      map.boxZoom.enable()
      map.dragRotate.enable()
      map.touchZoomRotate.enable()
      map.touchPitch.enable()
    }
  }, [stretched, mapRef])

  // Gesture handling + event coordinate correction while stretched.
  useEffect(() => {
    const outer = outerRef.current
    const map = mapRef.current?.getMap()
    if (!outer || !map || !stretched) return

    // visual (client) → layout (mapbox container) point, in container px.
    const layoutPoint = (clientX: number, clientY: number) => {
      const r = outer.getBoundingClientRect()
      return { x: (clientX - r.left) / sx, y: (clientY - r.top) / sy, rect: r }
    }

    let suppressClickUntil = 0

    // ── capture-phase coordinate correction for mapbox's point consumers ──
    const correct = (e: MouseEvent) => {
      if ((e as unknown as Record<string, boolean>)[CORRECTED]) return
      if (!isInCanvas(e.target)) return
      e.stopImmediatePropagation()
      if (e.type === 'click' && performance.now() < suppressClickUntil) return
      const { x, y, rect } = layoutPoint(e.clientX, e.clientY)
      const clone = new MouseEvent(e.type, {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: e.detail,
        screenX: e.screenX,
        screenY: e.screenY,
        clientX: rect.left + x,
        clientY: rect.top + y,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        button: e.button,
        buttons: e.buttons,
        relatedTarget: e.relatedTarget,
      })
      ;(clone as unknown as Record<string, boolean>)[CORRECTED] = true
      e.target?.dispatchEvent(clone)
    }

    // ── wheel: proportional zoom (ratio untouched) about the cursor ──
    const onWheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest('.mapboxgl-ctrl')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PX : e.deltaY
      const rate = e.ctrlKey ? PINCH_WHEEL_ZOOM_RATE : WHEEL_ZOOM_RATE
      const dz = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, -px * rate))
      if (dz === 0) return
      const { x, y } = layoutPoint(e.clientX, e.clientY)
      map.easeTo({ zoom: map.getZoom() + dz, around: map.unproject([x, y]), duration: 0 })
    }

    // ── pointer pan / pinch (replaces the disabled mapbox handlers) ──
    const pointers = new Map<number, { x: number; y: number }>()
    let dragging = false
    let downPt: { x: number; y: number } | null = null
    let pinch: { dist: number; zoom: number } | null = null
    let lastMid: { x: number; y: number } | null = null

    const midpoint = () => {
      const [a, b] = [...pointers.values()]
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!isInCanvas(e.target)) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 1) {
        downPt = { x: e.clientX, y: e.clientY }
        dragging = false
      } else if (pointers.size === 2) {
        dragging = false
        for (const id of pointers.keys()) {
          try {
            outer.setPointerCapture(id)
          } catch {
            /* pointer already gone */
          }
        }
        const m = midpoint()
        pinch = { dist: m.dist, zoom: map.getZoom() }
        lastMid = { x: m.x, y: m.y }
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const cur = { x: e.clientX, y: e.clientY }
      pointers.set(e.pointerId, cur)

      if (pointers.size === 1) {
        if (!dragging && downPt && Math.hypot(cur.x - downPt.x, cur.y - downPt.y) > DRAG_SLOP_PX) {
          dragging = true
          try {
            outer.setPointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }
        if (dragging) {
          map.panBy([-(cur.x - prev.x) / sx, -(cur.y - prev.y) / sy], { duration: 0 })
        }
      } else if (pointers.size === 2 && pinch && lastMid) {
        const m = midpoint()
        map.panBy([-(m.x - lastMid.x) / sx, -(m.y - lastMid.y) / sy], { duration: 0 })
        lastMid = { x: m.x, y: m.y }
        if (pinch.dist > 0 && m.dist > 0) {
          const { x, y } = layoutPoint(m.x, m.y)
          map.easeTo({
            zoom: pinch.zoom + Math.log2(m.dist / pinch.dist),
            around: map.unproject([x, y]),
            duration: 0,
          })
        }
      }
    }

    const onPointerEnd = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return
      if (pointers.size < 2) {
        pinch = null
        lastMid = null
      }
      if (pointers.size === 1) {
        // pinch → single-finger pan handoff: keep dragging from here.
        const [rest] = [...pointers.values()]
        downPt = rest
        dragging = true
      }
      if (pointers.size === 0) {
        if (dragging) suppressClickUntil = performance.now() + POST_DRAG_CLICK_SUPPRESS_MS
        dragging = false
        downPt = null
      }
    }

    for (const t of CORRECT_TYPES) outer.addEventListener(t, correct, true)
    outer.addEventListener('wheel', onWheel, { capture: true, passive: false })
    outer.addEventListener('pointerdown', onPointerDown)
    outer.addEventListener('pointermove', onPointerMove)
    outer.addEventListener('pointerup', onPointerEnd)
    outer.addEventListener('pointercancel', onPointerEnd)

    return () => {
      for (const t of CORRECT_TYPES) outer.removeEventListener(t, correct, true)
      outer.removeEventListener('wheel', onWheel, true)
      outer.removeEventListener('pointerdown', onPointerDown)
      outer.removeEventListener('pointermove', onPointerMove)
      outer.removeEventListener('pointerup', onPointerEnd)
      outer.removeEventListener('pointercancel', onPointerEnd)
    }
  }, [stretched, sx, sy, mapRef])

  return (
    <div ref={outerRef} className={styles.outer}>
      <div
        className={styles.inner}
        data-axis-stretch={stretched ? '' : undefined}
        style={
          stretched
            ? ({
                width: `${100 / sx}%`,
                height: `${100 / sy}%`,
                transform: `scale(${sx}, ${sy})`,
                '--axis-inv-sx': String(1 / sx),
                '--axis-inv-sy': String(1 / sy),
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
    </div>
  )
}
