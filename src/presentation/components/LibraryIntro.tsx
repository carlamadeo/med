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
    operaciones: 'Operaciones',
    turnos: 'Turnos',
    eventos: 'Consultas y recetas',
    episodios: 'Episodios',
    intake: 'Bandeja de entrada',
};

export function LibraryIntro({onAddStudy, onImport, isSignedIn, isLocalDemo, typesReady, view}: LibraryIntroProps) {
    const library = view === 'cronologia' || view === 'categoria';
    return (
        <section className="intro">
            <div>
                <p className="eyebrow">Mi archivo médico</p>
                <h1 id="page-title" tabIndex={-1}>{isSignedIn ? titles[view] : 'Mis estudios'}</h1>
                {(!isSignedIn || view === 'resumen') && <p className="lead">
                    {isSignedIn
                        ? 'Tu historial, tus turnos y el estado de sincronización en un solo lugar.'
                        : 'Tus informes, tus estudios y tus turnos, en un solo lugar privado.'}
                </p>}
            </div>
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
