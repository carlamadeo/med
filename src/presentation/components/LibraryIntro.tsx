interface LibraryIntroProps {
    onAddStudy: () => void;
    isSignedIn: boolean;
    typesReady: boolean;
    summary?: boolean;
}

export function LibraryIntro({onAddStudy, isSignedIn, typesReady, summary = false}: LibraryIntroProps) {
    return (
        <section className="intro">
            <div>
                <p className="eyebrow">Mi archivo médico</p>
                <h1 id="page-title" tabIndex={-1}>{summary ? 'Resumen' : 'Mis estudios'}</h1>
                <p className="lead">
                    {summary
                        ? 'Tu historial, tus turnos y el estado de sincronización en un solo lugar.'
                        : 'Tus informes, tus estudios y tus turnos, en un solo lugar privado.'}
                </p>
            </div>
            <button className="button primary" data-add type="button" onClick={onAddStudy} disabled={!typesReady}
                    hidden={!isSignedIn}>
                <svg className="icon">
                    <use href="#i-plus"/>
                </svg>
                Agregar estudio
            </button>
        </section>
    );
}