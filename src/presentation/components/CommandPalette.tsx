import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import type {JSX} from 'preact';
import type {Study, ViewMode} from '@domain/models';
import {normalizeSearch, searchArchive} from '@domain/search';
import {
    filters,
    portals,
    setExporting,
    setRecoveringStudyId,
    visibleAppointments,
    visibleStudies,
} from '../state/store';

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    onOpenStudy: (study: Study) => void;
    onAddStudy: () => void;
    onNavigate: (view: ViewMode) => void;
}

interface PaletteItem {
    id: string;
    label: string;
    hint?: string;
    icon: string;
    run: () => void;
}

interface PaletteGroup {
    label: string;
    items: PaletteItem[];
}

export function CommandPalette({open, onClose, onOpenStudy, onAddStudy, onNavigate}: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open) {
            if (!dialog.open) dialog.showModal();
            setQuery('');
            setActive(0);
            requestAnimationFrame(() => inputRef.current?.focus());
        } else if (dialog.open) {
            dialog.close();
        }
    }, [open]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const handleClose = () => onClose();
        dialog.addEventListener('close', handleClose);
        return () => dialog.removeEventListener('close', handleClose);
    }, [onClose]);

    const results = useMemo(
        () => searchArchive({
            studies: visibleStudies.value,
            portals: portals.value,
            appointments: visibleAppointments.value,
            query,
            now: new Date(),
        }),
        [query, visibleStudies.value, portals.value, visibleAppointments.value],
    );

    const close = () => {
        if (dialogRef.current?.open) dialogRef.current.close();
        onClose();
    };
    const go = (view: ViewMode) => () => {
        onNavigate(view);
        close();
    };

    const actions: PaletteItem[] = [
        {
            id: 'action-new', label: 'Agregar estudio', hint: 'N', icon: 'i-plus', run: () => {
                onAddStudy();
                close();
            }
        },
        {
            id: 'action-export', label: 'Exportar historia', icon: 'i-download', run: () => {
                setExporting(true);
                close();
            }
        },
        {
            id: 'action-recover', label: 'Recuperar informe', icon: 'i-restore', run: () => {
                setRecoveringStudyId('recovery');
                close();
            }
        },
        {id: 'action-resumen', label: 'Ir al resumen', icon: 'i-grid', run: go('resumen')},
        {id: 'action-library', label: 'Ir a la biblioteca', icon: 'i-folder', run: go('cronologia')},
        {id: 'action-turnos', label: 'Ir a turnos', icon: 'i-calendar', run: go('turnos')},
        ...(query.trim() ? [{
            id: 'action-filter-library',
            label: `Buscar «${query.trim()}» en la biblioteca`,
            icon: 'i-search',
            run: () => {
                filters.value = {...filters.value, query};
                onNavigate('cronologia');
                close();
            },
        }] : []),
    ];
    const normalizedQuery = normalizeSearch(query);
    const visibleActions = normalizedQuery
        ? actions.filter((item) => normalizeSearch(item.label).includes(normalizedQuery))
        : actions;

    const studyItems: PaletteItem[] = results
        .filter((result) => result.kind === 'study')
        .slice(0, 4)
        .map((result) => ({
            id: result.key,
            label: result.title,
            hint: result.subtitle,
            icon: 'i-file',
            run: () => {
                if (result.study) onOpenStudy(result.study);
                close();
            },
        }));

    const portalItems: PaletteItem[] = results
        .filter((result) => result.kind === 'portal')
        .slice(0, 3)
        .map((result) => ({
            id: result.key,
            label: result.title,
            hint: result.portal?.url ?? result.subtitle,
            icon: 'i-globe',
            run: () => {
                if (result.portal) filters.value = {...filters.value, portal: result.portal.name};
                onNavigate('cronologia');
                close();
            },
        }));

    const appointmentItems: PaletteItem[] = results
        .filter((result) => result.kind === 'appointment')
        .slice(0, 3)
        .map((result) => ({
            id: result.key,
            label: result.title,
            hint: `${result.subtitle} · ${result.meta}`,
            icon: 'i-calendar',
            run: go('turnos'),
        }));

    const groups: PaletteGroup[] = [
        {label: 'Acciones', items: visibleActions},
        {label: 'Estudios', items: studyItems},
        {label: 'Portales', items: portalItems},
        {label: 'Turnos', items: appointmentItems},
    ].filter((group) => group.items.length > 0);

    let cursor = 0;
    const indexedGroups = groups.map((group) => ({
        label: group.label,
        items: group.items.map((item) => ({...item, index: cursor++})),
    }));
    const flat = indexedGroups.flatMap((group) => group.items);

    useEffect(() => {
        setActive(0);
    }, [query]);

    useEffect(() => {
        if (active > flat.length - 1) setActive(Math.max(0, flat.length - 1));
    }, [active, flat.length]);

    useEffect(() => {
        const item = flat[active];
        if (item) document.getElementById(`command-item-${item.id}`)?.scrollIntoView({block: 'nearest'});
    }, [active, flat.length]);

    const runActive = () => {
        flat[active]?.run();
    };

    const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (flat.length) setActive((active + 1) % flat.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (flat.length) setActive((active - 1 + flat.length) % flat.length);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            runActive();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    };

    return (
        <dialog
            ref={dialogRef}
            className="command-palette"
            aria-label="Búsqueda global"
            onClick={(event) => {
                if (event.target === dialogRef.current) close();
            }}
        >
            <div className="command-search">
                <svg className="icon" aria-hidden="true">
                    <use href="#i-search"/>
                </svg>
                <input
                    ref={inputRef}
                    id="command-input"
                    type="text"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="command-results"
                    aria-autocomplete="list"
                    aria-activedescendant={flat[active] ? `command-item-${flat[active]!.id}` : undefined}
                    placeholder="Buscar estudios, portales, turnos…"
                    autocomplete="off"
                    value={query}
                    onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                    onKeyDown={handleKeyDown}
                />
                <kbd className="kbd">Esc</kbd>
            </div>

            <div className="command-body">
                {flat.length === 0 ? (
                    <p className="command-empty">Sin resultados para «{query}». Probá con otro nombre, profesional o
                        portal.</p>
                ) : (
                    <div id="command-results" role="listbox" aria-label="Resultados de búsqueda">
                        {indexedGroups.map((group) => (
                            <div className="command-group" role="group" aria-labelledby={`command-group-${group.label}`}
                                 key={group.label}>
                                <p className="command-label" id={`command-group-${group.label}`}>{group.label}</p>
                                {group.items.map((item) => (
                                    <div
                                        className="command-item"
                                        id={`command-item-${item.id}`}
                                        role="option"
                                        aria-selected={item.index === active}
                                        key={item.id}
                                        onMouseEnter={() => setActive(item.index)}
                                        onClick={item.run}
                                    >
                                        <svg className="icon" aria-hidden="true">
                                            <use href={`#${item.icon}`}/>
                                        </svg>
                                        <span className="command-item-text">
                      <span className="command-item-label">{item.label}</span>
                                            {item.hint && <small>{item.hint}</small>}
                    </span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="command-foot">
                <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navegar</span>
                <span><kbd className="kbd">↵</kbd> abrir</span>
                <span><kbd className="kbd">Esc</kbd> cerrar</span>
            </div>
        </dialog>
    );
}