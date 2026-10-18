import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { LineLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import MapGL from 'react-map-gl/maplibre';
import { Compass, Layers3, LocateFixed, Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import { altitude, boundsFor, duration, getCoords, number } from '../utils';
import 'maplibre-gl/dist/maplibre-gl.css';

const mapStyle = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
    terrain: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', maxzoom: 15, attribution: 'Elevation © Mapzen' }
  },
  layers: [
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.75, 'raster-contrast': 0.08, 'raster-brightness-min': 0.12, 'raster-brightness-max': 0.74 } },
    { id: 'hillshade', type: 'hillshade', source: 'terrain', paint: { 'hillshade-shadow-color': '#152019', 'hillshade-highlight-color': '#b9c4bc', 'hillshade-accent-color': '#617063', 'hillshade-exaggeration': 0.32 } }
  ]
};

// Elevation is normalized to this fixed visual ceiling instead of using a
// real-world 1:1 meter scale. This keeps flat and mountainous routes legible.
const VISUAL_ELEVATION_CEILING = 1200;
const FOLLOW_BEARING_OFFSET = -25;

function bearingBetween([lon1, lat1], [lon2, lat2]) {
  const toRadians = (value) => value * Math.PI / 180;
  const y = Math.sin(toRadians(lon2 - lon1)) * Math.cos(toRadians(lat2));
  const x = Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) - Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(toRadians(lon2 - lon1));
  return Math.atan2(y, x) * 180 / Math.PI;
}

function viewFor(records, is3d = true) {
  const b = boundsFor(records);
  if (!b) return { longitude: 0, latitude: 20, zoom: 2, pitch: is3d ? 50 : 0, bearing: 0 };
  const span = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * 1.5, 0.001);
  const zoom = Math.min(15, Math.max(3, Math.log2(90 / span) - 1));
  return { longitude: (b.minX + b.maxX) / 2, latitude: (b.minY + b.maxY) / 2, zoom, pitch: is3d ? 55 : 0, bearing: is3d ? -28 : 0 };
}

export default function ActivityMap({ records, activeIndex = null, onActiveIndexChange }) {
  const [is3d, setIs3d] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayDuration, setReplayDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mapCardRef = useRef(null);
  const playbackFrame = useRef(null);
  const [viewState, setViewState] = useState(() => viewFor(records, true));
  useEffect(() => setViewState(viewFor(records, is3d)), [records]);
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === mapCardRef.current);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
  useEffect(() => {
    if (!isPlaying || !records.length) return undefined;
    const startIndex = activeIndex === null || activeIndex >= records.length - 1 ? 0 : activeIndex;
    const startedAt = performance.now();
    const fullReplayMs = (replayDuration > 0 ? replayDuration : 45) * 1000;
    const remainingReplayMs = fullReplayMs * (1 - startIndex / Math.max(records.length - 1, 1));
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(remainingReplayMs, 1));
      const index = Math.min(records.length - 1, Math.round(startIndex + progress * (records.length - 1 - startIndex)));
      onActiveIndexChange?.(index);
      if (progress < 1) playbackFrame.current = requestAnimationFrame(tick);
      else setIsPlaying(false);
    };
    playbackFrame.current = requestAnimationFrame(tick);
    return () => { if (playbackFrame.current !== null) cancelAnimationFrame(playbackFrame.current); };
  }, [isPlaying, records.length, onActiveIndexChange, replayDuration]);

  const { layers, elevatedPoints } = useMemo(() => {
    // Copy only the coordinates and altitude needed by the map. Never attach or
    // modify source FIT records: charts, summaries, speed, heart rate, and the
    // data explorer continue to use the original samples unchanged.
    const points = records.map((r, sourceIndex) => ({ coord: getCoords(r), alt: altitude(r), sourceIndex })).filter((p) => p.coord);
    const elevations = points.map((p) => p.alt).filter((v) => v !== null);
    const hasElevation = elevations.length > 1 && Math.max(...elevations) !== Math.min(...elevations);
    const min = elevations.length ? Math.min(...elevations) : 0;
    const max = elevations.length ? Math.max(...elevations) : 0;
    const spread = max - min;

    // Merge samples into approximately 30–35 m cells. Each cell is also blended
    // with its eight neighbors, giving repeated trail passes one shared height
    // without producing abrupt, jagged steps at cell boundaries.
    const MERGE_CELL_DEGREES = 0.0003;
    const locationCell = ([lon, lat]) => [Math.round(lon / MERGE_CELL_DEGREES), Math.round(lat / MERGE_CELL_DEGREES)];
    const cellKey = ([x, y]) => `${x}:${y}`;
    const elevationBuckets = new Map();
    points.forEach((p) => {
      if (p.alt === null) return;
      const cell = locationCell(p.coord);
      const key = cellKey(cell);
      const bucket = elevationBuckets.get(key) || { total: 0, count: 0 };
      bucket.total += p.alt;
      bucket.count += 1;
      elevationBuckets.set(key, bucket);
    });

    const routeVisualElevation = new Map();
    elevationBuckets.forEach((_, key) => {
      const [x, y] = key.split(':').map(Number);
      let total = 0;
      let count = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const neighbor = elevationBuckets.get(cellKey([x + dx, y + dy]));
          if (neighbor) {
            total += neighbor.total;
            count += neighbor.count;
          }
        }
      }
      routeVisualElevation.set(key, total / count);
    });

    let lastAltitude = min;
    const elevatedPoints = points.map((p) => {
      const key = cellKey(locationCell(p.coord));
      const locationAltitude = routeVisualElevation.get(key) ?? p.alt;
      if (locationAltitude !== null) lastAltitude = locationAltitude;
      const percent = hasElevation ? Math.max(0, Math.min(1, (lastAltitude - min) / spread)) : 0;
      const z = is3d && hasElevation ? 20 + percent * VISUAL_ELEVATION_CEILING : 8;
      return { ...p, key, percent, position: [...p.coord, z] };
    });
    const path = elevatedPoints.map((p) => p.position);
    const footprint = elevatedPoints.map((p) => [...p.coord, 5]);
    const segments = elevatedPoints.slice(1).map((point, i) => {
      const previous = elevatedPoints[i];
      const percent = (previous.percent + point.percent) / 2;
      return {
        path: [previous.position, point.position],
        percent,
        label: `Normalized elevation ${Math.round(percent * 100)}%`
      };
    });
    // A dense, translucent curtain makes the normalized height readable while
    // keeping the map visible through it. Cap the guides to avoid overdraw on
    // FIT files containing tens of thousands of samples.
    const uniqueLocations = [...new Map(elevatedPoints.map((p) => [p.key, p])).values()];
    const guideStep = Math.max(1, Math.ceil(uniqueLocations.length / 350));
    const guides = is3d && hasElevation ? uniqueLocations.filter((_, i) => i % guideStep === 0).map((p) => ({
      ground: [...p.coord, 5],
      elevated: p.position
    })) : [];
    const start = path[0], end = path.at(-1);
    const layers = [
      new PathLayer({ id: 'route-footprint', data: footprint.length ? [{ path: footprint }] : [], getPath: d => d.path, getColor: [5, 10, 7, 175], getWidth: 7, widthMinPixels: 6, widthUnits: 'pixels', jointRounded: true, capRounded: true }),
      new LineLayer({ id: 'elevation-curtain', data: guides, getSourcePosition: d => d.ground, getTargetPosition: d => d.elevated, getColor: [255, 48, 48, 96], getWidth: 1.5, widthUnits: 'pixels', widthMinPixels: 1 }),
      new PathLayer({ id: 'route', data: segments, getPath: d => d.path, getColor: [199, 243, 107], getWidth: 4, widthMinPixels: 3, widthUnits: 'pixels', jointRounded: true, capRounded: true, pickable: true }),
      new ScatterplotLayer({ id: 'endpoints', data: start ? [{p:start, color:[199,243,107], label:'Start'}, {p:end, color:[255,111,91], label:'Finish'}] : [], getPosition: d => d.p, getFillColor: d => d.color, getRadius: 7, radiusUnits: 'pixels', stroked: true, getLineColor: [17,20,18], lineWidthMinPixels: 3, pickable: true })
    ];
    return { layers, elevatedPoints };
  }, [records, is3d]);

  const highlightedRouteIndex = useMemo(() => {
    if (activeIndex === null || !elevatedPoints.length) return -1;
    let low = 0;
    let high = elevatedPoints.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (elevatedPoints[middle].sourceIndex < activeIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0 && Math.abs(elevatedPoints[low - 1].sourceIndex - activeIndex) < Math.abs(elevatedPoints[low].sourceIndex - activeIndex)) return low - 1;
    return low;
  }, [activeIndex, elevatedPoints]);
  const highlightedPoint = highlightedRouteIndex >= 0 ? elevatedPoints[highlightedRouteIndex] : null;
  useEffect(() => {
    if (!isPlaying || !highlightedPoint) return;
    const averageCoordinates = (from, to) => {
      const start = Math.max(0, from);
      const end = Math.min(elevatedPoints.length - 1, to);
      let longitude = 0;
      let latitude = 0;
      let count = 0;
      for (let index = start; index <= end; index += 1) {
        longitude += elevatedPoints[index].coord[0];
        latitude += elevatedPoints[index].coord[1];
        count += 1;
      }
      return count ? [longitude / count, latitude / count] : highlightedPoint.coord;
    };

    // Keep the marker on the raw sample, but move the camera along an averaged
    // path so small GPS zigzags do not shake the viewport.
    const [targetLongitude, targetLatitude] = averageCoordinates(highlightedRouteIndex - 12, highlightedRouteIndex + 12);
    const directionFrom = averageCoordinates(highlightedRouteIndex - 32, highlightedRouteIndex - 16);
    const directionTo = averageCoordinates(highlightedRouteIndex + 28, highlightedRouteIndex + 52);
    // Offset the forward-facing camera 25° to the right, exposing more of the
    // upcoming route and its elevation curtain.
    const targetBearing = bearingBetween(directionFrom, directionTo) + FOLLOW_BEARING_OFFSET;

    setViewState((current) => {
      const centerEase = 0.16;
      const bearingEase = 0.1;
      const longitude = current.longitude + (targetLongitude - current.longitude) * centerEase;
      const latitude = current.latitude + (targetLatitude - current.latitude) * centerEase;
      let bearing = current.bearing;
      if (Number.isFinite(targetBearing)) {
        const shortestTurn = ((targetBearing - current.bearing + 540) % 360) - 180;
        bearing = current.bearing + shortestTurn * bearingEase;
      }
      return { ...current, longitude, latitude, bearing };
    });
  }, [isPlaying, highlightedPoint, highlightedRouteIndex, elevatedPoints]);
  const highlightLayers = useMemo(() => highlightedPoint ? [
    new LineLayer({ id: 'active-point-guide', data: [{ ground: [...highlightedPoint.coord, 5], elevated: highlightedPoint.position }], getSourcePosition: d => d.ground, getTargetPosition: d => d.elevated, getColor: [255, 255, 255, 190], getWidth: 2, widthUnits: 'pixels' }),
    new ScatterplotLayer({ id: 'active-route-point', data: [highlightedPoint], getPosition: d => d.position, getFillColor: [199, 243, 107], getRadius: 9, radiusUnits: 'pixels', stroked: true, getLineColor: [255, 255, 255], lineWidthMinPixels: 3 })
  ] : [], [highlightedPoint]);
  const displayLayers = [...layers, ...highlightLayers];
  const highlightedRecord = highlightedPoint ? records[highlightedPoint.sourceIndex] : null;
  const rollingMetrics = useMemo(() => {
    if (!highlightedPoint) return { speed: null, heartRate: null };
    const endIndex = highlightedPoint.sourceIndex;
    const endRecord = records[endIndex];
    const recordTime = (record, index) => {
      if (Number.isFinite(Number(record?.timer_time))) return Number(record.timer_time);
      const timestamp = new Date(record?.timestamp).getTime();
      return Number.isFinite(timestamp) ? timestamp / 1000 : index;
    };
    const endTime = recordTime(endRecord, endIndex);
    let speedTotal = 0;
    let speedCount = 0;
    let heartRateTotal = 0;
    let heartRateCount = 0;
    for (let index = endIndex; index >= 0; index -= 1) {
      const record = records[index];
      if (endTime - recordTime(record, index) > 180) break;
      const speed = Number(record?.enhanced_speed ?? record?.speed);
      if (Number.isFinite(speed)) {
        speedTotal += speed;
        speedCount += 1;
      }
      const heartRate = Number(record?.heart_rate);
      if (Number.isFinite(heartRate)) {
        heartRateTotal += heartRate;
        heartRateCount += 1;
      }
    }
    return {
      speed: speedCount ? speedTotal / speedCount : null,
      heartRate: heartRateCount ? heartRateTotal / heartRateCount : null
    };
  }, [highlightedPoint, records]);
  const timelineIndex = activeIndex ?? 0;
  const timelineRecord = records[timelineIndex] || records[0];
  const firstRecord = records[0];
  const lastRecord = records.at(-1);
  const elapsedSeconds = timelineRecord?.timer_time ?? ((new Date(timelineRecord?.timestamp) - new Date(firstRecord?.timestamp)) / 1000);
  const totalSeconds = lastRecord?.timer_time ?? ((new Date(lastRecord?.timestamp) - new Date(firstRecord?.timestamp)) / 1000);

  if (!records.some(getCoords)) return <div className="no-map"><MapIcon/><h3>No GPS route in this file</h3><p>The recorded metrics are still available below.</p></div>;
  const reset = () => setViewState(viewFor(records, is3d));
  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) await mapCardRef.current?.requestFullscreen();
    else await document.exitFullscreen();
  };
  const toggle3d = () => { const next = !is3d; setIs3d(next); setViewState(v => ({ ...v, pitch: next ? 55 : 0, bearing: next ? -28 : 0, transitionDuration: 600 })); };
  return <div className="map-card" ref={mapCardRef}>
    <div className="map-heading"><div><span className="eyebrow">ROUTE EXPLORER</span><h2>Your activity, in context</h2></div><div className="map-actions"><button className={is3d ? 'active' : ''} onClick={toggle3d}><Layers3 size={16}/>{is3d ? '3D view' : '2D view'}</button><button onClick={reset} title="Fit route"><LocateFixed size={17}/></button><button onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Open fullscreen'}>{isFullscreen ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button></div></div>
    <div className="map-canvas">
      <DeckGL layers={displayLayers} viewState={viewState} onViewStateChange={({viewState}) => setViewState(viewState)} controller getTooltip={({object}) => object?.label || null}>
        <MapGL mapStyle={mapStyle} attributionControl={false} maxPitch={75}/>
      </DeckGL>
      <div className="map-note"><Compass size={15}/><span>Drag to pan · Shift + drag to rotate · Scroll to zoom</span></div>
      {!isPlaying && <div className="map-timeline">
        <button className="timeline-reset" onClick={() => { setIsPlaying(false); onActiveIndexChange?.(0); }} title="Restart"><RotateCcw size={14}/></button>
        <button className="timeline-play" onClick={() => setIsPlaying(true)} title={`Play ${replayDuration > 0 ? replayDuration : 45}-second replay`}><Play size={16}/></button>
        <span>{duration(elapsedSeconds)}</span>
        <input aria-label="Activity timeline" type="range" min="0" max={Math.max(0, records.length - 1)} value={timelineIndex} onChange={(event) => onActiveIndexChange?.(Number(event.target.value))}/>
        <span>{duration(totalSeconds)}</span>
        <label className="replay-duration" title="0 uses the default 45-second replay"><span>Finish in</span><input aria-label="Replay duration in seconds" type="number" min="0" step="1" value={replayDuration} onChange={(event) => setReplayDuration(Math.max(0, Number(event.target.value) || 0))}/><em>sec</em></label>
        <b>REPLAY</b>
      </div>}
      {isPlaying && <button className="playback-pause-overlay" onClick={() => setIsPlaying(false)} aria-label="Pause activity replay"><span><Pause size={15}/> Tap to pause</span></button>}
      {highlightedRecord && <div className="map-hover-metrics"><span>SELECTED SAMPLE</span><b>{number(highlightedRecord.distance, 2)} km</b><dl><div><dt>Elevation</dt><dd>{number(altitude(highlightedRecord) === null ? null : altitude(highlightedRecord) * 1000, 0)} m</dd></div><div><dt>Heart rate</dt><dd>{rollingMetrics.heartRate === null ? '—' : `${number(rollingMetrics.heartRate, 0)} bpm`}</dd></div><div><dt>Speed</dt><dd>{rollingMetrics.speed === null ? '—' : `${number(rollingMetrics.speed, 0)} km/h`}</dd></div></dl></div>}
    </div>
  </div>;
}

function MapIcon() { return <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></svg>; }
