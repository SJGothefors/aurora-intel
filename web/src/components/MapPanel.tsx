import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L, { type LatLngBoundsExpression } from 'leaflet';
import milsymbol from 'milsymbol';
import { useTranslation } from 'react-i18next';
import type { AskAnswer, IntelCase, VocabularyTerm } from '../types';
import { formatCoordinate, isFiniteCoordinate, sidcForActor, toMgrs } from '../utils';

const REGION_BOUNDS: LatLngBoundsExpression = [
  [52.8, 3.4],
  [72.0, 33.6],
];

interface MapPanelProps {
  cases: IntelCase[];
  vocabulary: VocabularyTerm[];
  selectedId: IntelCase['id'] | null;
  hoveredId: IntelCase['id'] | null;
  citedIds: Array<IntelCase['id']>;
  answerPattern?: AskAnswer['pattern'];
  onSelect: (item: IntelCase) => void;
  onHover: (id: IntelCase['id'] | null) => void;
  onExtentChange: (bounds: { north: number; south: number; east: number; west: number }) => void;
  onShowMissing: () => void;
}

interface Cluster {
  id: string;
  lat: number;
  lon: number;
  cases: IntelCase[];
}

function actorAffiliation(actor: IntelCase['aktor']): string {
  return actor === 'Egen' ? 'F' : actor === 'Misstänkt främmande' ? 'H' : actor === 'Civil' ? 'N' : 'U';
}

function symbolIcon(item: IntelCase, terms: VocabularyTerm[], highlighted: boolean): L.DivIcon {
  const term = terms.find((candidate) => item.begrepp.includes(candidate.name_sv));
  try {
    const symbol = new milsymbol.Symbol(sidcForActor(term?.sidc, item.aktor), {
      size: highlighted ? 34 : 29,
      uniqueDesignation: String(item.lopnr),
    });
    const canvas = symbol.asCanvas();
    const uri = canvas.toDataURL('image/png');
    return L.divIcon({
      className: `mil-marker${highlighted ? ' is-highlighted' : ''}`,
      html: `<img src="${uri}" width="${canvas.width}" height="${canvas.height}" alt="" />`,
      iconSize: [canvas.width, canvas.height],
      iconAnchor: [canvas.width / 2, canvas.height / 2],
    });
  } catch {
    const className = `fallback-marker affiliation-${actorAffiliation(item.aktor).toLowerCase()}${highlighted ? ' is-highlighted' : ''}`;
    return L.divIcon({ className, html: `<span>${item.lopnr}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  }
}

function createClusters(cases: IntelCase[], zoom: number): Cluster[] {
  const located = cases.filter((item) => isFiniteCoordinate(item.lat) && isFiniteCoordinate(item.lon));
  if (zoom >= 8) {
    return located.map((item) => ({ id: String(item.id), lat: item.lat as number, lon: item.lon as number, cases: [item] }));
  }
  const size = zoom <= 4 ? 2.8 : zoom <= 5 ? 1.6 : zoom <= 6 ? 0.8 : 0.35;
  const buckets = new Map<string, IntelCase[]>();
  for (const item of located) {
    const key = `${Math.floor((item.lat as number) / size)}:${Math.floor((item.lon as number) / size)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  return [...buckets.entries()].map(([id, entries]) => ({
    id,
    lat: entries.reduce((sum, item) => sum + (item.lat as number), 0) / entries.length,
    lon: entries.reduce((sum, item) => sum + (item.lon as number), 0) / entries.length,
    cases: entries,
  }));
}

function useGeoData() {
  const [data, setData] = useState<GeoJSON.GeoJsonObject | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/assets/map/nordic-baltic.geojson', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<GeoJSON.GeoJsonObject>;
      })
      .then(setData)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
      });
    return () => controller.abort();
  }, []);
  return { data, failed };
}

function renderTooltip(item: IntelCase, emptyLabel: string): string {
  const title = item.slag ?? item.place_name ?? emptyLabel;
  const place = item.place_name ?? item.mgrs ?? '—';
  const eyebrow = `#${item.lopnr} · ${item.begrepp[0] ?? item.status}`;
  return `<span class="map-tooltip__eyebrow">${escapeMarkup(eyebrow)}</span><strong>${escapeMarkup(title)}</strong><span>${escapeMarkup(place)}</span>`;
}

function escapeMarkup(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

export function MapPanel(props: MapPanelProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const geographyRef = useRef<L.GeoJSON | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const gridLayerRef = useRef<L.LayerGroup | null>(null);
  const patternLayerRef = useRef<L.LayerGroup | null>(null);
  const callbackRef = useRef(props);
  callbackRef.current = props;
  const { data, failed } = useGeoData();
  const [cursor, setCursor] = useState({ lat: 62.2, lon: 17.2 });
  const [showGrid, setShowGrid] = useState(false);
  const [legend, setLegend] = useState(false);
  const [zoom, setZoom] = useState(5);
  const locatedCases = useMemo(
    () => props.cases.filter((item) => isFiniteCoordinate(item.lat) && isFiniteCoordinate(item.lon)),
    [props.cases],
  );
  const missingCount = props.cases.length - locatedCases.length;
  const citedIdSet = useMemo(() => new Set(props.citedIds.map(String)), [props.citedIds]);
  const mgrs = toMgrs(cursor.lat, cursor.lon) ?? '—';

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [62.2, 17.2],
      zoom: 5,
      minZoom: 4,
      maxZoom: 11,
      maxBounds: REGION_BOUNDS,
      maxBoundsViscosity: 1,
      preferCanvas: true,
      zoomControl: false,
      attributionControl: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    gridLayerRef.current = L.layerGroup().addTo(map);
    patternLayerRef.current = L.layerGroup().addTo(map);
    const emitExtent = () => {
      const bounds = map.getBounds();
      callbackRef.current.onExtentChange({ north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() });
    };
    map.on('mousemove', (event: L.LeafletMouseEvent) => setCursor({ lat: event.latlng.lat, lon: event.latlng.lng }));
    map.on('zoomend', () => {
      setZoom(map.getZoom());
      emitExtent();
    });
    map.on('moveend', emitExtent);
    mapRef.current = map;
    emitExtent();
    window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      gridLayerRef.current = null;
      patternLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    geographyRef.current?.remove();
    const layer = L.geoJSON(data, {
      style(feature) {
        const layerName = String(feature?.properties?.layer ?? feature?.properties?.featurecla ?? '').toLowerCase();
        const isWater = /lake|river|water|ocean/.test(layerName);
        const isSweden = Boolean(feature?.properties?.focus) || String(feature?.properties?.name ?? '').toLowerCase() === 'sweden';
        return {
          color: isWater ? '#32414e' : '#45515b',
          fillColor: isWater ? '#0d151b' : isSweden ? '#252e34' : '#1d252b',
          fillOpacity: isWater ? 0.72 : 0.94,
          weight: isWater ? 0.65 : 0.9,
        };
      },
      pointToLayer(_, latlng) {
        return L.circleMarker(latlng, { radius: 1.5, color: '#73818b', weight: 1 });
      },
      onEachFeature(feature, layer) {
        if (String(feature.properties?.layer).toLowerCase() !== 'city') return;
        const name = String(feature.properties?.name ?? feature.properties?.name_sv ?? '');
        if (name) layer.bindTooltip(escapeMarkup(name), { permanent: true, direction: 'right', offset: [3, 0], className: 'city-label' });
      },
    }).addTo(map);
    layer.bringToBack();
    geographyRef.current = layer;
    return () => { layer.remove(); };
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const clusters = createClusters(props.cases, zoom);
    for (const cluster of clusters) {
      if (cluster.cases.length > 1) {
        const selected = cluster.cases.some((item) => String(item.id) === String(props.selectedId) || String(item.id) === String(props.hoveredId) || citedIdSet.has(String(item.id)));
        const marker = L.circleMarker([cluster.lat, cluster.lon], {
          radius: Math.min(24, 11 + Math.log2(cluster.cases.length) * 3),
          color: selected ? '#f6abc4' : '#a7b2ba',
          fillColor: selected ? '#f0568c' : '#263743',
          fillOpacity: selected ? 0.84 : 0.92,
          weight: selected ? 3 : 1.5,
        });
        marker.bindTooltip(`<strong>${escapeMarkup(t('map.cluster', { count: cluster.cases.length }))}</strong>`, {
          direction: 'top',
          className: 'ops-tooltip',
        });
        marker.on('click', () => map.flyTo([cluster.lat, cluster.lon], Math.min(10, zoom + 2), { duration: 0.35 }));
        layer.addLayer(marker);
        continue;
      }
      const item = cluster.cases[0];
      const highlighted = String(item.id) === String(props.selectedId) || String(item.id) === String(props.hoveredId) || citedIdSet.has(String(item.id));
      const marker = L.marker([cluster.lat, cluster.lon], {
        icon: symbolIcon(item, props.vocabulary, highlighted),
        zIndexOffset: highlighted ? 1000 : 0,
        keyboard: true,
        title: `#${item.lopnr} ${item.slag ?? ''}`,
      });
      marker.bindTooltip(renderTooltip(item, t('app.notAvailable')), { direction: 'top', offset: [0, -15], className: 'ops-tooltip' });
      marker.on('click', () => callbackRef.current.onSelect(item));
      marker.on('mouseover', () => callbackRef.current.onHover(item.id));
      marker.on('mouseout', () => callbackRef.current.onHover(null));
      layer.addLayer(marker);
    }
  }, [citedIdSet, props.cases, props.hoveredId, props.selectedId, props.vocabulary, t, zoom]);

  useEffect(() => {
    const layer = gridLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showGrid) return;
    for (let lat = 54; lat <= 72; lat += 2) {
      layer.addLayer(L.polyline([[lat, 4], [lat, 34]], { color: '#526777', opacity: 0.24, weight: 0.7, dashArray: '3 5', interactive: false }));
    }
    for (let lon = 4; lon <= 34; lon += 3) {
      layer.addLayer(L.polyline([[53, lon], [72, lon]], { color: '#526777', opacity: 0.24, weight: 0.7, dashArray: '3 5', interactive: false }));
    }
  }, [showGrid]);

  useEffect(() => {
    const layer = patternLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const points = props.cases
      .filter((item) => citedIdSet.has(String(item.id)) && isFiniteCoordinate(item.lat) && isFiniteCoordinate(item.lon))
      .sort((a, b) => (a.time_utc ?? '').localeCompare(b.time_utc ?? ''))
      .map((item) => [item.lat as number, item.lon as number] as [number, number]);
    const pattern = props.answerPattern;
    if (!pattern?.type || points.length < 2) return;
    if (pattern.type === 'cluster') {
      const latitudes = points.map(([lat]) => lat);
      const longitudes = points.map(([, lon]) => lon);
      const pad = 0.18;
      layer.addLayer(L.polygon([
        [Math.min(...latitudes) - pad, Math.min(...longitudes) - pad],
        [Math.min(...latitudes) - pad, Math.max(...longitudes) + pad],
        [Math.max(...latitudes) + pad, Math.max(...longitudes) + pad],
        [Math.max(...latitudes) + pad, Math.min(...longitudes) - pad],
      ], { color: '#f0568c', weight: 2, fillOpacity: 0.08, dashArray: '5 5', interactive: false }));
    } else {
      layer.addLayer(L.polyline(points, {
        color: '#f0568c',
        weight: 3,
        opacity: 0.9,
        dashArray: pattern.type === 'trend' ? '6 6' : undefined,
        interactive: false,
      }));
    }
  }, [citedIdSet, props.answerPattern, props.cases]);

  const fitCases = useCallback(() => {
    const map = mapRef.current;
    if (!map || !locatedCases.length) return;
    if (locatedCases.length === 1) {
      map.flyTo([locatedCases[0].lat as number, locatedCases[0].lon as number], 8, { duration: 0.4 });
    } else {
      const bounds = L.latLngBounds(locatedCases.map((item) => [item.lat as number, item.lon as number]));
      map.fitBounds(bounds.pad(0.22), { animate: true, maxZoom: 9 });
    }
  }, [locatedCases]);

  return (
    <section className="map-panel" aria-label={t('map.title')}>
      <header className="section-toolbar map-toolbar">
        <div>
          <span className="eyebrow">{t('map.eyebrow')}</span>
          <div className="section-title-row"><h2>{t('map.title')}</h2><span className="data-count">{locatedCases.length}</span></div>
        </div>
        <div className="toolbar-actions">
          {missingCount > 0 && (
            <button className="missing-position-button" type="button" onClick={props.onShowMissing}>
              <span aria-hidden="true">⚑</span>{t('map.missing', { count: missingCount })}
            </button>
          )}
          <button className={`icon-button${showGrid ? ' is-active' : ''}`} type="button" title={showGrid ? t('map.gridOff') : t('map.gridOn')} aria-label={showGrid ? t('map.gridOff') : t('map.gridOn')} aria-pressed={showGrid} onClick={() => setShowGrid((value) => !value)}>
            <span aria-hidden="true">▦</span>
          </button>
          <button className="icon-button" type="button" title={t('map.fit')} aria-label={t('map.fit')} onClick={fitCases}><span aria-hidden="true">⌖</span></button>
          <button className={`icon-button${legend ? ' is-active' : ''}`} type="button" title={t('map.legend')} aria-label={t('map.legend')} onClick={() => setLegend((value) => !value)}><span aria-hidden="true">◇</span></button>
        </div>
      </header>
      <div className="map-wrap">
        <div ref={containerRef} className="ops-map" />
        {!data && !failed && <div className="map-loading"><span aria-hidden="true">⌖</span>{t('app.loading')}</div>}
        {failed && <div className="map-warning"><span aria-hidden="true">△</span>{t('map.mapUnavailable')}</div>}
        {locatedCases.length === 0 && (
          <div className="map-empty-state"><span className="empty-glyph" aria-hidden="true">⌖</span><strong>{t('map.noPositionedTitle')}</strong><span>{t('map.noPositionedBody')}</span></div>
        )}
        {legend && (
          <div className="map-legend panel-float">
            <strong>{t('map.legend')}</strong>
            <span><i className="legend-shape legend-friend" />{t('map.friend')}</span>
            <span><i className="legend-shape legend-hostile" />{t('map.hostile')}</span>
            <span><i className="legend-shape legend-neutral" />{t('map.neutral')}</span>
            <span><i className="legend-shape legend-unknown" />{t('map.unknown')}</span>
            <span><i className="legend-shape legend-selected" />{t('map.selected')}</span>
          </div>
        )}
      </div>
      <footer className="coordinate-readout" aria-live="polite">
        <span className="eyebrow"><span aria-hidden="true">⌖</span> {t('map.coordinates')}</span>
        <code>{mgrs}</code><code>{formatCoordinate(cursor.lat)}, {formatCoordinate(cursor.lon)}</code>
      </footer>
    </section>
  );
}
