import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FitParser from 'fit-file-parser';
import { Activity, BarChart3, ChevronDown, FileUp, Gauge, HeartPulse, Info, Layers3, Map as MapIcon, Mountain, RotateCcw, Route, Search, Table2, Timer, Upload, X, Zap } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ActivityMap from './components/ActivityMap';
import { altitude, duration, fieldLabel, getCoords, makeActivity, number, sportName, timestamp, valid } from './utils';
import './styles.css';

const parser = new FitParser({ mode: 'both', speedUnit: 'km/h', lengthUnit: 'km', temperatureUnit: 'celsius', elapsedRecordField: true });

async function parseFile(buffer, name) {
  const parsed = await parser.parseAsync(buffer);
  return makeActivity(parsed, name);
}

function Metric({ icon: Icon, label, value, unit, accent }) {
  return <div className="metric-card">
    <div className={`metric-icon ${accent || ''}`}><Icon size={18} /></div>
    <div><span>{label}</span><strong>{value} <small>{unit}</small></strong></div>
  </div>;
}

const tooltipStyle = { background: '#171b19', border: '1px solid #303633', borderRadius: 10, color: '#eef2ef', fontSize: 12 };
const formatWhole = (value) => number(value, 0);
const formatDecimal = (value) => number(value, 1);

const MetricChart = React.memo(function MetricChart({ title, data, color, unit, formatter = (v) => number(v, 0), gradientId, onHover }) {
  if (!data.some((d) => d.value !== null)) return null;
  return <article className="chart-card">
    <header><div><span className="eyebrow">PERFORMANCE</span><h3>{title}</h3></div><span className="chart-unit">{unit}</span></header>
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} syncId="activity-metrics" syncMethod="index" margin={{ top: 8, right: 4, left: -22, bottom: 0 }} onMouseMove={(state) => { const index = Number(state?.activeTooltipIndex); if (Number.isInteger(index)) onHover?.(data[index]?.i ?? index); }} onMouseLeave={() => onHover?.(null)}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.42}/><stop offset="100%" stopColor={color} stopOpacity={0}/></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="#29302c" strokeDasharray="3 5" />
        <XAxis dataKey="distance" tickFormatter={(v) => number(v, 1)} stroke="#7c8882" tickLine={false} axisLine={false} fontSize={10}/>
        <YAxis stroke="#7c8882" tickLine={false} axisLine={false} fontSize={10} domain={['auto', 'auto']}/>
        <Tooltip cursor={false} contentStyle={tooltipStyle} labelFormatter={(v) => `${number(v, 2)} km`} formatter={(v) => [`${formatter(v)} ${unit}`, title]}/>
        <Area connectNulls type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} activeDot={{ r: 4, fill: color, stroke: '#111' }}/>
      </AreaChart>
    </ResponsiveContainer>
  </article>;
});

function EmptyState({ onFile, loading, error }) {
  const input = useRef();
  const [drag, setDrag] = useState(false);
  const drop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); };
  return <main className="landing">
    <nav className="landing-nav"><Brand/><span>Private by design · Your files never leave this browser</span></nav>
    <section className="hero">
      <div className="hero-copy">
        <span className="pill"><span/> FIT ACTIVITY EXPLORER</span>
        <h1>Every effort has<br/>a <em>shape.</em></h1>
        <p>Turn your raw activity data into a clear, dimensional story. Explore your route, elevation, pace, heart rate, and every recorded metric.</p>
        <div className="feature-list"><span><MapIcon/> Open maps</span><span><Layers3/> 3D elevation</span><span><BarChart3/> Full FIT data</span></div>
      </div>
      <div className={`drop-card ${drag ? 'dragging' : ''}`} onDragEnter={(e) => {e.preventDefault(); setDrag(true)}} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDrag(false)} onDrop={drop}>
        <div className="drop-art"><Route/><i/><i/><i/></div>
        <h2>{loading ? 'Reading your activity…' : 'Open a FIT activity'}</h2>
        <p>Drop a <b>.fit</b> file here, or browse your device.</p>
        <button className="primary" disabled={loading} onClick={() => input.current.click()}><Upload size={17}/> Choose FIT file</button>
        <input ref={input} hidden type="file" accept=".fit,application/octet-stream" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}/>
        {error && <div className="error"><Info size={15}/>{error}</div>}
        <small><span>✓</span> Parsed locally in your browser</small>
      </div>
    </section>
    <footer>STRIDE ATLAS <span>Built with MapLibre · OpenStreetMap · deck.gl</span></footer>
  </main>;
}

function Brand() { return <div className="brand"><div><Route/></div><b>STRIDE <span>ATLAS</span></b></div>; }

function DataExplorer({ activity }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const size = 30;
  const fields = useMemo(() => activity.fields.filter((f) => f.toLowerCase().includes(query.toLowerCase())), [activity.fields, query]);
  const core = ['timestamp', 'distance', 'enhanced_speed', 'heart_rate', 'cadence', 'enhanced_altitude', 'power'];
  const columns = [...new Set([...core.filter((f) => activity.fields.includes(f)), ...fields])].slice(0, 10);
  const pages = Math.max(1, Math.ceil(activity.records.length / size));
  useEffect(() => setPage(0), [query]);
  return <section className="data-panel">
    <div className="data-head"><div><span className="eyebrow">COMPLETE RECORD STREAM</span><h2>FIT data explorer</h2><p>{activity.records.length.toLocaleString()} records · {activity.fields.length} record fields</p></div>
      <label className="search"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter fields…"/>{query && <X size={15} onClick={() => setQuery('')}/>}</label>
    </div>
    <div className="field-chips">{fields.slice(0, 16).map((f) => <span key={f}>{fieldLabel(f)}</span>)}{fields.length > 16 && <span>+{fields.length - 16}</span>}</div>
    <div className="table-wrap"><table><thead><tr><th>#</th>{columns.map((c) => <th key={c}>{fieldLabel(c)}</th>)}</tr></thead><tbody>
      {activity.records.slice(page * size, (page + 1) * size).map((r, i) => <tr key={page * size + i}><td>{page * size + i + 1}</td>{columns.map((c) => <td key={c}>{c === 'timestamp' ? timestamp(r[c]) : typeof r[c] === 'number' ? number(r[c], 2) : String(r[c] ?? '—')}</td>)}</tr>)}
    </tbody></table></div>
    <div className="pagination"><button disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button></div>
    <details className="raw-json"><summary>Raw parsed FIT messages <ChevronDown size={16}/></summary><pre>{JSON.stringify(activity.data, null, 2)}</pre></details>
  </section>;
}

function Dashboard({ activity, onReset }) {
  const [tab, setTab] = useState('overview');
  const [activeRecordIndex, setActiveRecordIndex] = useState(null);
  const hoverFrame = useRef(null);
  const pendingHoverIndex = useRef(null);
  const handleChartHover = useCallback((index) => {
    pendingHoverIndex.current = index;
    if (hoverFrame.current !== null) return;
    hoverFrame.current = requestAnimationFrame(() => {
      setActiveRecordIndex(pendingHoverIndex.current);
      hoverFrame.current = null;
    });
  }, []);
  const { session: s, records, geoRecords, altitudes } = activity;
  const chartData = useMemo(() => records.map((r, i) => ({
    i, distance: valid(r.distance) ? Number(r.distance) : i / Math.max(records.length - 1, 1) * Number(s.total_distance || 1),
    elevation: altitude(r) === null ? null : altitude(r) * 1000, heart: valid(r.heart_rate) ? Number(r.heart_rate) : null,
    speed: valid(r.enhanced_speed ?? r.speed) ? Number(r.enhanced_speed ?? r.speed) : null,
    power: valid(r.power) ? Number(r.power) : null,
  })), [records, s.total_distance]);
  const metricData = useMemo(() => ({
    elevation: chartData.map((d) => ({ ...d, value: d.elevation })),
    heart: chartData.map((d) => ({ ...d, value: d.heart })),
    speed: chartData.map((d) => ({ ...d, value: d.speed })),
    power: chartData.map((d) => ({ ...d, value: d.power }))
  }), [chartData]);
  const elevGain = s.total_ascent ?? (altitudes.length ? altitudes.slice(1).reduce((a, v, i) => a + Math.max(0, v - altitudes[i]), 0) : null);
  const start = s.start_time || records[0]?.timestamp;
  return <div className="app-shell">
    <header className="topbar"><Brand/><div className="activity-title"><span>{sportName(s.sport || s.sub_sport || 'Activity')}</span><b>{timestamp(start)}</b></div><button className="new-file" onClick={onReset}><FileUp size={17}/> New file</button></header>
    <nav className="tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><Gauge/>Overview</button><button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}><Table2/>All data</button><div/><span>{activity.fileName}</span></nav>
    {tab === 'overview' ? <main className="dashboard">
      <section className="summary-head"><div><span className="eyebrow">ACTIVITY REPORT</span><h1>{sportName(s.sport || 'Outdoor activity')}</h1><p>{timestamp(start)} · {geoRecords.length ? `${geoRecords.length.toLocaleString()} GPS points` : 'No GPS coordinates'}</p></div></section>
      <section className="metrics">
        <Metric icon={Route} label="Distance" value={number(s.total_distance ?? records.at(-1)?.distance, 2)} unit="km" accent="lime"/>
        <Metric icon={Timer} label="Moving time" value={duration(s.total_moving_time ?? s.total_timer_time ?? s.total_elapsed_time)} unit=""/>
        <Metric icon={Gauge} label="Avg speed" value={number(s.avg_speed, 1)} unit="km/h"/>
        <Metric icon={Mountain} label="Elevation gain" value={number(elevGain === null ? null : elevGain * 1000, 0)} unit="m" accent="orange"/>
        <Metric icon={HeartPulse} label="Avg heart rate" value={number(s.avg_heart_rate, 0)} unit="bpm" accent="red"/>
        <Metric icon={Zap} label="Avg power" value={number(s.avg_power, 0)} unit="W" accent="yellow"/>
      </section>
      <section className="map-section"><ActivityMap records={records} activeIndex={activeRecordIndex} onActiveIndexChange={handleChartHover}/></section>
      <section className="charts-grid">
        <MetricChart title="Elevation" data={metricData.elevation} color="#c7f36b" unit="m" formatter={formatWhole} gradientId="elev" onHover={handleChartHover}/>
        <MetricChart title="Heart rate" data={metricData.heart} color="#ff6b68" unit="bpm" gradientId="heart" onHover={handleChartHover}/>
        <MetricChart title="Speed" data={metricData.speed} color="#67c6ff" unit="km/h" formatter={formatDecimal} gradientId="speed" onHover={handleChartHover}/>
        <MetricChart title="Power" data={metricData.power} color="#ffca62" unit="W" gradientId="power" onHover={handleChartHover}/>
      </section>
    </main> : <main className="dashboard"><DataExplorer activity={activity}/></main>}
    <footer className="app-footer"><Brand/><span>Data stays on this device · Map © OpenStreetMap contributors</span></footer>
  </div>;
}

export default function App() {
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (file) => {
    if (!file.name.toLowerCase().endsWith('.fit')) { setError('Please choose a .fit activity file.'); return; }
    setLoading(true); setError('');
    try { setActivity(await parseFile(await file.arrayBuffer(), file.name)); }
    catch (e) { setError(`Could not read this FIT file: ${e?.message || e}`); }
    finally { setLoading(false); }
  }, []);
  return activity ? <Dashboard activity={activity} onReset={() => {setActivity(null); setError('')}}/> : <EmptyState onFile={load} loading={loading} error={error}/>;
}
