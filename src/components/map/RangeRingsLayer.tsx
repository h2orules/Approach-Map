import { useEffect, useRef, useState } from 'react'
import { Source, Layer, Marker, useMap } from 'react-map-gl'
import type { FeatureCollection, LineString } from 'geojson'
import type { GeoJSONSource } from 'mapbox-gl'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore, selectedHexOf } from '../../store/useSelectionStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { ringRadiiForZoom, ringFeatures, ringBadges, type RingBadge } from '../../geo/rangeRings'
import styles from './RangeRingsLayer.module.css'

const EMPTY: FeatureCollection<LineString, { radiusNm: number }> = { type: 'FeatureCollection', features: [] }
// Below this movement (~0.1m at the equator) a setData call would be a no-op
// visually, so the rAF loop skips it — the rings only need to actually move
// when the aircraft's interpolated position has meaningfully changed.
const MOVE_EPSILON_DEG = 1e-6
const BADGE_INTERVAL_MS = 250

interface LastRings {
  lat: number
  lon: number
  radii: readonly [number, number, number]
}

/**
 * Range rings (1/3/6 nm etc., bucketed by zoom) centered on the selected
 * aircraft. The rings themselves follow every frame via an imperative
 * `setData` (no React churn, mirroring AircraftOverlay's rAF pattern);
 * `ringRadiiForZoom` returns the same array reference for a given zoom
 * bucket, so a plain `!==` check is enough to detect a bucket change without
 * re-deriving it. Badge labels are cheaper DOM Markers, refreshed on a slow
 * timer since sub-frame precision doesn't matter for text.
 */
export function RangeRingsLayer() {
  const showRangeRings = useSettingsStore((s) => s.showRangeRings)
  const selectedHex = useSelectionStore((s) => selectedHexOf(s.selected))
  const { current: mapRef } = useMap()
  const [badges, setBadges] = useState<RingBadge[]>([])
  const lastRef = useRef<LastRings | null>(null)

  const active = showRangeRings && !!selectedHex

  useEffect(() => {
    const map = mapRef?.getMap()

    if (!map || !active || !selectedHex) {
      lastRef.current = null
      const source = map?.getSource('range-rings') as GeoJSONSource | undefined
      source?.setData(EMPTY)
      return
    }

    let raf = 0
    const frame = () => {
      const ac = useAircraftStore.getState().aircraftMap.get(selectedHex)
      if (ac) {
        const radii = ringRadiiForZoom(map.getZoom())
        const last = lastRef.current
        const moved =
          !last ||
          Math.abs(last.lat - ac.interpLat) > MOVE_EPSILON_DEG ||
          Math.abs(last.lon - ac.interpLon) > MOVE_EPSILON_DEG
        const bucketChanged = !last || last.radii !== radii

        if (moved || bucketChanged) {
          const source = map.getSource('range-rings') as GeoJSONSource | undefined
          source?.setData(ringFeatures(ac.interpLat, ac.interpLon, radii))
          lastRef.current = { lat: ac.interpLat, lon: ac.interpLon, radii }
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [mapRef, active, selectedHex])

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || !active || !selectedHex) {
      setBadges([])
      return
    }

    const recompute = () => {
      const ac = useAircraftStore.getState().aircraftMap.get(selectedHex)
      if (!ac) {
        setBadges([])
        return
      }
      const radii = ringRadiiForZoom(map.getZoom())
      const project = (lonLat: [number, number]) => map.project(lonLat)
      setBadges(ringBadges(ac.interpLat, ac.interpLon, radii, project))
    }

    recompute()
    const id = setInterval(recompute, BADGE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [mapRef, active, selectedHex])

  return (
    <>
      <Source id="range-rings" type="geojson" data={EMPTY}>
        <Layer
          id="range-rings-line"
          type="line"
          paint={{
            'line-color': '#ffffff',
            'line-width': 1,
            'line-opacity': 0.6,
          }}
        />
      </Source>

      {active &&
        badges.map((b) => (
          <Marker key={b.radiusNm} longitude={b.lon} latitude={b.lat} anchor="center">
            <div className={styles.chip}>{b.radiusNm} NM</div>
          </Marker>
        ))}
    </>
  )
}
