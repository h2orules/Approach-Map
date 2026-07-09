import { useState, useRef, useCallback, useEffect } from 'react'
import { useAirportSearch } from '../../hooks/useAirportSearch'
import { useAirportStore } from '../../store/useAirportStore'
import { useMapStore } from '../../store/useMapStore'
import { decideFlyTarget, DEFAULT_FLY_ZOOM } from '../../utils/decideFlyTarget'
import { MAX_ACTIVE_AIRPORTS } from '../../config/constants'
import type { Airport } from '../../types/airport'
import styles from './AirportSearch.module.css'

export function AirportSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [capHint, setCapHint] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { results, counts } = useAirportSearch(query)
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const { setViewport } = useMapStore()

  // Reset the highlighted suggestion whenever the result set changes
  useEffect(() => {
    setActiveIndex(-1)
  }, [query])

  const selectAirport = useCallback(
    (airport: Airport) => {
      // Multi-airport add flow (Phase 5): grab the pre-add list before
      // mutating so decideFlyTarget can tell a first/primary add (moves the
      // camera) from a 2nd+ add (camera stays put on the existing primary).
      const previousActive = useAirportStore.getState().activeAirports
      const result = useAirportStore.getState().addAirport(airport)

      if (result === 'capped') {
        setCapHint(true)
      } else {
        setCapHint(false)
        if (result === 'exists') {
          // Already active — just recenter on it.
          setViewport({ longitude: airport.lon, latitude: airport.lat, zoom: DEFAULT_FLY_ZOOM })
        } else {
          const target = decideFlyTarget(previousActive, airport)
          if (target) setViewport({ longitude: target.lon, latitude: target.lat, zoom: target.zoom })
        }
      }

      setQuery('')
      setOpen(false)
      setActiveIndex(-1)
      inputRef.current?.blur()
    },
    [setViewport],
  )

  const exactMatch = useCallback(
    (q: string): Airport | undefined => {
      const norm = q.trim().toUpperCase()
      if (!norm) return undefined
      return results.find((a) => a.icao.toUpperCase() === norm || a.iata?.toUpperCase() === norm)
    },
    [results],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter': {
        e.preventDefault()
        // Highlighted suggestion wins; otherwise prefer an exact ICAO/IATA
        // match, falling back to the top suggestion.
        const choice =
          (activeIndex >= 0 ? results[activeIndex] : undefined) ?? exactMatch(query) ?? results[0]
        if (choice) selectAirport(choice)
        break
      }
      case 'Escape':
        setOpen(false)
        setActiveIndex(-1)
        inputRef.current?.blur()
        break
    }
  }

  return (
    <div className={styles.wrapper}>
      <input
        ref={inputRef}
        className={styles.input}
        placeholder={selectedAirport ? `${selectedAirport.icao} — ${selectedAirport.name}` : 'Search airport (ICAO, IATA, name)…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setCapHint(false)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls="airport-suggestions"
        aria-activedescendant={activeIndex >= 0 ? `airport-opt-${activeIndex}` : undefined}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul className={styles.dropdown} id="airport-suggestions" role="listbox">
          {results.map((airport, i) => {
            const airportCounts = counts.get(airport.key ?? airport.icao)
            return (
              <li
                key={airport.icao}
                id={`airport-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`${styles.option} ${i === activeIndex ? styles.optionActive : ''}`}
                onMouseDown={() => selectAirport(airport)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className={styles.icao}>{airport.icao}</span>
                <span className={styles.name}>{airport.name}</span>
                <span className={styles.city}>{airport.city}, {airport.state}</span>
                {airportCounts && (
                  <span className={styles.counts}>{airportCounts.a} APP</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {capHint && (
        <div className={styles.hint}>
          Airport limit reached ({MAX_ACTIVE_AIRPORTS}) — remove one first
        </div>
      )}
    </div>
  )
}
