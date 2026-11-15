import {useEffect, useRef, useState} from 'preact/hooks';
import {driveAuth, driveClient} from '@data';
import {approvedFolderId, isFolderPickerOpen, setApprovedFolderId, setFolderPickerOpen} from '../state/store';
import {useFocusTrap} from '../utils/focusTrap';

const STORAGE_KEY = 'mis-estudios-intake-folder';

interface DriveFolder {
    id: string;
    name: string;
    modifiedTime?: string;
}

export function FolderPickerDialog() {
    const open = isFolderPickerOpen.value;
    const setOpen = setFolderPickerOpen;
    const [folders, setFolders] = useState<DriveFolder[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const currentFolderId = approvedFolderId.value;
    useFocusTrap(dialogRef, open);

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && !currentFolderId) {
            setApprovedFolderId(stored);
        }
    }, []);

    const loadFolders = async () => {
        if (!driveAuth.isSignedIn()) return;
        setLoading(true);
        setError(null);
        try {
            await driveAuth.getAccessToken();
            const allFolders: DriveFolder[] = [];
            let pageToken = '';
            const query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
            do {
                const response = await driveClient.request(
                    driveClient.url('https://www.googleapis.com/drive/v3/', 'files', {
                        q: query,
                        spaces: 'drive',
                        pageSize: '100',
                        fields: 'nextPageToken,files(id,name,modifiedTime)',
                        orderBy: 'modifiedTime desc',
                        ...(pageToken ? {pageToken} : {}),
                    })
                ).then((r: Response) => r.json() as Promise<{ files?: DriveFolder[]; nextPageToken?: string }>);
                if (response.files) allFolders.push(...response.files);
                pageToken = response.nextPageToken ?? '';
            } while (pageToken);
            setFolders(allFolders);
            setSelectedId(currentFolderId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudieron cargar las carpetas');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open) {
            loadFolders();
            if (!dialog.open) dialog.showModal();
        } else {
            if (dialog.open) dialog.close();
        }
        return () => {
            if (dialog.open) dialog.close();
        };
    }, [open]);

    useEffect(() => () => setOpen(false), []);

    const handleSelect = (folder: DriveFolder) => {
        setSelectedId(folder.id);
    };

    const handleSave = async () => {
        if (!selectedId) return;
        localStorage.setItem(STORAGE_KEY, selectedId);
        setApprovedFolderId(selectedId);
        setOpen(false);
    };

    const handleClear = () => {
        localStorage.removeItem(STORAGE_KEY);
        setApprovedFolderId(null);
        setSelectedId(null);
        setOpen(false);
    };

    const handleOpen = () => setOpen(true);

    return (
        <>
            <button
                type="button"
                className="button quiet sidebar-folder-button"
                onClick={handleOpen}
                title="Configurar carpeta de intake"
            >
                <svg className="icon" aria-hidden="true"><use href="#i-folder"/></svg>
                <span>Carpeta de intake</span>
            </button>

            <dialog
                ref={dialogRef}
                className="dialog folder-picker"
                aria-labelledby="folder-picker-title"
                onCancel={(event) => {
                    event.preventDefault();
                    setOpen(false);
                }}
                onClose={() => setOpen(false)}
            >
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Intake asistido</p>
                        <h2 id="folder-picker-title">Carpeta de documentos</h2>
                    </div>
                    <button className="icon-button" type="button" aria-label="Cerrar" onClick={() => setOpen(false)}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>

                {error && <p className="form-error" role="alert">{error}</p>}

                {loading ? (
                    <div className="folder-picker-loading" role="status">Cargando carpetas…</div>
                ) : (
                    <div className="folder-picker-list" role="listbox" aria-label="Carpetas de Drive">
                        {folders.length === 0 ? (
                            <p className="folder-picker-empty">No se encontraron carpetas en Drive.</p>
                        ) : (
                            folders.map((folder) => (
                                <button
                                    key={folder.id}
                                    type="button"
                                    className={`folder-picker-item ${selectedId === folder.id ? 'selected' : ''}`}
                                    role="option"
                                    aria-selected={selectedId === folder.id}
                                    onClick={() => handleSelect(folder)}
                                >
                                    <span className="folder-picker-name">{folder.name}</span>
                                    <span className="folder-picker-meta">
                                        {folder.modifiedTime ? new Date(folder.modifiedTime).toLocaleDateString('es-AR') : ''}
                                    </span>
                                    {selectedId === folder.id && <svg className="icon check"><use href="#i-check"/></svg>}
                                </button>
                            ))
                        )}
                    </div>
                )}

                <div className="dialog-actions">
                    {currentFolderId && (
                        <button type="button" className="button quiet" onClick={handleClear}>
                            Desconfigurar
                        </button>
                    )}
                    <button
                        type="button"
                        className="button primary"
                        disabled={!selectedId || selectedId === currentFolderId}
                        onClick={handleSave}
                    >
                        {currentFolderId ? 'Cambiar' : 'Guardar'}
                    </button>
                    <button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancelar</button>
                </div>
            </dialog>
        </>
    );
}