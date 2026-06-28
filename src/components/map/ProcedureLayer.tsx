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
  const lineWidth = isAutoShown ? 2.5 : 1.5

  return (
    <Source id={`proc-${procedure.id}`} type="geojson" data={procedure.geojson}>
      <Layer
        id={`proc-line-${procedure.id}`}
        type="line"
        paint={{
          'line-color': lineColor,
          'line-width': lineWidth,
          'line-opacity': 0.9,
        }}
        layout={{
          'line-join': 'round',
          'line-cap': 'round',
        }}
      />
    </Source>
  )
}
