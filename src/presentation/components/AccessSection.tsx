interface AccessSectionProps {
    onConnect: () => void;
    onEnterDemo?: () => void;
    error: string | null;
    bootFailed: boolean;
    configured: boolean;
}

export function AccessSection({onConnect, onEnterDemo, error, bootFailed, configured}: AccessSectionProps) {
    return (
        <>
            <span className="file-icon" aria-hidden="true">
                <svg className="icon"><use href="#i-lock"/></svg>
            </span>
            <h2 id="access-title">Abrí tu archivo</h2>
            <p id="access-copy">
                {bootFailed
                    ? 'No se pudo cargar la página. Actualizala para volver a intentar.'
                    : 'Conectá Google Drive para consultar y guardar tus estudios desde cualquier dispositivo.'}
            </p>
            <div className="access-actions">
                <button
                    className="button primary access-connect-btn"
                    id="connect"
                    type="button"
                    disabled={!configured || bootFailed}
                    onClick={onConnect}
                >
                    <svg className="icon" aria-hidden="true">
                        <use href="#i-drive"/>
                    </svg>
                    Conectar Google Drive
                </button>
                {onEnterDemo && (
                    <button
                        className="button secondary access-demo-btn"
                        id="enter-demo"
                        type="button"
                        disabled={bootFailed}
                        onClick={onEnterDemo}
                    >
                        <svg className="icon" aria-hidden="true">
                            <use href="#i-eye"/>
                        </svg>
                        Probar en modo local (sin cuenta)
                    </button>
                )}
            </div>
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

            <div className="access-features" aria-label="Características de privacidad y uso">
                <div className="access-feature-item">
                    <span className="feature-icon" aria-hidden="true">
                        <svg className="icon"><use href="#i-lock"/></svg>
                    </span>
                    <div>
                        <strong>Tus archivos en tu Google Drive</strong>
                        <p>Tus archivos se guardan en Google Drive. La aplicación conserva una copia de las fichas y los
                            cambios pendientes en este navegador.</p>
                    </div>
                </div>
                <div className="access-feature-item">
                    <span className="feature-icon" aria-hidden="true">
                        <svg className="icon"><use href="#i-scan"/></svg>
                    </span>
                    <div>
                        <strong>Lectura inteligente con OCR</strong>
                        <p>Extrae fecha, médico y tipo de estudio desde informes en PDF o fotos tomadas con el
                            celular.</p>
                    </div>
                </div>
                <div className="access-feature-item">
                    <span className="feature-icon" aria-hidden="true">
                        <svg className="icon"><use href="#i-check"/></svg>
                    </span>
                    <div>
                        <strong>Disponible sin conexión</strong>
                        <p>Consultá la última copia de tus fichas y guardá cambios pendientes. Abrir informes y visores
                            puede requerir conexión.</p>
                    </div>
                </div>
            </div>
        </>
    );
}
