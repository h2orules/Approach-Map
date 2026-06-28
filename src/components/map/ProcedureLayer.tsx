import { Source, Layer } from 'react-map-gl'
import type { Procedure } from '../../types/procedure'
import { useProcedureStore } from '../../store/useProcedureStore'
import { ACTIVE_PROCEDURE_HIGHLIGHT } from '../../utils/colorScheme'

interface Props {
  procedure: Procedure
}

export function ProcedureLayer({ procedure }: Props) {
  const isAutoShown = useProcedureStore((s) => s.autoShownIds.has(procedure.id))
  const lineColor = isAutoShown ? ACTIVE_PROCEDURE_HIGHLIGHT : procedure.color
  const baseWidth = isAutoShown ? 2.5 : 1.5

  return (
    <Source id={`proc-${procedure.id}`} type="geojson" data={procedure.geojson}>
      {/* Inbound path + holds-in-lieu + procedure turns: solid */}
      <Layer
        id={`proc-line-${procedure.id}`}
        type="line"
        filter={['==', ['get', 'segment'], 'transition']}
        paint={{
          'line-color': lineColor,
          'line-width': baseWidth,
          'line-opacity': 0.9,
        }}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
      />
      {/* Missed approach + missed-approach hold: dash-dot-dash */}
      <Layer
        id={`proc-missed-${procedure.id}`}
        type="line"
        filter={['==', ['get', 'segment'], 'missed']}
        paint={{
          'line-color': lineColor,
          'line-width': baseWidth,
          'line-opacity': 0.85,
          'line-dasharray': [3, 1.5, 0.5, 1.5],
        }}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
      />
    </Source>
  )
}
