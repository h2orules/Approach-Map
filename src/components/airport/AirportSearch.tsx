import { useState, useRef, useCallback } from 'react'
import { useAirportSearch } from '../../hooks/useAirportSearch'
import { useAirportStore } from '../../store/useAirportStore'
import { useMapStore } from '../../store/useMapStore'
import type { Airport } from '../../types/airport'
import styles from './AirportSearch.module.css'

export function AirportSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { results } = useAirportSearch(query)
  const setSelectedAirport = useAirportStore((s) => s.setSelectedAirport)
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const { setViewport } = useMapStore()

  const selectAirport = useCallback(
    (airport: Airport) => {
      setSelectedAirport(airport)
      setViewport({ longitude: airport.lon, latitude: airport.lat, zoom: 11 })
      setQuery('')
      setOpen(false)
      inputRef.current?.blur()
    },
    [setSelectedAirport, setViewport],
  )

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
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <ul className={styles.dropdown}>
          {results.map((airport) => (
            <li
              key={airport.icao}
              className={styles.option}
              onMouseDown={() => selectAirport(airport)}
            >
              <span className={styles.icao}>{airport.icao}</span>
              <span className={styles.name}>{airport.name}</span>
              <span className={styles.city}>{airport.city}, {airport.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
