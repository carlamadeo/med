/** Lista virtualizada de estudios que coinciden con los filtros activos. */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core';
import { filteredStudies } from '../state/store';
import { StudyRow } from './StudyRow';
import type { Study } from '@domain/models';

interface StudyListProps {
  onEdit: (study: Study) => void;
  onDelete: (study: Study) => void;
}

export function StudyList({ onEdit, onDelete }: StudyListProps) {
  const items = filteredStudies.value;
  const container = useRef<HTMLDivElement>(null);
  const printResults = useRef<HTMLUListElement>(null);
  const [, refresh] = useState(0);
  const virtualizer = useRef<Virtualizer<HTMLDivElement, HTMLLIElement>>();
  const options = {
    count: items.length,
    getScrollElement: () => container.current,
    estimateSize: () => 160,
    overscan: 5,
    initialRect: { width: 800, height: 600 },
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    onChange: () => refresh((n) => n + 1),
  };
  if (!virtualizer.current) virtualizer.current = new Virtualizer(options);
  virtualizer.current.setOptions(options);
  const list = virtualizer.current;
  useLayoutEffect(() => {
    const cleanup = list._didMount();
    list._willUpdate();
    return cleanup;
  }, [list]);
  useLayoutEffect(() => { list._willUpdate(); });
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
    <><div ref={container} className="virtual-results" style={{ height: '60vh', overflowY: 'auto' }}>
      <ul id="results" className="results" aria-label="Lista de estudios" style={{ height: list.getTotalSize(), position: 'relative' }}>
        {list.getVirtualItems().map((item) => {
          const study = items[item.index];
          if (!study) return null;
          return <StudyRow key={study.id} study={study} onEdit={onEdit} onDelete={onDelete}
            virtualIndex={item.index} virtualStart={item.start} measure={list.measureElement} />;
        })}
      </ul>
    </div><ul ref={printResults} className="print-results" aria-hidden="true" /></>
  );
}
