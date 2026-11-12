import { isSignedIn } from '../state/store';
import { ThemeToggle } from './ThemeToggle';

interface LibraryHeaderProps {
  onSignOut: () => void;
}

export function LibraryHeader({ onSignOut }: LibraryHeaderProps) {
  return (
    <header className="top">
      <div className="wrap top-inner">
        <a className="brand" href="#main" aria-label="Mis estudios, inicio">
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
          <span className="private"><svg className="icon" aria-hidden="true"><use href="#i-lock" /></svg> Privado</span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}