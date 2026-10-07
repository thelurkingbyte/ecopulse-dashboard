import { useState, useEffect, useRef } from 'react';
import { AREAS, NODES, EVENTS, nodeById, nodesInArea, tick, networkStats, SENSOR_STACK } from './data/engine';
import type { BlackBoxEvent, SensorNode } from './data/engine';
import { analyzeSituation, AI_MODEL_LABEL } from './data/ai';
import type { AiBrief } from './data/ai';

type Page = 'overview' | 'radar' | 'twin' | 'live' | 'blackbox' | 'alerts';

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '󰕬' },
  { id: 'radar', label: 'Map', icon: '' },
  { id: 'twin', label: 'Area', icon: '' },
  { id: 'live', label: 'Live Node', icon: '󰀃' },
  { id: 'blackbox', label: 'Anomalies', icon: '⸮' },
  { id: 'alerts', label: 'Alerts', icon: '' },
];

const statusColor = (s: string) => s === 'healthy' || s === 'HEALTHY' ? 'var(--primary)' : s === 'warning' || s === 'WARNING' || s === 'ELEVATED' ? 'var(--warning)' : s === 'critical' || s === 'CRITICAL' ? 'var(--critical)' : 'var(--text3)';
const sevChip = (s: string) => s === 'CRITICAL' ? 'red' : s === 'WARNING' ? 'yellow' : s === 'NOTICE' ? 'grey' : 'green';
const areaLabel = (id: number) => `Area ${String(id).padStart(2, '0')}`;

function LineChart({ data, color = 'var(--primary)', unit = '' }: { data: { t: string; v: number }[]; color?: string; unit?: string }) {
  const w = 600, h = 160, p = 24;
  if (data.length < 2) return null;
  const vs = data.map(d => d.v);
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const pts = data.map((d, i) => [p + (i / (data.length - 1)) * (w - 2 * p), h - p - ((d.v - min) / span) * (h - 2 * p)]);
  const line = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%">
      <path d={`${line} L${w - p},${h - p} L${p},${h - p} Z`} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" />
      {pts.slice(-1).map((pt, i) => <circle key={i} cx={pt[0]} cy={pt[1]} r="4" fill={color} />)}
      <text x={p} y={14} fill="var(--text3)" fontSize="10">{max.toFixed(1)}{unit}</text>
      <text x={p} y={h - 6} fill="var(--text3)" fontSize="10">{min.toFixed(1)}{unit}</text>
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [, setTickN] = useState(0);
  const [lastSync, setLastSync] = useState(2.4);
  const [selectedNode, setSelectedNode] = useState<string>('A13-N06');
  const [openNode, setOpenNode] = useState<string | null>(null);
  const [twinArea, setTwinArea] = useState<number>(13);
  const [twinIdx, setTwinIdx] = useState<number>(-1); // -1 = now

  useEffect(() => {
    const iv = setInterval(() => { tick(); setTickN(t => t + 1); setLastSync(+(Math.random() * 2 + 1.2).toFixed(1)); }, 2000);
    return () => clearInterval(iv);
  }, []);

  const gotoLive = (nodeId: string) => { setSelectedNode(nodeId); setPage('live'); };
  const gotoTwin = (areaId: number) => { setTwinArea(areaId); setTwinIdx(-1); setPage('twin'); };
  const stats = networkStats();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/favicon.png" alt="" />
          ECO<span className="brand-pulse">PULSE</span>
        </div>
        <span className="chip green"><span className="pulse-dot" /> ENVIRONMENTAL NETWORK · LIVE</span>
        <div style={{ flex: 1 }} />
        <span className="mono sync-meta" style={{ color: 'var(--text2)', fontSize: 12 }}>{stats.online} / {stats.total} nodes online · sync {lastSync}s ago</span>
      </header>
      <nav className="navrail">
        {NAV.map(n => (
          <button key={n.id} className={`navbtn ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            <span className="ic">{n.icon}</span>{n.label}
            {n.id === 'alerts' && <span className="badge">{EVENTS.filter(e => e.status === 'ACTIVE' || e.status === 'INVESTIGATING').length}</span>}
          </button>
        ))}
      </nav>
      <main>
        {page === 'overview' && <Overview gotoLive={gotoLive} gotoTwin={gotoTwin} gotoAlerts={() => setPage('alerts')} gotoAnomalies={() => setPage('blackbox')} stats={stats} lastSync={lastSync} />}
        {page === 'radar' && <EcoRadar openNode={openNode} setOpenNode={setOpenNode} gotoLive={gotoLive} gotoTwin={gotoTwin} stats={stats} lastSync={lastSync} />}
        {page === 'twin' && <ClimateTwin areaId={twinArea} setAreaId={setTwinArea} idx={twinIdx} setIdx={setTwinIdx} />}
        {page === 'live' && <LiveBroadcast nodeId={selectedNode} setNodeId={setSelectedNode} gotoTwin={gotoTwin} />}
        {page === 'blackbox' && <BlackBox gotoLive={gotoLive} gotoTwin={gotoTwin} />}
        {page === 'alerts' && <Alerts gotoLive={gotoLive} gotoTwin={gotoTwin} />}
        <footer style={{ marginTop: 28, color: 'var(--text3)', fontSize: 11 }}>
          DEMONSTRATION ENVIRONMENT — All environmental telemetry shown in this prototype is simulated data.
        </footer>
      </main>
    </div>
  );
}

/* ---------- ECO RADAR ---------- */
function EcoRadar({ openNode, setOpenNode, gotoLive, gotoTwin, stats, lastSync }: any) {
  const node = openNode ? nodeById(openNode) : null;
  return (
    <div className="grid cols-radar">
      <div className="grid">
        <div className="grid cols-stats">
          {[
            ['Network Health', '98.4 %', ''], ['Detected Anomalies', String(stats.warning + stats.critical), 'warn'],
            ['Critical Events', String(stats.critical), 'crit'], ['Nodes Online', stats.online.toLocaleString(), ''],
            ['Areas Monitored', '15', ''],
          ].map(([l, v, c]) => (
            <div key={l as string} className="card" style={{ padding: '14px 24px' }}>
              <div className="label">{l}</div>
              <div className={`metric-num ${c}`} style={{ fontSize: 22 }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Map</h2>
            <span className="chip green"><span className="sdot" style={{ background: 'currentColor' }} /> LIVE</span>
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>Last network synchronization {lastSync}s ago</span>
            <div style={{ flex: 1 }} />
            <span className="chip green"><span className="sdot" style={{ background: 'currentColor' }} /> Normal {stats.healthy}</span>
            <span className="chip yellow"><span className="sdot" style={{ background: 'currentColor' }} /> Warning {stats.warning}</span>
            <span className="chip red"><span className="sdot" style={{ background: 'currentColor' }} /> Critical {stats.critical}</span>
            <span className="chip grey"><span className="sdot" style={{ background: 'currentColor' }} /> Offline {stats.offline}</span>
          </div>
          <div style={{ position: 'relative', background: 'radial-gradient(ellipse at center, #0d1f14 0%, #060a08 75%)', borderRadius: 14, padding: 8 }}>
            <svg viewBox="0 0 940 460" width="100%">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M40 0H0V40" fill="none" stroke="#14291b" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="940" height="460" fill="url(#grid)" rx="12" />
              {AREAS.map(a => (
                <g key={a.id} onClick={() => gotoTwin(a.id)} style={{ cursor: 'pointer' }}>
                  <path d={a.path} fill={a.status === 'CRITICAL' ? 'rgba(248,113,113,.08)' : a.status === 'ELEVATED' ? 'rgba(250,204,21,.06)' : 'rgba(74,222,128,.05)'} stroke={statusColor(a.status)} strokeOpacity="0.35" strokeWidth="1.2" />
                  <text x={a.x} y={a.y - 62} fill="var(--text3)" fontSize="10" textAnchor="middle">{areaLabel(a.id)}</text>
                </g>
              ))}
            </svg>
            {NODES.map(n => (
              <div key={n.id} className="node-dot" title={n.name}
                style={{ left: `${(n.x / 940) * 100}%`, top: `calc(${(n.y / 460) * 100}% * 0.98)`, background: statusColor(n.status), color: statusColor(n.status) }}
                onClick={(e) => { e.stopPropagation(); setOpenNode(n.id); }} />
            ))}
          </div>
        </div>
      </div>
      <div className="card sticky-panel" style={{ alignSelf: 'start', position: 'sticky', top: 80 }}>
        {node ? <NodePanel node={node} gotoLive={gotoLive} gotoTwin={gotoTwin} /> : (
          <div style={{ color: 'var(--text3)', padding: 30, textAlign: 'center' }}>Select a node on the radar to inspect live telemetry.</div>
        )}
      </div>
    </div>
  );
}

function NodePanel({ node, gotoLive, gotoTwin }: { node: SensorNode; gotoLive: (id: string) => void; gotoTwin: (a: number) => void }) {
  const r = node.reading;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{node.name}</h2>
        <span className={`chip ${node.status === 'healthy' ? 'green' : node.status === 'warning' ? 'yellow' : node.status === 'critical' ? 'red' : 'grey'}`}>
          {node.status === 'healthy' ? <><span className="sdot" style={{ background: 'currentColor' }} /> HEALTHY</> : node.status === 'warning' ? <><span className="sdot" style={{ background: 'currentColor' }} /> ANOMALY DETECTED</> : node.status === 'critical' ? <><span className="sdot" style={{ background: 'currentColor' }} /> CRITICAL ANOMALY</> : <><span className="sdot" style={{ background: 'currentColor' }} /> OFFLINE</>}
        </span>
      </div>
      <div className="grid cols-panel" style={{ marginTop: 14, gap: 10 }}>
        {[
          ['Temperature', `${r.temperature.toFixed(1)} °C`], ['Humidity', `${r.humidity.toFixed(0)} %`],
          ['Pressure', `${r.pressure.toFixed(1)} hPa`], ['Air Quality', `AQI ${r.aqi}`],
          ['CO₂', `${r.co2} ppm`], ['PM2.5', `${r.pm25} µg/m³`], ['PM10', `${r.pm10} µg/m³`],
          ['PM1', `${r.pm1} µg/m³`], ['Light', `${r.light.toLocaleString()} lx`],
          ['Wind', `${r.windSpeed.toFixed(1)} m/s ${r.windDir}°`], ['Rainfall', `${r.rainfall.toFixed(1)} mm/hr`],
          ['Battery', `${node.battery} %`], ['Signal', `${r.signal} dBm`],
          ['Last broadcast', `${node.lastSeenSec}s ago`], ['Uptime', `${node.uptimeDays}d 07h 42m`],
        ].map(([l, v]) => (
          <div key={l as string}><div className="label">{l}</div><div className="mono" style={{ fontSize: 15 }}>{v}</div></div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn fill" onClick={() => gotoLive(node.id)}>Live Data</button>
        <button className="btn tonal" onClick={() => gotoTwin(node.areaId)}>View Area</button>
      </div>
    </div>
  );
}

/* ---------- CLIMATE TWIN ---------- */
const scrubs = [['NOW', 0], ['◀ 1 hour', 6], ['◀ 6 hours', 24], ['◀ 24 hours', 48], ['◀ 7 days', 29]];
function ClimateTwin({ areaId, setAreaId, idx, setIdx }: { areaId: number; setAreaId: (a: number) => void; idx: number; setIdx: (i: number) => void }) {
  const nodes = nodesInArea(areaId);
  const anchor = [...nodes].sort((a) => (a.status === 'critical' ? -1 : 1))[0];
  const hist = anchor.history;
  const i = idx < 0 ? hist.length - 1 : Math.min(idx, hist.length - 1);
  const point = hist[i];
  const series = (k: keyof typeof hist[0]) => hist.map(h => ({ t: h.t, v: h[k] as number }));
  const areaStatus = AREAS.find(a => a.id === areaId)!;
  return (
    <div className="grid">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>Area</h1>
        <select value={areaId} onChange={e => { setAreaId(+e.target.value); setIdx(-1); }}>
          {AREAS.map(a => <option key={a.id} value={a.id}>{areaLabel(a.id)}</option>)}
        </select>
        <span className={`chip ${areaStatus.status === 'CRITICAL' ? 'red' : areaStatus.status === 'ELEVATED' ? 'yellow' : 'green'}`}>{areaStatus.status}</span>
        <div style={{ flex: 1 }} />
        {scrubs.map(([l, off]) => (
          <button key={l as string} className={`btn ${idx === -1 && off === 0 ? 'fill' : idx === hist.length - 1 - (off as number) && off !== 0 ? 'fill' : 'out'}`}
            onClick={() => setIdx(off === 0 ? -1 : hist.length - 1 - (off as number))}>{l}</button>
        ))}
      </div>
      <h2 className="mono" style={{ color: 'var(--primary)' }}>Environmental state · {point.t}</h2>
      <div className="grid cols-metrics">
        {[
          ['Temperature', `${point.temperature} °C`], ['Humidity', `${point.humidity} %`],
          ['AQI', `${point.aqi}`], ['Pressure', `${point.pressure} hPa`],
          ['CO₂', `${point.co2} ppm`], ['PM2.5', `${point.pm25} µg/m³`],
          ['Light', `${anchor.reading.light.toLocaleString()} lx`], ['Rainfall', `${anchor.reading.rainfall.toFixed(1)} mm/hr`],
        ].map(([l, v]) => (
          <div key={l as string} className="card" style={{ padding: '14px 24px' }}>
            <div className="label">{l}</div><div className="metric-num" style={{ fontSize: 22 }}>{v}</div>
          </div>
        ))}
      </div>
      <input type="range" min={0} max={hist.length - 1} value={i} onChange={e => setIdx(+e.target.value)} style={{ width: '100%', accentColor: 'var(--primary)' }} />
      <div className="grid cols-charts">
        {([['temperature', 'Temperature', ' °C'], ['humidity', 'Humidity', ' %'], ['aqi', 'AQI', ''], ['pressure', 'Pressure', ' hPa']] as const).map(([k, l, u]) => (
          <div key={k} className="card"><h2>{l}</h2><LineChart data={series(k)} unit={u} /></div>
        ))}
      </div>
      <div className="card">
        <h2>Area {String(areaId).padStart(2, '0')} — Environmental Twin</h2>
        <p style={{ color: 'var(--text2)', fontSize: 13 }}>
          Current condition: <b style={{ color: areaStatus.status === 'CRITICAL' ? 'var(--critical)' : areaStatus.status === 'ELEVATED' ? 'var(--warning)' : 'var(--primary)' }}>
            {areaStatus.status === 'CRITICAL' ? 'Critical environmental stress' : areaStatus.status === 'ELEVATED' ? 'Elevated environmental stress' : 'Within expected ranges'}
          </b> · {nodes.filter(n => n.status === 'healthy').length}/{nodes.length} nodes healthy · anchor node {anchor.id}
        </p>
      </div>
    </div>
  );
}

/* ---------- LIVE BROADCAST ---------- */
const METRICS = [
  ['temperature', 'Temperature', ' °C'], ['humidity', 'Humidity', ' %'], ['pressure', 'Pressure', ' hPa'],
  ['aqi', 'AQI', ''], ['co2', 'CO₂', ' ppm'], ['pm25', 'PM2.5', ' µg/m³'],
] as const;
function LiveBroadcast({ nodeId, setNodeId, gotoTwin }: { nodeId: string; setNodeId: (s: string) => void; gotoTwin: (a: number) => void }) {
  const node = nodeById(nodeId);
  const [metric, setMetric] = useState<typeof METRICS[number][0]>('temperature');
  const [area, setArea] = useState<number>(node.areaId);
  const areaNodes = nodesInArea(area);
  useEffect(() => { if (!areaNodes.find(n => n.id === nodeId)) setNodeId(areaNodes[0].id); }, [area]);
  const m = METRICS.find(m => m[0] === metric)!;
  return (
    <div className="grid">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>Live Node</h1>
        <select value={area} onChange={e => setArea(+e.target.value)}>
          {AREAS.map(a => <option key={a.id} value={a.id}>{areaLabel(a.id)}</option>)}
        </select>
        <select value={nodeId} onChange={e => setNodeId(e.target.value)}>
          {areaNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <span className="chip green"><span className="sdot" style={{ background: 'currentColor' }} /> LIVE</span>
        <span style={{ color: 'var(--text3)', fontSize: 12 }}>Broadcast latency: 1.8 s</span>
      </div>
      <div className="grid cols-metrics">
        {[
          ['Temperature', `${node.reading.temperature.toFixed(1)} °C`], ['Humidity', `${node.reading.humidity.toFixed(1)} %`],
          ['Pressure', `${node.reading.pressure.toFixed(1)} hPa`], ['CO₂', `${node.reading.co2} ppm`],
          ['PM2.5', `${node.reading.pm25} µg/m³`], ['AQI', `${node.reading.aqi}`],
          ['Wind', `${node.reading.windSpeed.toFixed(1)} m/s`], ['Light', `${node.reading.light.toLocaleString()} lx`],
        ].map(([l, v]) => (
          <div key={l as string} className="card" style={{ padding: '14px 24px' }}>
            <div className="label">{l}</div><div className="metric-num" style={{ fontSize: 22 }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {METRICS.map(mm => <button key={mm[0]} className={`btn ${metric === mm[0] ? 'fill' : 'out'}`} onClick={() => setMetric(mm[0])}>{mm[1]}</button>)}
        </div>
        <LineChart data={node.history.map(h => ({ t: h.t, v: h[metric] as number }))} unit={m[2]} />
        <div className="mono" style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
          {node.history.slice(-5).map(h => <div key={h.t}>{h.t} — {(h[metric] as number)}{m[2]}</div>)}
        </div>
      </div>
      <div className="grid cols-charts">
        <div className="card">
          <h2>Node Health</h2>
          {[['Battery', `${node.battery} %`], ['Signal', `${node.signal} dBm`], ['Sensor integrity', `${node.sensorIntegrity} %`], ['Firmware', node.firmware], ['Uptime', `${node.uptimeDays}d 07h 42m`], ['Last maintenance', node.lastMaintenance], ['Packet loss', `${node.packetLoss} %`]].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--outline)' }}>
              <span style={{ color: 'var(--text2)', fontSize: 13 }}>{l}</span><span className="mono">{v}</span>
            </div>
          ))}
          <button className="btn tonal" style={{ marginTop: 12 }} onClick={() => gotoTwin(node.areaId)}>Open Area Twin</button>
        </div>
        <div className="card">
          <h2>Raw Broadcast</h2>
          <pre className="mono" style={{ fontSize: 11, color: 'var(--mint)', background: 'var(--surface2)', padding: 12, borderRadius: 12, overflow: 'auto' }}>{JSON.stringify({
            node: node.id, timestamp: new Date().toISOString(), temperature: +node.reading.temperature.toFixed(1),
            humidity: +node.reading.humidity.toFixed(1), pressure: +node.reading.pressure.toFixed(1), co2: node.reading.co2,
            pm25: node.reading.pm25, aqi: node.reading.aqi,
            pm1: node.reading.pm1, pm10: node.reading.pm10, light_lux: node.reading.light,
            wind_m_s: +node.reading.windSpeed.toFixed(1), wind_dir_deg: node.reading.windDir,
            rainfall_mm_hr: +node.reading.rainfall.toFixed(1), battery: node.battery,
          }, null, 2)}</pre>
          <h2 style={{ marginTop: 12 }}>Sensor Stack</h2>
          {SENSOR_STACK.map(s => (
            <div key={s.model} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--outline)' }}>
              <span style={{ color: 'var(--text2)', fontSize: 13 }}>{s.parameter}</span><span className="mono">{s.model}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- BLACK BOX ---------- */
function BlackBox({ gotoLive, gotoTwin }: any) {
  const [q, setQ] = useState('');
  const [sev, setSev] = useState('ALL');
  const [area, setArea] = useState('ALL');
  const [open, setOpen] = useState<string | null>(null);
  const critical = EVENTS.filter(e => e.severity === 'CRITICAL' || (e.severity === 'WARNING' && e.status !== 'RESOLVED'));
  const filtered = EVENTS.filter(e =>
    (sev === 'ALL' || e.severity === sev) && (area === 'ALL' || e.areaId === +area) &&
    (q === '' || `${e.type} ${e.nodeId} ${areaLabel(e.areaId)} ${e.id}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="grid">
      <h1>Anomalies</h1>
      {critical.slice(0, 2).map(e => (
        <div key={e.id} className="card" style={{ borderColor: e.severity === 'CRITICAL' ? 'var(--critical)' : 'var(--warning)', borderWidth: 1.5 }}>
          <span className={`chip ${e.severity === 'CRITICAL' ? 'red' : 'yellow'}`}>{e.severity === 'CRITICAL' ? <><span className="sdot" style={{ background: 'currentColor' }} /> CRITICAL ENVIRONMENTAL ANOMALY</> : <><span className="sdot" style={{ background: 'currentColor' }} /> AIR QUALITY DEVIATION</>}</span>
          <h2 style={{ marginTop: 8 }}>{areaLabel(e.areaId)} · {e.nodeId}</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13 }}>{e.type} — measured <b>{e.measured}</b> vs expected <b>{e.expected}</b> ({e.deviation})</p>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text3)' }}>Detected {new Date(e.ts).toLocaleTimeString('en-GB')} · Confidence {e.confidence}% · Duration {e.duration} · Status {e.status}</div>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>Possible contributing signals: {e.sensors.join(', ')} · ⚑ FIELD INVESTIGATION RECOMMENDED</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn fill" onClick={() => gotoLive(e.nodeId)}>View Node</button>
            <button className="btn tonal" onClick={() => gotoTwin(e.areaId)}>View Area</button>
            <button className="btn out" onClick={() => setOpen(open === e.id ? null : e.id)}>Open Event</button>
            <button className="btn out">Acknowledge</button>
          </div>
        </div>
      ))}
      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input placeholder="Search events…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={sev} onChange={e => setSev(e.target.value)}>
            {['ALL', 'CRITICAL', 'WARNING', 'NOTICE', 'INFORMATION'].map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={area} onChange={e => setArea(e.target.value)}>
            <option value="ALL">All areas</option>
            {AREAS.map(a => <option key={a.id} value={a.id}>{areaLabel(a.id)}</option>)}
          </select>
        </div>
        {AREAS.filter(a => filtered.some(e => e.areaId === a.id)).map(a => (
          <div key={a.id} style={{ marginBottom: 14 }}>
            <h2 style={{ color: 'var(--primary)' }}>{areaLabel(a.id)}</h2>
            {filtered.filter(e => e.areaId === a.id).sort((x, y) => y.ts - x.ts).map(e => (
              <EventRow key={e.id} e={e} open={open === e.id} toggle={() => setOpen(open === e.id ? null : e.id)} />
            ))}
          </div>
        ))}
        {filtered.length === 0 && <p style={{ color: 'var(--text3)' }}>No events match the current filters.</p>}
      </div>
    </div>
  );
}
function EventRow({ e, open, toggle }: { e: BlackBoxEvent; open: boolean; toggle: () => void }) {
  return (
    <div style={{ borderBottom: '1px solid var(--outline)', padding: '8px 0' }}>
      <div onClick={toggle} className="event-row" style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
        <span className="mono" style={{ color: 'var(--text3)', fontSize: 12 }}>{new Date(e.ts).toLocaleTimeString('en-GB')}</span>
        <b>{e.type}</b><span style={{ color: 'var(--text2)' }}>{e.nodeId}</span>
        <span className={`chip ${sevChip(e.severity)}`}>{e.severity}</span>
        <span className="chip grey">{e.status}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10, padding: 12, background: 'var(--surface2)', borderRadius: 12 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--mint)' }}>{e.id}</div>
          <div className="grid cols-detail" style={{ marginTop: 8, fontSize: 12 }}>
            <div>Measured: <b>{e.measured}</b></div><div>Expected: <b>{e.expected}</b></div><div>Deviation: <b>{e.deviation}</b></div>
            <div>Duration: <b>{e.duration}</b></div><div>Confidence: <b>{e.confidence}%</b></div><div>Sensors: <b>{e.sensors.join(', ')}</b></div>
          </div>
          <h2 style={{ marginTop: 12 }}>Why was this flagged?</h2>
          <p style={{ fontSize: 12, color: 'var(--text2)' }}>
            Expected {e.type.toLowerCase()} range: <b>{e.explanation.expectedRange}</b> · Observed: <b>{e.explanation.observed}</b> · Deviation: <b>{e.explanation.deviation}</b> · Historical probability: <b>{e.explanation.probability}</b>
          </p>
          <ul style={{ fontSize: 12, color: 'var(--text2)', paddingLeft: 18 }}>{e.explanation.correlations.map(c => <li key={c}>{c}</li>)}</ul>
          <p style={{ fontSize: 12, color: 'var(--primary)' }}>Conclusion: {e.explanation.conclusion}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- ALERTS ---------- */
function Alerts({ gotoLive, gotoTwin }: any) {
  const groups: [string, BlackBoxEvent[]][] = [
    ['Active', EVENTS.filter(e => e.status === 'ACTIVE' || e.status === 'INVESTIGATING')],
    ['Acknowledged', EVENTS.filter(e => e.status === 'ACKNOWLEDGED')],
    ['Resolved', EVENTS.filter(e => e.status === 'RESOLVED')],
  ];
  return (
    <div className="grid">
      <h1>Alerts</h1>
      {groups.map(([g, evs]) => (
        <div key={g} className="card">
          <h2>{g} ({evs.length})</h2>
          {evs.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>No {g.toLowerCase()} alerts. No active anomalies — environmental signals are within expected ranges.</p>}
          {evs.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--outline)', flexWrap: 'wrap' }}>
              <span className={`chip ${sevChip(e.severity)}`}>{e.severity}</span>
              <b>{e.type}</b><span style={{ color: 'var(--text2)' }}>{areaLabel(e.areaId)} · {e.nodeId}</span>
              <span className="mono" style={{ color: 'var(--text3)', fontSize: 12 }}>{new Date(e.ts).toLocaleTimeString('en-GB')} · {e.duration}</span>
              <div style={{ flex: 1 }} />
              <button className="btn out" onClick={() => gotoLive(e.nodeId)}>Node</button>
              <button className="btn out" onClick={() => gotoTwin(e.areaId)}>Area</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- OVERVIEW ---------- */
function alertKind(type: string) {
  const s = type.toLowerCase();
  if (s.includes('temperature')) return 'temperature';
  if (s.includes('humidity')) return 'humidity';
  if (s.includes('pressure')) return 'pressure';
  if (s.includes('pm') || s.includes('aqi') || s.includes('air')) return 'air';
  if (s.includes('co₂') || s.includes('co2')) return 'co2';
  if (s.includes('rain')) return 'rain';
  if (s.includes('wind')) return 'wind';
  return 'other';
}

function Overview({ gotoLive, gotoTwin, gotoAlerts, gotoAnomalies, stats, lastSync }: any) {
  const active = EVENTS.filter(e => e.status === 'ACTIVE' || e.status === 'INVESTIGATING');
  const critical = active.filter(e => e.severity === 'CRITICAL');
  const featured = critical[0] ?? active.find(e => e.severity === 'WARNING') ?? active[0] ?? EVENTS[0];
  const others = active.filter(e => e.id !== featured.id);

  const buckets: { key: string; label: string }[] = [
    { key: 'temperature', label: 'Temperature' },
    { key: 'air', label: 'Air quality / PM' },
    { key: 'humidity', label: 'Humidity' },
    { key: 'pressure', label: 'Pressure' },
    { key: 'co2', label: 'CO₂' },
    { key: 'rain', label: 'Rainfall' },
    { key: 'wind', label: 'Wind' },
  ];
  const counts = buckets.map(b => ({ ...b, n: active.filter(e => alertKind(e.type) === b.key).length })).filter(b => b.n > 0);
  const maxCount = Math.max(1, ...counts.map(c => c.n));

  const [brief, setBrief] = useState<AiBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const alerts = active.length ? active : EVENTS.filter(e => e.severity === 'CRITICAL' || e.severity === 'WARNING');
      const areaIds = [...new Set(alerts.map(e => e.areaId))];
      const nodes = NODES.filter(n => areaIds.includes(n.areaId) && n.status !== 'offline');
      setBrief(await analyzeSituation({ alerts, nodes }, ctrl.signal));
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err?.message ?? 'AI analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); return () => abortRef.current?.abort(); }, []);

  const bannerClass = featured.severity === 'CRITICAL' ? 'crit' : featured.severity === 'WARNING' ? 'warn' : 'notice';

  return (
    <div className="grid">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>Overview</h1>
        <span className="chip green"><span className="pulse-dot" /> LIVE</span>
        <span style={{ color: 'var(--text3)', fontSize: 12 }}>Last sync {lastSync}s ago</span>
        <div style={{ flex: 1 }} />
        <button className="btn out" onClick={gotoAnomalies}>All Anomalies</button>
        <button className="btn tonal" onClick={gotoAlerts}>Alerts ({active.length})</button>
      </div>

      {/* ---- highlighted alert banner ---- */}
      <div className={`alert-banner ${bannerClass}`}>
        <span className="alert-pulse" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="label" style={{ color: 'inherit', opacity: .85 }}>{featured.severity} · ACTIVE ANOMALY</div>
          <h2 style={{ margin: '2px 0 6px' }}>{featured.type} — {areaLabel(featured.areaId)} · {featured.nodeId}</h2>
          <div style={{ fontSize: 13, opacity: .95 }}>
            measured <b>{featured.measured}</b> vs expected <b>{featured.expected}</b> ({featured.deviation}) · duration {featured.duration} · confidence {featured.confidence}%
          </div>
        </div>
        <button className="btn fill" onClick={() => gotoLive(featured.nodeId)}>View Node</button>
        <button className="btn out" onClick={() => gotoTwin(featured.areaId)}>View Area</button>
      </div>

      {/* ---- stats ---- */}
      <div className="grid cols-stats">
        {[
          ['Active Alerts', String(active.length), active.length ? 'warn' : ''],
          ['Critical Events', String(critical.length), critical.length ? 'crit' : ''],
          ['Nodes Online', `${stats.online.toLocaleString()} / ${stats.total}`, ''],
          ['Areas Monitored', '15', ''],
          ['Network Health', `${((stats.healthy / stats.total) * 100).toFixed(1)} %`, ''],
        ].map(([l, v, c]) => (
          <div key={l as string} className="card" style={{ padding: '14px 24px' }}>
            <div className="label">{l}</div>
            <div className={`metric-num ${c}`} style={{ fontSize: 22 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* ---- AI hero ---- */}
      <div className="card ai-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="ai-spark">✦</span>
          <h2 style={{ margin: 0 }}>AI Situation Brief</h2>
          <span className="chip grey mono" style={{ fontSize: 10 }}>{AI_MODEL_LABEL}</span>
          <div style={{ flex: 1 }} />
          <button className="btn out" onClick={run} disabled={loading}>{loading ? 'Analysing…' : 'Refresh'}</button>
        </div>

        {loading && !brief && (
          <p style={{ color: 'var(--text3)', marginTop: 14 }}>
            Analysing {active.length} active anomal{active.length === 1 ? 'y' : 'ies'} across the network…
          </p>
        )}
        {error && <div style={{ marginTop: 14 }}><span className="chip red">{error}</span></div>}

        {brief && (
          <>
            <p className="ai-headline">{brief.headline}</p>
            <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 8 }}>{brief.summary}</p>

            <div className="grid cols-charts" style={{ marginTop: 18 }}>
              <div>
                <div className="label">Why this is happening — likely causes</div>
                {brief.likelyCauses.map((c, i) => (
                  <div key={i} className="ai-cause">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <b style={{ fontSize: 13 }}>{c.cause}</b>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--primary)' }}>{c.confidence}%</span>
                    </div>
                    <div className="bar-track" style={{ marginTop: 5 }}><div className="bar-fill" style={{ width: `${c.confidence}%` }} /></div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 5 }}>{c.evidence}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="label">Recommended actions</div>
                {brief.actions.map((a, i) => (
                  <div key={i} className="ai-action">
                    <span className={`chip ${a.priority === 'HIGH' ? 'red' : a.priority === 'MEDIUM' ? 'yellow' : 'grey'}`}>{a.priority}</span>
                    <div>
                      <b style={{ fontSize: 13 }}>{a.action}</b>
                      {a.target && <span className="chip grey" style={{ marginLeft: 8, fontSize: 10 }}>{a.target}</span>}
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{a.rationale}</div>
                    </div>
                  </div>
                ))}
                {brief.watchlist.length > 0 && (
                  <>
                    <div className="label" style={{ marginTop: 14 }}>Keep monitoring</div>
                    <ul style={{ fontSize: 12, color: 'var(--text2)', paddingLeft: 18, margin: 0 }}>
                      {brief.watchlist.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---- anomalies ---- */}
      <div className="grid cols-charts">
        <div className="card">
          <h2>Anomaly Breakdown</h2>
          <div className="label">Active anomalies by signal type</div>
          {counts.map(c => (
            <div key={c.key} style={{ margin: '11px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)' }}>
                <span>{c.label}</span><span className="mono">{c.n}</span>
              </div>
              <div className="bar-track" style={{ marginTop: 4 }}>
                <div className="bar-fill" style={{ width: `${(c.n / maxCount) * 100}%` }} />
              </div>
            </div>
          ))}
          {counts.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>No active anomalies. Signals are within expected ranges.</p>}
        </div>
        <div className="card">
          <h2>Recent Anomalies</h2>
          <div className="label">Newest detections across the network</div>
          {[...EVENTS].sort((a, b) => b.ts - a.ts).slice(0, 6).map(e => (
            <div key={e.id} className="event-row" onClick={() => gotoLive(e.nodeId)}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--outline-variant)', cursor: 'pointer' }}>
              <span className={`chip ${sevChip(e.severity)}`}>{e.severity}</span>
              <b style={{ fontSize: 13 }}>{e.type}</b>
              <span style={{ color: 'var(--text2)', fontSize: 12 }}>{areaLabel(e.areaId)} · {e.nodeId}</span>
              <div style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(e.ts).toLocaleTimeString('en-GB')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---- remaining active alerts ---- */}
      {others.length > 0 && (
        <div className="card">
          <h2>Other Active Alerts ({others.length})</h2>
          {others.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--outline-variant)', flexWrap: 'wrap' }}>
              <span className={`chip ${sevChip(e.severity)}`}>{e.severity}</span>
              <b>{e.type}</b>
              <span style={{ color: 'var(--text2)', fontSize: 13 }}>{areaLabel(e.areaId)} · {e.nodeId}</span>
              <span className="mono" style={{ color: 'var(--text3)', fontSize: 12 }}>{e.deviation} · {e.duration}</span>
              <div style={{ flex: 1 }} />
              <button className="btn out" onClick={() => gotoLive(e.nodeId)}>Node</button>
              <button className="btn out" onClick={() => gotoTwin(e.areaId)}>Area</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
