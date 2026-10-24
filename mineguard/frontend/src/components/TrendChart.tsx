import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { Snapshot } from '../api/contracts'

export function TrendChart({ history, zoneId }: { history: Snapshot[]; zoneId: string }) {
  const data = history.flatMap((snapshot) => {
    const zone = snapshot.zones.find((item) => item.zone_id === zoneId)
    const risk = snapshot.risks.find((item) => item.zone_id === zoneId)
    if (!zone || !risk) return []
    return [{ time: snapshot.simulated_seconds, methane: zone.methane_fraction * 100, coPpm: zone.co_ppm, airflow: risk.airflow_m3s }]
  })
  return (
    <section className="panel trend" aria-labelledby="trend-title">
      <div className="panel-heading">
        <div><p className="eyebrow">Rolling live telemetry</p><h2 id="trend-title">{zoneId} methane & airflow</h2></div>
        <span className="unit">% vol · m³/s</span>
      </div>
      {data.length > 0 && <p className="quiet" aria-label={`${zoneId} latest carbon monoxide`}>Latest CO: <strong>{data[data.length - 1].coPpm.toFixed(1)} ppm</strong> · sampled at T+{data[data.length - 1].time.toFixed(1)}s</p>}
      {data.length ? (
        <div className="trend-chart" role="img" aria-label={`${zoneId} methane and airflow history`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 2, bottom: 0, left: -25 }}>
              <CartesianGrid stroke="#1e343d" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#6f8994', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#29424c' }} tickFormatter={(value: number) => `${value.toFixed(0)}s`} />
              <YAxis yAxisId="methane" tick={{ fill: '#6f8994', fontSize: 9 }} tickLine={false} axisLine={false} domain={[0, 'auto']} />
              <YAxis yAxisId="airflow" orientation="right" tick={{ fill: '#6f8994', fontSize: 9 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#071117', border: '1px solid #2a4651', fontSize: 11 }} labelFormatter={(value) => `T+${Number(value).toFixed(1)}s`} />
              <ReferenceLine yAxisId="methane" y={1} stroke="#ff9f43" strokeDasharray="4 4" label={{ value: 'warning', fill: '#ff9f43', fontSize: 8 }} />
              <ReferenceLine yAxisId="methane" y={1.5} stroke="#ff4545" strokeDasharray="4 4" label={{ value: 'emergency', fill: '#ff4545', fontSize: 8 }} />
              <Line yAxisId="methane" type="monotone" dataKey="methane" name="Methane % vol" stroke="#35e3cf" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="airflow" type="monotone" dataKey="airflow" name="Airflow m³/s" stroke="#6fa9ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="quiet">No history received.</p>}
    </section>
  )
}
