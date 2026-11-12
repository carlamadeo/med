/**
 * Lista virtualizada de estudios usando @tanstack/virtual-core.
 * Solo renderiza las filas visibles dentro del viewport del contenedor.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Virtualizer } from '@tanstack/virtual-core';
import { filteredStudies, loading } from '../state/store';
import { StudyRow } from './StudyRow';
import { createStudyCardSkeleton } from './Skeleton';
import type { Study } from '@domain/models';

interface StudyListProps {
  onEdit: (study: Study) => void;
  onDelete: (study: Study) => void;
}

const ROW_HEIGHT = 120;
const SKELETON_COUNT = 5;
const LIST_HEIGHT = '60vh';

export function StudyList({ onEdit, onDelete }: StudyListProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, HTMLDivElement> | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize virtualizer
  useEffect(() => {
    if (!scrollContainerRef.current) return;

    virtualizerRef.current = new Virtualizer<HTMLDivElement, HTMLDivElement>({
      count: filteredStudies.value.length,
      getScrollElement: () => scrollContainerRef.current!,
      estimateSize: () => ROW_HEIGHT,
      overscan: 5,
      scrollToFn: () => {},
      observeElementRect: () => () => {},
      observeElementOffset: () => () => {},
    });

    setIsInitialized(true);

    return () => {
      virtualizerRef.current = null;
      setIsInitialized(false);
    };
  }, []);

  // Update count when studies change
  useEffect(() => {
    if (virtualizerRef.current && scrollContainerRef.current) {
      virtualizerRef.current.setOptions({
        count: filteredStudies.value.length,
        getScrollElement: () => scrollContainerRef.current!,
        estimateSize: () => ROW_HEIGHT,
        overscan: 5,
        scrollToFn: () => {},
        observeElementRect: () => () => {},
        observeElementOffset: () => () => {},
      });
    }
  }, [filteredStudies.value.length]);

  if (!isInitialized || !virtualizerRef.current) {
    return (
      <div className="results" style={{ height: LIST_HEIGHT }}>
        {loading.value ? (
          <>
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <li key={`skeleton-${i}`} className="record skeleton-card">
                {createStudyCardSkeleton().innerHTML}
              </li>
            ))}
          </>
        ) : (
          <p id="list-status" className="list-status" role="status">
            Cargando tus estudios&hellip;
          </p>
        )}
      </div>
    );
  }

  const virtualItems = virtualizerRef.current.getVirtualItems();
  const totalSize = virtualizerRef.current.getTotalSize();

  if (filteredStudies.value.length === 0) {
    return (
      <div className="results" style={{ height: LIST_HEIGHT }}>
        <p id="list-status" className="list-status" role="status">
          No hay estudios que mostrar
        </p>
      </div>
    );
  }

  return (
    <div className="results" style={{ height: LIST_HEIGHT }}>
      <div
        ref={scrollContainerRef}
        style={{
          height: '100%',
          overflowY: 'auto',
          position: 'relative',
        }}
        role="list"
        aria-label="Lista de estudios"
      >
        <div
          style={{
            height: totalSize,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualItems.map((item) => {
            const study = filteredStudies.value[item.index];
            if (!study) return null;
            return (
              <div
                key={study.id}
                style={{
                  position: 'absolute',
                  top: item.start,
                  height: item.size,
                  width: '100%',
                  boxSizing: 'border-box',
                }}
                role="listitem"
              >
                <StudyRow study={study} onEdit={onEdit} onDelete={onDelete} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}