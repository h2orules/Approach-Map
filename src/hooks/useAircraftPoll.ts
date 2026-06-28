import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAircraftByRadius } from '../api/adsbx'
import { useAircraftStore } from '../store/useAircraftStore'
import { useAirportStore } from '../store/useAirportStore'
import { useSettingsStore } from '../store/useSettingsStore'

export function useAircraftPoll() {
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const pollIntervalMs = useSettingsStore((s) => s.pollIntervalMs)
  const searchRadiusNm = useSettingsStore((s) => s.searchRadiusNm)
  const updateFromPoll = useAircraftStore((s) => s.updateFromPoll)

  const { data, error, isLoading } = useQuery({
    queryKey: ['aircraft', selectedAirport?.icao, searchRadiusNm],
    queryFn: async () => {
      if (!selectedAirport) return null
      return fetchAircraftByRadius(selectedAirport.lat, selectedAirport.lon, searchRadiusNm)
    },
    enabled: !!selectedAirport,
    refetchInterval: pollIntervalMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })

  useEffect(() => {
    if (data?.ac) {
      updateFromPoll(data.ac, Date.now())
    }
  }, [data, updateFromPoll])

  return { error, isLoading }
}
