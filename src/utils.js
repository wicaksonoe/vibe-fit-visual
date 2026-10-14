export const valid = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));

export function duration(seconds) {
  if (!valid(seconds)) return '—';
  const s = Math.round(Number(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function number(value, digits = 0) {
  if (!valid(value)) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function timestamp(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function sportName(value = 'Activity') {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getRecords(data) {
  if (Array.isArray(data?.records)) return data.records;
  return data?.activity?.sessions?.flatMap((s) => s.laps?.flatMap((l) => l.records || []) || []) || [];
}

export function getSession(data) {
  return data?.sessions?.[0] || data?.activity?.sessions?.[0] || {};
}

export function getCoords(record) {
  const lon = Number(record.position_long ?? record.longitude);
  const lat = Number(record.position_lat ?? record.latitude);
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

export function altitude(record) {
  const value = record.enhanced_altitude ?? record.altitude;
  return valid(value) ? Number(value) : null;
}

export function makeActivity(data, fileName) {
  const records = getRecords(data);
  const session = getSession(data);
  const geoRecords = records.filter(getCoords);
  const altitudes = geoRecords.map(altitude).filter((v) => v !== null);
  const fields = [...new Set(records.flatMap(Object.keys))];
  return { data, records, session, geoRecords, altitudes, fields, fileName };
}

export function boundsFor(records) {
  const coords = records.map(getCoords).filter(Boolean);
  if (!coords.length) return null;
  return coords.reduce((b, [x, y]) => ({ minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x), minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

export function metricSeries(records, key) {
  return records.map((r, i) => ({
    i,
    time: r.timestamp,
    distance: valid(r.distance) ? Number(r.distance) : i,
    value: valid(r[key]) ? Number(r[key]) : null,
    altitude: altitude(r)
  })).filter((p) => p.value !== null);
}

export function fieldLabel(key) {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
