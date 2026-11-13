/** Lista virtualizada de estudios que coinciden con los filtros activos. */
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'preact/hooks';
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core';
import { filteredStudies, sortOrder, view } from '../state/store';
import { StudyRow } from './StudyRow';
import type { Study } from '@domain/models';

interface StudyListProps {
  onEdit: (study: Study) => void;
  onDelete: (study: Study) => void;
  onShare?: (study: Study) => void;
}

export function StudyList({ onEdit, onDelete, onShare = () => {} }: StudyListProps) {
  const items = filteredStudies.value;
  const container = useRef<HTMLDivElement>(null);
  const printResults = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const [, refresh] = useState(0);

  // Stable options - only count changes
  const options = useMemo(() => ({
    count: items.length,
    getScrollElement: () => container.current,
    estimateSize: () => 160,
    overscan: 5,
    initialRect: { width: 800, height: 600 },
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    onChange: () => refresh((n) => n + 1),
  }), [items.length]);

  const virtualizer = useRef<Virtualizer<HTMLDivElement, HTMLLIElement>>();
  if (!virtualizer.current) {
    virtualizer.current = new Virtualizer(options);
  }
  virtualizer.current.setOptions(options);
  const list = virtualizer.current;

  useLayoutEffect(() => {
    const cleanup = list._didMount();
    list._willUpdate();
    return cleanup;
  }, [list]);

  useLayoutEffect(() => {
    list._willUpdate();
    if (pendingFocus.current !== null) {
      const row = container.current?.querySelector<HTMLLIElement>(`li[data-index="${pendingFocus.current}"]`);
      if (row) { row.focus(); pendingFocus.current = null; }
    }
  });

  useEffect(() => {
    const prepare = () => {
      const target = printResults.current;
      if (!target) return;
      const rows = filteredStudies.value.map((study) => {
        const row = document.createElement('li');
        const heading = document.createElement('h3'); heading.textContent = study.title;
        const details = document.createElement('p'); details.textContent = [study.date, study.types.join(', '), study.doctor, study.portal].filter(Boolean).join(' · ');
        row.append(heading, details);
        return row;
      });
      target.replaceChildren(...rows);
    };
    const clear = () => printResults.current?.replaceChildren();
    window.addEventListener('beforeprint', prepare);
    window.addEventListener('afterprint', clear);
    return () => { window.removeEventListener('beforeprint', prepare); window.removeEventListener('afterprint', clear); };
  }, []);

  if (!items.length) return <p id="list-status" className="list-status" role="status">No hay estudios que mostrar</p>;

  return (
    <><div ref={container} className="virtual-results" style={{ height: '60vh', overflowY: 'auto', overflowX: 'hidden', maxWidth: '100%' }}>
      <ul id="results" className="results" aria-label="Lista de estudios" style={{ height: list.getTotalSize(), position: 'relative', width: '100%', maxWidth: '100%' }} onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const target = event.target;
        if (!(target instanceof HTMLLIElement) || !target.matches('li.record')) return;
        const index = Number(target.dataset.index) + (event.key === 'ArrowDown' ? 1 : -1);
        if (index < 0 || index >= items.length) return;
        event.preventDefault();
        const next = container.current?.querySelector<HTMLLIElement>(`li[data-index="${index}"]`);
        if (next) next.focus();
        else { pendingFocus.current = index; list.scrollToIndex(index, { align: 'auto' }); }
      }}>
        {list.getVirtualItems().map((item) => {
          const study = items[item.index];
          if (!study) return null;
          const month = study.date.slice(0, 7);
          const isChronological = view.value === 'cronologia' && (sortOrder.value === 'date-desc' || sortOrder.value === 'date-asc');
          const firstOfMonth = isChronological && month !== items[item.index - 1]?.date.slice(0, 7);
          const [year, monthNumber] = month.split('-').map(Number);
          const monthLabel = firstOfMonth && year && monthNumber ? `${year} · ${new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(year, monthNumber - 1, 1))}` : undefined;
          return <StudyRow key={study.id} study={study} onEdit={onEdit} onDelete={onDelete} onShare={onShare}
            virtualIndex={item.index} virtualStart={item.start} measure={list.measureElement} monthLabel={monthLabel} />;
        })}
      </ul>
    </div><ul ref={printResults} className="print-results" aria-hidden="true" /></>
  );
}