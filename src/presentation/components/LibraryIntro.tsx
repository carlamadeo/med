import {useLayoutEffect} from 'preact/hooks';
import type {ViewMode} from '@domain/models';

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
    medicos: 'Médicos',
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
            {isSignedIn && library && (
                <div className="intro-actions">
                    <button className="button primary" data-add type="button" onClick={onAddStudy} disabled={!typesReady}>
                        <svg className="icon"><use href="#i-plus"/></svg>
                        Agregar estudio
                    </button>
                    {!isLocalDemo && <button type="button" className="button secondary" onClick={onImport}>
                        Importar estudios
                    </button>}
                </div>
            )}
        </section>
    );
}
