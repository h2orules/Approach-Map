import { useEffect, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl'
import { useAircraftStore } from '../../store/useAircraftStore'
import { DataBlock } from './DataBlock'
import type { InterpolatedAircraft } from '../../types/aircraft'
const LAYER_ID = 'aircraft-symbols'
const SOURCE_ID = 'aircraft-source'
const IMAGE_ID = 'aircraft-icon'

const AIRCRAFT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="#f59e0b" stroke="#000" stroke-width="0.5"
    d="M12 2L8 18l4-2 4 2L12 2Z"/>
  <path fill="#f59e0b" stroke="#000" stroke-width="0.5"
    d="M5 12L2 14l10-2 10 2-3-2H5Z"/>
</svg>
`

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(24, 24)
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

interface Props {
  mapRef: React.RefObject<MapRef | null>
}

export function AircraftLayer({ mapRef }: Props) {
  const [selectedHex, setSelectedHex] = useState<string | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const rafRef = useRef<number | null>(null)

  // Load aircraft icon image into Mapbox once map loads
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const loadImage = async () => {
      if (map.hasImage(IMAGE_ID)) {
        setImageLoaded(true)
        return
      }
      try {
        const img = await svgToImage(AIRCRAFT_SVG)
        if (!map.hasImage(IMAGE_ID)) {
          map.addImage(IMAGE_ID, img, { sdf: false })
        }
        setImageLoaded(true)
      } catch (e) {
        console.error('Failed to load aircraft icon', e)
      }
    }

    if (map.loaded()) {
      void loadImage()
    } else {
      map.once('load', () => void loadImage())
    }
  }, [mapRef])

  // Set up source + layer once
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !imageLoaded) return

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }

    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'icon-image': IMAGE_ID,
          'icon-size': 1.2,
          'icon-rotate': ['get', 'track'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })

      map.on('click', LAYER_ID, (e) => {
        const hex = e.features?.[0]?.properties?.hex as string | undefined
        setSelectedHex((prev) => (prev === hex ? null : (hex ?? null)))
      })

      map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] })
        if (features.length === 0) setSelectedHex(null)
      })
    }

    // Keep aircraft above everything. Runway/procedure/waypoint layers are
    // added declaratively after this layer (e.g. on airport select or toggle),
    // and would otherwise stack on top of the aircraft. Re-assert top position
    // whenever the layer set changes.
    const ensureOnTop = () => {
      const m = mapRef.current?.getMap()
      if (!m || !m.getLayer(LAYER_ID)) return
      const layers = m.getStyle()?.layers
      if (layers && layers.length && layers[layers.length - 1].id !== LAYER_ID) {
        m.moveLayer(LAYER_ID)
      }
    }
    ensureOnTop()
    map.on('styledata', ensureOnTop)

    return () => {
      // Cleanup happens on unmount if map is still around
      const m = mapRef.current?.getMap()
      if (!m) return
      m.off('styledata', ensureOnTop)
      if (m.getLayer(LAYER_ID)) m.removeLayer(LAYER_ID)
      if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID)
    }
  }, [mapRef, imageLoaded])

  // rAF loop to update GeoJSON source data
  useEffect(() => {
    if (!imageLoaded) return

    function updateSource() {
      const map = mapRef.current?.getMap()
      const src = map?.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
      if (!src) {
        rafRef.current = requestAnimationFrame(updateSource)
        return
      }

      const aircraft = useAircraftStore.getState().getAll()
      const features: GeoJSON.Feature[] = aircraft
        .filter((ac) => ac.altBaro !== 'ground')
        .map((ac) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [ac.interpLon, ac.interpLat] },
          properties: {
            hex: ac.hex,
            flight: ac.flight,
            track: ac.track,
          },
        }))

      src.setData({ type: 'FeatureCollection', features })
      rafRef.current = requestAnimationFrame(updateSource)
    }

    rafRef.current = requestAnimationFrame(updateSource)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [mapRef, imageLoaded])

  return selectedHex ? (
    <SelectedAircraftDataBlock hex={selectedHex} onClose={() => setSelectedHex(null)} />
  ) : null
}

function SelectedAircraftDataBlock({ hex, onClose }: { hex: string; onClose: () => void }) {
  // Subscribe only to the specific aircraft to avoid re-rendering on every poll
  const aircraft = useAircraftStore(
    (s) => s.aircraftMap.get(hex) as InterpolatedAircraft | undefined,
  )

  if (!aircraft) return null
  return <DataBlock aircraft={aircraft} onClose={onClose} />
}
