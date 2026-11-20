import {useLayoutEffect} from 'preact/hooks';
import type {ViewMode} from '@domain/models';
import {libraryQuery, resetLibraryFilters, view as archiveView} from '../state/store';

interface LibraryIntroProps {
    onAddStudy: () => void;
    onImport: () => void;
    isSignedIn: boolean;
    isLocalDemo: boolean;
    typesReady: boolean;
    view: ViewMode;
}

const titles: Record<ViewMode, string> = {
    resumen: 'Resumen',
    cronologia: 'Biblioteca',
    categoria: 'Biblioteca',
    portales: 'Portales',
    operaciones: 'Operaciones',
    turnos: 'Turnos, consultas y recetas',
    episodios: 'Episodios',
    intake: 'Bandeja de entrada',
};

export function LibraryIntro({onAddStudy, onImport, isSignedIn, isLocalDemo, typesReady, view}: LibraryIntroProps) {
    const library = view === 'cronologia' || view === 'categoria';

    useLayoutEffect(() => {
        if (isSignedIn && library && window.matchMedia('(max-width: 720px)').matches) {
            window.scrollTo(0, 0);
        }
    }, [isSignedIn, library]);

    return (
        <section className="intro">
            <div>
                {(!isSignedIn || view !== 'resumen') && <p className="eyebrow">Mi archivo médico</p>}
                <h1 id="page-title" tabIndex={-1}>{isSignedIn ? titles[view] : 'Mis estudios'}</h1>
                {!isSignedIn && <p className="lead">Tus informes, tus estudios y tus turnos, en un solo lugar privado.</p>}
            </div>
            {isSignedIn && view === 'resumen' && (
                <form className="summary-search" role="search" onSubmit={event => {
                    event.preventDefault();
                    const term = new FormData(event.currentTarget).get('query');
                    resetLibraryFilters();
                    libraryQuery.value = typeof term === 'string' ? term.trim() : '';
                    archiveView.value = 'cronologia';
                    requestAnimationFrame(() => document.querySelector<HTMLElement>('.library-search input')?.focus());
                }}>
                    <label htmlFor="summary-search">Buscar un estudio</label>
                    <div className="summary-search-fields">
                        <input id="summary-search" type="search" name="query" placeholder="Nombre, profesional o institución"/>
                        <button className="button secondary" type="submit">Buscar</button>
                    </div>
                </form>
            )}
            <div className="intro-actions" hidden={!isSignedIn || (!library && view !== 'resumen')}>
                <button className="button primary" data-add type="button" onClick={onAddStudy} disabled={!typesReady}>
                    <svg className="icon"><use href="#i-plus"/></svg>
                    Agregar estudio
                </button>
                {library && !isLocalDemo && <button type="button" className="button secondary" onClick={onImport}>
                    Importar estudios
                </button>}
            </div>
        </section>
    );
}
