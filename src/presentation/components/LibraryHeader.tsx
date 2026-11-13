import { isSignedIn, setExporting, setRecoveringStudyId } from '../state/store';
import { ThemeToggle } from './ThemeToggle';

interface LibraryHeaderProps {
  onSignOut: () => void;
}

export function LibraryHeader({ onSignOut }: LibraryHeaderProps) {
  return (
    <header className="top">
      <div className="wrap top-inner">
        <a className="brand" href="#app" aria-label="Mis estudios, inicio">
          <span className="file-icon" aria-hidden="true"><svg className="icon"><use href="#i-file" /></svg></span>
          <span>Mis estudios</span>
        </a>
        <div className="top-actions">
          <button
            id="signout"
            type="button"
            className="text-button"
            hidden={!isSignedIn.value}
            onClick={onSignOut}
          >
            Salir
          </button>
          {isSignedIn.value && (
            <>
              <button
                id="export-history"
                type="button"
                className="icon-button"
                aria-label="Exportar historia"
                title="Exportar historia"
                onClick={() => setExporting(true)}
              >
                <svg className="icon"><use href="#i-download" /></svg>
              </button>
              <button
                id="recover-studies"
                type="button"
                className="icon-button"
                aria-label="Recuperar estudios eliminados"
                title="Recuperar estudios eliminados"
                onClick={() => setRecoveringStudyId('recovery')}
              >
                <svg className="icon"><use href="#i-restore" /></svg>
              </button>
            </>
          )}
          <span className="private"><svg className="icon" aria-hidden="true"><use href="#i-lock" /></svg> Privado</span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
