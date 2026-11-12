interface AccessSectionProps {
  onConnect: () => void;
  error: string | null;
  bootFailed: boolean;
  configured: boolean;
}

export function AccessSection({ onConnect, error, bootFailed, configured }: AccessSectionProps) {
  return (
    <>
      <span className="file-icon">
        <svg className="icon" aria-hidden="true"><use href="#i-lock" /></svg>
      </span>
      <h2 id="access-title">Abrí tu archivo</h2>
      <p id="access-copy">
        {bootFailed ? 'No se pudo cargar la página. Actualizala para volver a intentar.' : 'Conectá Google Drive para consultar y guardar tus estudios desde cualquier dispositivo.'}
      </p>
      <button
        className="button primary"
        id="connect"
        type="button"
        disabled={!configured || bootFailed}
        onClick={onConnect}
      >
        Conectar Google Drive
      </button>
      {error && (
        <p id="access-error" className="form-error" role="alert">
          {error}
        </p>
      )}
      {!configured && (
        <p className="form-error" role="alert">
          Para abrir el archivo, primero hay que configurar el acceso a Google Drive.
        </p>
      )}
    </>
  );
}