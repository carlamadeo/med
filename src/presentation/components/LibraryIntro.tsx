interface LibraryIntroProps {
  onAddStudy: () => void;
  isSignedIn: boolean;
  typesReady: boolean;
}

export function LibraryIntro({ onAddStudy, isSignedIn, typesReady }: LibraryIntroProps) {
  return (
    <section className="intro" aria-labelledby="page-title">
      <div>
        <p className="eyebrow">MI ARCHIVO MÉDICO</p>
        <h1 id="page-title">Mis estudios</h1>
        <p className="lead">
          Tus informes y enlaces a visores, ordenados por fecha y tipo de estudio.
        </p>
      </div>
      <button
        className="button primary"
        data-add
        hidden={!isSignedIn}
        disabled={!typesReady}
        type="button"
        onClick={onAddStudy}
      >
        <svg className="icon"><use href="#i-plus" /></svg> Agregar estudio
      </button>
    </section>
  );
}