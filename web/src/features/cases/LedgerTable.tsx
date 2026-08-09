import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  type GroupingState,
  type VisibilityState,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { CaseStatus, IntelCase } from '../../types';
import { formatDateTime, mgrsTenKilometerSquare } from '../../utils';

interface LedgerTableProps {
  cases: IntelCase[];
  totalCount: number;
  selectedId: IntelCase['id'] | null;
  selectedIds: Set<string>;
  hoveredId: IntelCase['id'] | null;
  citedIds: Array<IntelCase['id']>;
  groupBy: string;
  hasFilters: boolean;
  assessmentAvailable: boolean;
  onGroupBy: (value: string) => void;
  onSelect: (item: IntelCase) => void;
  onHover: (id: IntelCase['id'] | null) => void;
  onToggleSelected: (item: IntelCase) => void;
  onToggleAll: () => void;
  onToggleStar: (item: IntelCase) => void;
  onUpdate: (item: IntelCase, patch: Partial<IntelCase>) => void;
  onAddPosition: (item: IntelCase) => void;
  onNewCase: () => void;
  onClearFilters: () => void;
  onAssessSelection: () => void;
}

const helper = createColumnHelper<IntelCase>();
const STATUSES: CaseStatus[] = ['Ny', 'Under bearbetning', 'Uppföljning', 'Avslutad'];

export function LedgerTable(props: LedgerTableProps) {
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [visibility, setVisibility] = useState<VisibilityState>({
    star: false, lopnr: false, actor: false, strength: false, tags: false, createdAt: false,
    updatedAt: false, createdBy: false, coordinates: false, counts: false,
    markings: false, rawReport: false, assessment: false, uncertainFields: false,
    internalId: false, aiOutput: false,
  });
  const grouping = useMemo<GroupingState>(() => {
    const map: Record<string, string> = { begrepp: 'type', status: 'status', day: 'time', tag: 'tags', mgrs: 'place' };
    return props.groupBy && map[props.groupBy] ? [map[props.groupBy]] : [];
  }, [props.groupBy]);

  const columns = useMemo(() => [
    helper.display({
      id: 'select',
      size: 38,
      enableResizing: false,
      header: () => (
        <input
          className="case-checkbox"
          type="checkbox"
          aria-label={t('ledger.selectAll')}
          checked={props.cases.length > 0 && props.cases.every((item) => props.selectedIds.has(String(item.id)))}
          onChange={props.onToggleAll}
        />
      ),
      cell: ({ row }) => row.getCanExpand() ? null : (
        <input
          className="case-checkbox"
          type="checkbox"
          aria-label={t('ledger.selectCase', { number: row.original.lopnr })}
          checked={props.selectedIds.has(String(row.original.id))}
          onClick={(event) => event.stopPropagation()}
          onChange={() => props.onToggleSelected(row.original)}
        />
      ),
    }),
    helper.display({
      id: 'star',
      size: 38,
      enableResizing: false,
      header: () => <span aria-hidden="true">★</span>,
      cell: ({ row }) => row.getCanExpand() ? null : (
        <button
          className={`star-button${row.original.star ? ' is-starred' : ''}`}
          type="button"
          title={row.original.star ? t('ledger.unstar') : t('ledger.star')}
          aria-label={row.original.star ? t('ledger.unstar') : t('ledger.star')}
          aria-pressed={row.original.star}
          onClick={(event) => { event.stopPropagation(); props.onToggleStar(row.original); }}
        >★</button>
      ),
    }),
    helper.accessor('lopnr', {
      id: 'lopnr',
      size: 62,
      header: t('columns.lopnr'),
      cell: (info) => <strong className="case-number">#{info.getValue()}</strong>,
    }),
    helper.accessor((item) => item.time_utc ?? item.dtg_raw ?? '', {
      id: 'time',
      size: 132,
      header: t('columns.time'),
      getGroupingValue: (item) => item.time_utc?.slice(0, 10) ?? '—',
      cell: ({ row }) => (
        <div className="cell-stack mono-cell">
          <span>{formatDateTime(row.original.time_utc, i18n.language)}</span>
          <small>{row.original.dtg_raw ?? '—'}{row.original.time_uncertain ? ' ?' : ''}</small>
        </div>
      ),
    }),
    helper.accessor((item) => item.place_name ?? item.place_raw ?? item.mgrs ?? '', {
      id: 'place',
      size: 172,
      header: t('columns.place'),
      getGroupingValue: (item) => mgrsTenKilometerSquare(item.mgrs) ?? '—',
      cell: ({ row }) => row.original.position_missing ? (
        <button className="missing-chip" type="button" onClick={(event) => { event.stopPropagation(); props.onAddPosition(row.original); }}>
          <span aria-hidden="true">⚑</span>{t('ledger.missingPosition')}
        </button>
      ) : (
        <div className="cell-stack"><span>{row.original.place_name ?? row.original.place_raw ?? '—'}</span><small className="mono-cell">{row.original.mgrs ?? '—'}</small></div>
      ),
    }),
    helper.accessor('slag', {
      id: 'name',
      size: 155,
      header: t('columns.name', 'NAME'),
      cell: (info) => <span className="cell-primary">{info.getValue() ?? '—'}</span>,
    }),
    helper.accessor((item) => item.activity_summary ?? item.sysselsattning ?? '', {
      id: 'activity',
      size: 238,
      header: t('columns.activity'),
      cell: (info) => <span className="truncate-2">{info.getValue() ?? '—'}</span>,
    }),
    helper.accessor((item) => item.begrepp.join(', '), {
      id: 'type',
      size: 190,
      header: t('columns.type'),
      getGroupingValue: (item) => item.begrepp[0] ?? '—',
      cell: ({ row }) => <div className="chip-row">{row.original.begrepp.slice(0, 2).map((term) => <span className="term-chip" key={term}>{term}</span>)}</div>,
    }),
    helper.accessor((item) => item.traits_summary ?? item.symbol ?? '', {
      id: 'traits', size: 145, header: t('columns.traits', 'TRAITS'), cell: (info) => <span className="truncate-2">{info.getValue() || '—'}</span>,
    }),
    helper.accessor('aktor', { id: 'actor', size: 145, header: t('columns.actor'), cell: (info) => t(`actor.${info.getValue()}`) }),
    helper.accessor('sagesman', { id: 'source', size: 145, header: t('columns.source'), cell: (info) => info.getValue() ?? '—' }),
    helper.accessor('source_assessment', { id: 'sourceAssessment', size: 135, header: t('columns.sourceAssessment', 'SOURCE ASSESSMENT'), cell: (info) => info.getValue() ?? 'Okänd' }),
    helper.accessor('status', {
      id: 'status', size: 148, header: t('columns.status'),
      cell: ({ row }) => <select className={`status-select status-${row.original.status.replace(/\s/g, '-').toLowerCase()}`} value={row.original.status} aria-label={t('form.status')} onClick={(event) => event.stopPropagation()} onChange={(event) => props.onUpdate(row.original, { status: event.target.value as CaseStatus })}>
        {STATUSES.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
      </select>,
    }),
    helper.accessor('styrka_raw', { id: 'strength', size: 90, header: t('columns.strength'), cell: (info) => info.getValue() ?? '—' }),
    helper.accessor((item) => item.tags.join(', '), {
      id: 'tags',
      size: 150,
      header: t('columns.tags'),
      getGroupingValue: (item) => item.tags[0] ?? '—',
      cell: ({ row }) => <div className="chip-row">{row.original.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</div>,
    }),
    helper.accessor('created_at', { id: 'createdAt', size: 145, header: t('detail.created'), cell: (info) => <span className="mono-cell">{formatDateTime(info.getValue(), i18n.language)}</span> }),
    helper.accessor('updated_at', { id: 'updatedAt', size: 145, header: t('detail.updated'), cell: (info) => <span className="mono-cell">{formatDateTime(info.getValue(), i18n.language)}</span> }),
    helper.accessor('created_by', { id: 'createdBy', size: 125, header: t('detail.operator'), cell: (info) => info.getValue() || '—' }),
    helper.accessor((item) => `${item.lat ?? ''}, ${item.lon ?? ''}`, {
      id: 'coordinates', size: 155, header: `${t('form.latitude')} / ${t('form.longitude')}`,
      cell: ({ row }) => <span className="mono-cell">{row.original.lat == null || row.original.lon == null ? '—' : `${row.original.lat.toFixed(5)}, ${row.original.lon.toFixed(5)}`}</span>,
    }),
    helper.accessor((item) => `${item.count_min ?? ''}–${item.count_max ?? ''}`, {
      id: 'counts', size: 105, header: `${t('form.countMin')} / ${t('form.countMax')}`,
      cell: ({ row }) => row.original.count_min == null && row.original.count_max == null ? '—' : `${row.original.count_min ?? '?'}–${row.original.count_max ?? '?'}`,
    }),
    helper.accessor('symbol', { id: 'markings', size: 170, header: t('form.symbol'), cell: (info) => <span className="truncate-2">{info.getValue() ?? '—'}</span> }),
    helper.accessor('kallrapport_raw', { id: 'rawReport', size: 260, header: t('form.rawReport'), cell: (info) => <span className="truncate-2">{info.getValue() ?? '—'}</span> }),
    helper.accessor('bedomning', { id: 'assessment', size: 260, header: t('detail.assessment'), cell: (info) => <span className="truncate-2">{info.getValue() ?? '—'}</span> }),
    helper.accessor((item) => item.fields_uncertain.join(', '), { id: 'uncertainFields', size: 170, header: t('intake.uncertain'), cell: (info) => info.getValue() || '—' }),
    helper.accessor('id', { id: 'internalId', size: 80, header: 'ID', cell: (info) => <span className="mono-cell">{String(info.getValue())}</span> }),
    helper.accessor((item) => item.ai_json == null ? '' : JSON.stringify(item.ai_json), { id: 'aiOutput', size: 260, header: t('detail.aiOutput'), cell: (info) => <span className="truncate-2 mono-cell">{info.getValue() || '—'}</span> }),
  ], [i18n.language, props, t]);

  const table = useReactTable({
    data: props.cases,
    columns,
    state: { grouping, columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    autoResetExpanded: false,
    columnResizeMode: 'onChange',
  });
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.original && expandedId === String(rows[index].original.id) ? 300 : 58,
    overscan: 8,
  });

  useEffect(() => { virtualizer.measure(); }, [expandedId, virtualizer]);

  useEffect(() => {
    if (!props.selectedId) return;
    const index = rows.findIndex((row) => String(row.original?.id) === String(props.selectedId));
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [props.selectedId, rows, virtualizer]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewportWidth(Math.floor(element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.cases.length]);

  const visibleColumns = table.getVisibleLeafColumns();
  const baseTableWidth = visibleColumns.reduce((sum, column) => sum + column.getSize(), 0);
  const flexibleColumns = visibleColumns.filter((column) => !['select', 'star'].includes(column.id));
  const extraColumnWidth = flexibleColumns.length ? Math.max(0, viewportWidth - baseTableWidth) / flexibleColumns.length : 0;
  const tableWidth = Math.max(baseTableWidth, viewportWidth);
  const displayColumnWidth = (id: string, size: number) => size + (flexibleColumns.some((column) => column.id === id) ? extraColumnWidth : 0);

  return (
    <section className="ledger-panel" aria-label={t('ledger.title')}>
      <header className="section-toolbar ledger-toolbar">
        <div>
          <span className="eyebrow">{t('ledger.eyebrow')}</span>
          <div className="section-title-row">
            <h2>{t('ledger.title')}</h2>
            <span className="data-count">{props.cases.length === props.totalCount ? t('ledger.caseCount', { count: props.totalCount }) : t('ledger.filteredCount', { shown: props.cases.length, total: props.totalCount })}</span>
          </div>
        </div>
        <div className="toolbar-actions ledger-actions">
          {props.selectedIds.size > 0 && (
            <button
              className="quiet-button selection-action"
              type="button"
              disabled={!props.assessmentAvailable}
              title={!props.assessmentAvailable ? t('ledger.assessmentUnavailable') : undefined}
              onClick={props.onAssessSelection}
            >
              <span>{t('ledger.selectedCount', { count: props.selectedIds.size })}</span><b>{t('ledger.assessSelection')}</b>
            </button>
          )}
          <label className="compact-select">
            <span>{t('ledger.groupBy')}</span>
            <select value={props.groupBy} onChange={(event) => props.onGroupBy(event.target.value)}>
              <option value="">{t('ledger.noGrouping')}</option>
              <option value="begrepp">{t('ledger.groupBegrepp')}</option>
              <option value="status">{t('ledger.groupStatus')}</option>
              <option value="day">{t('ledger.groupDay')}</option>
              <option value="tag">{t('ledger.groupTag')}</option>
              <option value="mgrs">{t('ledger.groupMgrs')}</option>
            </select>
          </label>
        </div>
      </header>

      {props.cases.length === 0 ? (
        <div className="empty-state ledger-empty">
          <span className="empty-glyph" aria-hidden="true">≡</span>
          <strong>{props.hasFilters ? t('ledger.noResultsTitle') : t('ledger.emptyTitle')}</strong>
          <p>{props.hasFilters ? t('ledger.noResultsBody') : t('ledger.emptyBody')}</p>
          <button className="primary-button" type="button" onClick={props.hasFilters ? props.onClearFilters : props.onNewCase}>
            {props.hasFilters ? t('ledger.clearFilters') : t('header.newCase')}
          </button>
        </div>
      ) : (
        <div className="virtual-table" style={{ '--table-width': `${tableWidth}px` } as React.CSSProperties}>
          <div className="table-scroll" ref={scrollRef} role="table" aria-rowcount={props.cases.length}>
            <div className="table-header" role="row" style={{ width: tableWidth }}>
              {table.getFlatHeaders().map((header) => (
                <div className="table-header-cell" key={header.id} role="columnheader" style={{ width: displayColumnWidth(header.column.id, header.getSize()) }}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getCanResize() && (
                    <span className={`column-resizer${header.column.getIsResizing() ? ' is-resizing' : ''}`} onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} />
                  )}
                </div>
              ))}
            </div>
            <div className="table-body" style={{ height: virtualizer.getTotalSize(), width: tableWidth }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                const isGroup = row.getIsGrouped();
                if (isGroup) {
                  return (
                    <button
                      className="group-row"
                      key={row.id}
                      type="button"
                      style={{ transform: `translateY(${virtualRow.start}px)`, height: virtualRow.size, width: tableWidth }}
                      onClick={row.getToggleExpandedHandler()}
                    >
                      <span className="group-caret" aria-hidden="true">{row.getIsExpanded() ? '▾' : '▸'}</span>
                      <strong>{String(row.getGroupingValue(row.groupingColumnId ?? '') ?? '—')}</strong>
                      <span>{t('ledger.caseCount', { count: row.subRows.length })}</span>
                    </button>
                  );
                }
                const item = row.original;
                const selected = String(props.selectedId) === String(item.id);
                const checked = props.selectedIds.has(String(item.id));
                const hovered = String(props.hoveredId) === String(item.id);
                const cited = props.citedIds.map(String).includes(String(item.id));
                return (
                  <div
                    key={row.id}
                    className={`table-row${selected ? ' is-selected' : ''}${checked ? ' is-checked' : ''}${hovered ? ' is-hovered' : ''}${cited ? ' is-cited' : ''}`}
                    role="row"
                    tabIndex={0}
                    aria-label={t('ledger.openCase', { number: item.lopnr })}
                    style={{ transform: `translateY(${virtualRow.start}px)`, height: virtualRow.size }}
                    onClick={() => setExpandedId((value) => value === String(item.id) ? null : String(item.id))}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpandedId((value) => value === String(item.id) ? null : String(item.id)); } }}
                    onMouseEnter={() => props.onHover(item.id)}
                    onMouseLeave={() => props.onHover(null)}
                  >
                    <div className="ledger-row-cells">{row.getVisibleCells().map((cell) => (
                        <div className="table-cell" key={cell.id} role="cell" style={{ width: displayColumnWidth(cell.column.id, cell.column.getSize()) }}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      ))}</div>
                    {expandedId === String(item.id) && <div className="ledger-expanded" onClick={(event) => event.stopPropagation()}>
                      <dl>
                        <div><dt>7S source ID</dt><dd>{item.source_report_id ?? '—'}</dd></div>
                        <div><dt>Strength</dt><dd>{item.styrka_raw ?? '—'}</dd></div>
                        <div><dt>Actor</dt><dd>{item.aktor}</dd></div>
                        <div><dt>MGRS / coordinates</dt><dd>{item.mgrs ?? (item.lat == null ? '—' : `${item.lat}, ${item.lon}`)}</dd></div>
                        <div><dt>Tags</dt><dd>{item.tags.join(', ') || '—'}</dd></div>
                        <div><dt>Uncertain fields</dt><dd>{item.fields_uncertain.join(', ') || '—'}</dd></div>
                      </dl>
                      <div className="ledger-expanded-text"><section><strong>Original report</strong><p>{item.kallrapport_raw ?? '—'}</p></section><section><strong>Assessment</strong><p>{item.bedomning ?? '—'}</p></section></div>
                      <button className="quiet-button" type="button" onClick={() => props.onSelect(item)}>Open full editor</button>
                    </div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
