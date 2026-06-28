import * as turf from '@turf/turf'

export interface DeadReckonedPosition {
  lat: number
  lon: number
}

export function deadReckon(
  lat: number,
  lon: number,
  trackDeg: number,
  groundspeedKt: number,
  elapsedMs: number,
): DeadReckonedPosition {
  if (groundspeedKt <= 0 || elapsedMs <= 0) return { lat, lon }

  const distanceNm = groundspeedKt * (elapsedMs / 3_600_000)
  if (distanceNm < 0.0001) return { lat, lon }

  const dest = turf.destination(turf.point([lon, lat]), distanceNm, trackDeg, {
    units: 'nauticalmiles',
  })
  const [newLon, newLat] = dest.geometry.coordinates
  return { lat: newLat, lon: newLon }
}
