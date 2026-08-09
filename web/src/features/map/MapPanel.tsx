import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as LibreMap, MapMouseEvent, Marker, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTranslation } from 'react-i18next';
import type { AskAnswer, IntelCase, Settings } from '../../types';
import { formatCoordinate, isFiniteCoordinate, toMgrs } from '../../utils';

interface MapPanelProps {
  cases: IntelCase[];
  theme: Settings['theme'];
  selectedId: IntelCase['id'] | null;
  hoveredId: IntelCase['id'] | null;
  citedIds: Array<IntelCase['id']>;
  answerPattern?: AskAnswer['pattern'];
  onSelect: (item: IntelCase) => void;
  onHover: (id: IntelCase['id'] | null) => void;
  onExtentChange: (bounds: { north: number; south: number; east: number; west: number }) => void;
  onShowMissing: () => void;
}

interface Cluster { id: string; lat: number; lon: number; cases: IntelCase[] }
type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] };
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#091016' } }],
};

function affiliation(item: IntelCase) {
  return item.aktor === 'Egen' ? 'friend' : item.aktor === 'Misstänkt främmande' ? 'hostile' : item.aktor === 'Civil' ? 'civil' : 'unknown';
}

function statusClass(status: IntelCase['status']) {
  return status === 'Ny' ? 'new' : status === 'Under bearbetning' ? 'progress' : status === 'Uppföljning' ? 'followup' : 'closed';
}

function createClusters(cases: IntelCase[], zoom: number): Cluster[] {
  const located = cases.filter((item) => isFiniteCoordinate(item.lat) && isFiniteCoordinate(item.lon));
  if (zoom >= 8) return located.map((item) => ({ id: String(item.id), lat: item.lat as number, lon: item.lon as number, cases: [item] }));
  const size = zoom <= 4 ? 2.8 : zoom <= 5 ? 1.6 : zoom <= 6 ? 0.8 : 0.35;
  const buckets = new Map<string, IntelCase[]>();
  for (const item of located) {
    const key = `${Math.floor((item.lat as number) / size)}:${Math.floor((item.lon as number) / size)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  return [...buckets].map(([id, entries]) => ({
    id, cases: entries,
    lat: entries.reduce((sum, item) => sum + Number(item.lat), 0) / entries.length,
    lon: entries.reduce((sum, item) => sum + Number(item.lon), 0) / entries.length,
  }));
}

function gridCollection(bounds: maplibregl.LngLatBounds, zoom: number): FeatureCollection {
  if (zoom < 7) return EMPTY_COLLECTION;
  const step = zoom >= 10 ? 0.1 : zoom >= 8 ? 0.25 : 0.5;
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (let lon = Math.floor(bounds.getWest() / step) * step; lon <= bounds.getEast(); lon += step) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, bounds.getSouth()], [lon, bounds.getNorth()]] } });
  }
  for (let lat = Math.floor(bounds.getSouth() / step) * step; lat <= bounds.getNorth(); lat += step) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[bounds.getWest(), lat], [bounds.getEast(), lat]] } });
  }
  return { type: 'FeatureCollection', features };
}

function patternCollection(pattern: AskAnswer['pattern'] | undefined, cases: IntelCase[], cited: Set<string>): FeatureCollection {
  if (!pattern?.type) return EMPTY_COLLECTION;
  const coordinates = cases.filter((item) => cited.has(String(item.id)) && isFiniteCoordinate(item.lat) && isFiniteCoordinate(item.lon))
    .map((item) => [Number(item.lon), Number(item.lat)] as [number, number]);
  if (coordinates.length < 2) return EMPTY_COLLECTION;
  if (pattern.type === 'cluster') {
    const xs = coordinates.map(([x]) => x); const ys = coordinates.map(([, y]) => y); const pad = 0.15;
    const west = Math.min(...xs) - pad; const east = Math.max(...xs) + pad; const south = Math.min(...ys) - pad; const north = Math.max(...ys) + pad;
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[west, south], [west, north], [east, north], [east, south], [west, south]]] } }] };
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] };
}

function addBaseLayers(map: LibreMap, data: FeatureCollection) {
  map.addSource('geography', { type: 'geojson', data });
  map.addLayer({ id: 'land', type: 'fill', source: 'geography', filter: ['==', ['get', 'layer'], 'land'], paint: { 'fill-color': ['case', ['boolean', ['get', 'focus'], false], '#303a42', '#252d34'], 'fill-opacity': 1 } });
  map.addLayer({ id: 'lakes', type: 'fill', source: 'geography', filter: ['==', ['get', 'layer'], 'lake'], paint: { 'fill-color': '#1b526f', 'fill-opacity': 0.9 } });
  map.addLayer({ id: 'rivers', type: 'line', source: 'geography', filter: ['==', ['get', 'layer'], 'river'], paint: { 'line-color': '#4a9bc7', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 10, 2] } });
  map.addLayer({ id: 'secondary-roads', type: 'line', source: 'geography', minzoom: 5.5, filter: ['all', ['==', ['get', 'layer'], 'road'], ['==', ['get', 'road_type'], 'Secondary Highway']], paint: { 'line-color': '#caa94e', 'line-opacity': 0.82, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 2.2] } });
  map.addLayer({ id: 'major-roads-casing', type: 'line', source: 'geography', filter: ['all', ['==', ['get', 'layer'], 'road'], ['==', ['get', 'road_type'], 'Major Highway']], paint: { 'line-color': '#0b0d0f', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 5] } });
  map.addLayer({ id: 'major-roads', type: 'line', source: 'geography', filter: ['all', ['==', ['get', 'layer'], 'road'], ['==', ['get', 'road_type'], 'Major Highway']], paint: { 'line-color': '#68a378', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 10, 2.6] } });
  map.addLayer({ id: 'coastline', type: 'line', source: 'geography', filter: ['==', ['get', 'layer'], 'coastline'], paint: { 'line-color': '#77858e', 'line-width': 1 } });
  map.addLayer({ id: 'borders', type: 'line', source: 'geography', filter: ['==', ['get', 'layer'], 'border'], paint: { 'line-color': '#c0c8cd', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 9, 1.5], 'line-dasharray': [4, 3] } });
  map.addSource('grid', { type: 'geojson', data: EMPTY_COLLECTION });
  map.addLayer({ id: 'grid-lines', type: 'line', source: 'grid', paint: { 'line-color': '#74838d', 'line-width': 0.6, 'line-opacity': 0.35 } });
  map.addSource('pattern', { type: 'geojson', data: EMPTY_COLLECTION });
  map.addLayer({ id: 'pattern-fill', type: 'fill', source: 'pattern', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#f0568c', 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'pattern-line', type: 'line', source: 'pattern', paint: { 'line-color': '#f0568c', 'line-width': 2, 'line-dasharray': [4, 3] } });
}

export function MapPanel(props: MapPanelProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const caseMarkers = useRef<Marker[]>([]);
  const cityMarkers = useRef<Array<{ marker: Marker; rank: number; capital: boolean; strategic: boolean }>>([]);
  const callbackRef = useRef(props); callbackRef.current = props;
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [legend, setLegend] = useState(false);
  const [zoom, setZoom] = useState(5);
  const [cursor, setCursor] = useState({ lat: 62.2, lon: 17.2 });
  const locatedCases = useMemo(() => props.cases.filter((item) => isFiniteCoordinate(item.lat) && isFiniteCoordinate(item.lon)), [props.cases]);
  const missingCount = props.cases.length - locatedCases.length;
  const cited = useMemo(() => new Set(props.citedIds.map(String)), [props.citedIds]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/assets/map/nordic-baltic.geojson', { signal: controller.signal, cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<FeatureCollection>;
    }).then(setData).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !data) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: BASE_STYLE, center: [17.2, 62.2], zoom: 4.6, minZoom: 4, maxZoom: 12, maxBounds: [[3.4, 52.8], [33.6, 72]], attributionControl: false });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.on('load', () => {
      addBaseLayers(map, data);
      for (const feature of data.features.filter((item) => item.properties?.layer === 'city' && item.geometry.type === 'Point')) {
        const element = document.createElement('span'); element.className = 'city-label'; element.textContent = String(feature.properties?.name_sv ?? feature.properties?.name ?? '');
        const marker = new maplibregl.Marker({ element, anchor: 'left' }).setLngLat((feature.geometry as GeoJSON.Point).coordinates as [number, number]).addTo(map);
        cityMarkers.current.push({ marker, rank: Number(feature.properties?.scalerank ?? 10), capital: Boolean(feature.properties?.capital), strategic: Boolean(feature.properties?.strategic_label) });
      }
      setLoaded(true);
    });
    const extent = () => { const bounds = map.getBounds(); callbackRef.current.onExtentChange({ north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() }); setZoom(map.getZoom()); };
    map.on('moveend', extent); map.on('zoomend', extent);
    map.on('mousemove', (event: MapMouseEvent) => setCursor({ lat: event.lngLat.lat, lon: event.lngLat.lng }));
    return () => { caseMarkers.current.forEach((marker) => marker.remove()); cityMarkers.current.forEach(({ marker }) => marker.remove()); map.remove(); mapRef.current = null; };
  }, [data]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded) return;
    caseMarkers.current.forEach((marker) => marker.remove()); caseMarkers.current = [];
    for (const cluster of createClusters(props.cases, zoom)) {
      const first = cluster.cases[0]; const highlighted = cluster.cases.some((item) => cited.has(String(item.id)) || String(item.id) === String(props.selectedId) || String(item.id) === String(props.hoveredId));
      const element = document.createElement('button'); element.type = 'button'; element.className = `color-marker marker-${affiliation(first)}${highlighted ? ' is-highlighted' : ''}`;
      const color = document.createElement('span'); color.className = 'marker-actor'; color.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span'); copy.className = 'marker-copy';
      const name = document.createElement('b'); name.textContent = cluster.cases.length > 1 ? t('map.cluster', { count: cluster.cases.length }) : (first.slag?.trim() || t('map.unspecified'));
      const status = document.createElement('em'); status.className = `marker-status marker-status-${statusClass(first.status)}`; status.textContent = cluster.cases.length > 1 ? cluster.cases.map((item) => item.begrepp[0]).filter(Boolean).slice(0, 2).join(' · ') : t(`status.${first.status}`);
      copy.append(name, status); element.append(color, copy);
      element.addEventListener('click', () => cluster.cases.length === 1 ? callbackRef.current.onSelect(first) : map.easeTo({ center: [cluster.lon, cluster.lat], zoom: Math.min(9, map.getZoom() + 2) }));
      element.addEventListener('mouseenter', () => { if (cluster.cases.length === 1) callbackRef.current.onHover(first.id); });
      element.addEventListener('mouseleave', () => callbackRef.current.onHover(null));
      caseMarkers.current.push(new maplibregl.Marker({ element, anchor: 'left' }).setLngLat([cluster.lon, cluster.lat]).addTo(map));
    }
  }, [cited, loaded, props.cases, props.hoveredId, props.selectedId, t, zoom]);

  useEffect(() => {
    for (const entry of cityMarkers.current) {
      const visible = zoom <= 5 ? entry.capital || entry.strategic || entry.rank <= 3 : zoom <= 7 ? entry.rank <= 7 || entry.capital : true;
      entry.marker.getElement().style.display = visible ? '' : 'none';
    }
  }, [loaded, zoom]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded) return;
    (map.getSource('grid') as GeoJSONSource).setData(showGrid ? gridCollection(map.getBounds(), map.getZoom()) : EMPTY_COLLECTION);
  }, [loaded, showGrid, zoom]);

  useEffect(() => { const map = mapRef.current; if (map && loaded) (map.getSource('pattern') as GeoJSONSource).setData(patternCollection(props.answerPattern, props.cases, cited)); }, [cited, loaded, props.answerPattern, props.cases]);

  const fitCases = useCallback(() => {
    const map = mapRef.current; if (!map || !locatedCases.length) return;
    if (locatedCases.length === 1) map.easeTo({ center: [Number(locatedCases[0].lon), Number(locatedCases[0].lat)], zoom: 8 });
    else { const bounds = new maplibregl.LngLatBounds(); locatedCases.forEach((item) => bounds.extend([Number(item.lon), Number(item.lat)])); map.fitBounds(bounds, { padding: 45, maxZoom: 9 }); }
  }, [locatedCases]);

  return <section className="map-panel" aria-label={t('map.title')}>
    <div className="map-wrap">
      <div ref={containerRef} className="ops-map" />
      <div className="map-floating-tools">
        {missingCount > 0 && <button className="missing-position-button" type="button" onClick={props.onShowMissing}>{t('map.missing', { count: missingCount })}</button>}
        <button className={`icon-button${showGrid ? ' is-active' : ''}`} type="button" title={showGrid ? t('map.gridOff') : t('map.gridOn')} onClick={() => setShowGrid((value) => !value)}>GRID</button>
        <button className="icon-button" type="button" title={t('map.fit')} onClick={fitCases}>FIT</button>
        <button className={`icon-button${legend ? ' is-active' : ''}`} type="button" title={t('map.legend')} onClick={() => setLegend((value) => !value)}>KEY</button>
      </div>
      {!data && !failed && <div className="map-loading">{t('app.loading')}</div>}
      {failed && <div className="map-warning">{t('map.mapUnavailable')}</div>}
      {locatedCases.length === 0 && <div className="map-empty-state"><strong>{t('map.noPositionedTitle')}</strong><span>{t('map.noPositionedBody')}</span></div>}
      {legend && <div className="map-legend panel-float"><header><strong>{t('map.legend')}</strong><button type="button" aria-label={t('app.close')} onClick={() => setLegend(false)}>×</button></header><span><i className="legend-ground" />{t('map.ground')}</span><span><i className="legend-line legend-water" />{t('map.water')}</span><span><i className="legend-line legend-road" />{t('map.roads')}</span><span><i className="legend-line legend-highway" />{t('map.highways')}</span><span><i className="legend-line legend-border" />{t('map.borders')}</span></div>}
    </div>
    <footer className="coordinate-readout"><span className="eyebrow">{t('map.coordinates')}</span><code>{toMgrs(cursor.lat, cursor.lon) ?? '—'}</code><code>{formatCoordinate(cursor.lat)}, {formatCoordinate(cursor.lon)}</code></footer>
  </section>;
}
