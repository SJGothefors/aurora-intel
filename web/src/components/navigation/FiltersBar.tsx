import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CaseFilters, IntelCase, VocabularyTerm } from '../../types';
import { activeFilterCount } from '../../utils';

interface FiltersBarProps {
  filters: CaseFilters;
  cases: IntelCase[];
  vocabulary: VocabularyTerm[];
  onChange: (filters: CaseFilters) => void;
  onReset: () => void;
}

export function FiltersBar({ filters, cases, vocabulary, onChange, onReset }: FiltersBarProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const tags = useMemo(() => [...new Set(cases.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b, 'sv')), [cases]);
  const count = activeFilterCount(filters);
  const patch = (value: Partial<CaseFilters>) => onChange({ ...filters, ...value });
  const chips: Array<{ key: keyof CaseFilters; label: string; visible: boolean }> = [
    { key: 'status', label: filters.status ? t(`status.${filters.status}`) : '', visible: Boolean(filters.status) },
    { key: 'actor', label: filters.actor ? t(`actor.${filters.actor}`) : '', visible: Boolean(filters.actor) },
    { key: 'vocabulary', label: filters.vocabulary, visible: Boolean(filters.vocabulary) },
    { key: 'tag', label: `#${filters.tag}`, visible: Boolean(filters.tag) },
    { key: 'dateFrom', label: `≥ ${filters.dateFrom}`, visible: Boolean(filters.dateFrom) },
    { key: 'dateTo', label: `≤ ${filters.dateTo}`, visible: Boolean(filters.dateTo) },
    { key: 'starOnly', label: `★ ${t('filters.starOnly')}`, visible: filters.starOnly },
    { key: 'missingPosition', label: `⚑ ${t('filters.missingOnly')}`, visible: filters.missingPosition },
    { key: 'mapExtentOnly', label: `⌖ ${t('filters.mapExtentOnly')}`, visible: filters.mapExtentOnly },
  ];
  return (
    <div className={`filters-bar${expanded ? ' is-expanded' : ''}`}>
      <button className={`filter-toggle${count ? ' has-filters' : ''}`} type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><span aria-hidden="true">≡</span><span>{count ? t('filters.active', { count }) : t('filters.open')}</span>{count > 0 && <b>{count}</b>}<span aria-hidden="true">{expanded ? '▴' : '▾'}</span></button>
      <div className="active-filter-chips">{chips.filter((chip) => chip.visible).map((chip) => <button key={chip.key} type="button" title={t('filters.remove', { filter: chip.label })} onClick={() => patch({ [chip.key]: typeof filters[chip.key] === 'boolean' ? false : '' })}><span>{chip.label}</span><b>×</b></button>)}{count > 0 && <button className="clear-filter-button" type="button" onClick={onReset}>{t('ledger.clearFilters')}</button>}</div>
      {expanded && <div className="filter-fields">
        <label><span>{t('filters.dateFrom')}</span><input type="date" value={filters.dateFrom} onChange={(event) => patch({ dateFrom: event.target.value })} /></label>
        <label><span>{t('filters.dateTo')}</span><input type="date" value={filters.dateTo} onChange={(event) => patch({ dateTo: event.target.value })} /></label>
        <label><span>{t('filters.status')}</span><select value={filters.status} onChange={(event) => patch({ status: event.target.value })}><option value="">{t('filters.all')}</option>{['Ny', 'Under bearbetning', 'Uppföljning', 'Avslutad'].map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}</select></label>
        <label><span>{t('filters.actor')}</span><select value={filters.actor} onChange={(event) => patch({ actor: event.target.value })}><option value="">{t('filters.all')}</option>{['Okänd', 'Misstänkt främmande', 'Civil', 'Egen'].map((value) => <option key={value} value={value}>{t(`actor.${value}`)}</option>)}</select></label>
        <label><span>{t('filters.vocabulary')}</span><select value={filters.vocabulary} onChange={(event) => patch({ vocabulary: event.target.value })}><option value="">{t('filters.all')}</option>{vocabulary.filter((term) => term.active).map((term) => <option key={term.id} value={term.name_sv}>{term.name_sv}</option>)}</select></label>
        <label><span>{t('filters.tag')}</span><select value={filters.tag} onChange={(event) => patch({ tag: event.target.value })}><option value="">{t('filters.all')}</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
        <label className="filter-check"><input type="checkbox" checked={filters.starOnly} onChange={(event) => patch({ starOnly: event.target.checked })} /><span>{t('filters.starOnly')}</span></label>
        <label className="filter-check"><input type="checkbox" checked={filters.missingPosition} onChange={(event) => patch({ missingPosition: event.target.checked })} /><span>{t('filters.missingOnly')}</span></label>
        <label className="filter-check"><input type="checkbox" checked={filters.mapExtentOnly} onChange={(event) => patch({ mapExtentOnly: event.target.checked })} /><span>{t('filters.mapExtentOnly')}</span></label>
      </div>}
    </div>
  );
}
