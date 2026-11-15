import {useEffect, useRef, useState} from 'preact/hooks';
import type {ComponentChildren} from 'preact';
import {appointmentStatus} from '@domain/appointments';
import type {ViewMode} from '@domain/models';
import {
    pendingChanges,
    portals,
    setExporting,
    setRecoveringStudyId,
    view,
    visibleAppointments,
    visibleOperations,
    visibleStudies,
} from '../state/store';
import {ThemeToggle} from './ThemeToggle';
import {FolderPickerDialog} from './FolderPickerDialog';

interface AppShellProps {
    isSignedIn: boolean;
    onSignOut: () => void;
    children: ComponentChildren;
}

interface NavItem {
    label: string;
    icon: string;
    view?: ViewMode;
    activeViews?: ViewMode[];
    count?: number;
    tone?: 'warning' | 'danger';
    action?: 'search' | 'export';
}

const labels: Record<ViewMode, string> = {
    resumen: 'Resumen',
    cronologia: 'Biblioteca',
    categoria: 'Biblioteca',
    portales: 'Portales',
    operaciones: 'Operaciones',
    eventos: 'Consultas y recetas',
    episodios: 'Episodios',
    turnos: 'Turnos',
    intake: 'Intake asistido',
};

export function AppShell({isSignedIn, onSignOut, children}: AppShellProps) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const wasOpen = useRef(false);
    const studiesCount = visibleStudies.value.length;
    const operationsCount = visibleOperations.value.length;
    const portalsCount = portals.value.length;
    const appointmentsCount = visibleAppointments.value.filter(
        (appointment) => appointment.status === 'scheduled' && appointmentStatus(appointment, new Date()) === 'upcoming',
    ).length;
    const pendingCount = pendingChanges.value.length;

    useEffect(() => {
        setOpen(false);
    }, [view.value]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        if (open) {
            closeRef.current?.focus();
        } else if (wasOpen.current && window.innerWidth <= 1024) {
            menuRef.current?.focus();
        }
        wasOpen.current = open;
    }, [open]);

    useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    const groups: { label: string; items: NavItem[] }[] = [
        {
            label: 'General',
            items: [
                {label: 'Resumen', icon: 'i-grid', view: 'resumen', count: pendingCount || undefined, tone: 'warning'},
                {
                    label: 'Biblioteca',
                    icon: 'i-folder',
                    view: 'cronologia',
                    activeViews: ['cronologia', 'categoria'],
                    count: studiesCount
                },
                {label: 'Portales', icon: 'i-globe', view: 'portales', count: portalsCount},
                {label: 'Operaciones', icon: 'i-scissors', view: 'operaciones', count: operationsCount},
            ],
        },
        {
            label: 'Seguimiento',
            items: [
                {
                    label: 'Turnos',
                    icon: 'i-calendar',
                    view: 'turnos',
                    count: appointmentsCount || undefined,
                    tone: 'warning'
                },
                {label: 'Consultas y recetas', icon: 'i-stethoscope', view: 'eventos'},
                {label: 'Episodios', icon: 'i-layers', view: 'episodios'},
            ],
        },
        {
            label: 'Archivo',
            items: [
                {label: 'Intake asistido', icon: 'i-scan', view: 'intake'},
                {label: 'Exportar historia', icon: 'i-download', action: 'export'},
            ],
        },
    ];

    const navigate = (item: NavItem) => {
        setOpen(false);
        if (item.action === 'export') {
            setExporting(true);
            return;
        }
        if (item.view) view.value = item.view;
    };

    const isActive = (item: NavItem) => item.activeViews ? item.activeViews.includes(view.value) : item.view === view.value;

    return (
        <div className="app-shell" data-signed-in={isSignedIn}>
            <aside className="sidebar" id="sidebar" aria-label="Navegación principal" hidden={!isSignedIn}
                   data-open={open}>
                <div className="sidebar-head">
                    <a className="brand" href="#main" aria-label="Mis estudios, inicio">
                        <span className="brand-mark"><svg className="icon"><use href="#i-file"/></svg></span>
                        <span className="brand-text">
              <span className="brand-name">Mis estudios</span>
              <span className="brand-tag">Archivo privado</span>
            </span>
                    </a>
                    <button ref={closeRef} className="icon-button sidebar-close" type="button" aria-label="Cerrar menú"
                            onClick={() => setOpen(false)}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>

                <nav className="sidebar-nav">
                    {groups.map((group) => (
                        <div className="nav-group" key={group.label}>
                            <p className="nav-label">{group.label}</p>
                            {group.items.map((item) => (
                                <button
                                    key={item.label}
                                    id={`nav-${item.view ?? item.action ?? item.label}`}
                                    className="nav-item"
                                    type="button"
                                    data-nav={item.label}
                                    aria-current={isActive(item) ? 'page' : undefined}
                                    onClick={() => navigate(item)}
                                >
                                    <svg className="icon">
                                        <use href={`#${item.icon}`}/>
                                    </svg>
                                    <span>{item.label}</span>
                                    {item.count ?
                                        <span className="nav-count" data-tone={item.tone}>{item.count}</span> : null}
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="sidebar-foot">
                    <FolderPickerDialog/>
                    <p className="privacy-note">
                        <svg className="icon">
                            <use href="#i-lock"/>
                        </svg>
                        <span><strong>Solo vos</strong>Los archivos viven en tu Drive privado.</span>
                    </p>
                    <div className="sidebar-account">
                        <span className="avatar" aria-hidden="true"><svg className="icon"><use
                            href="#i-lock"/></svg></span>
                        <span className="account-text">
              <span className="account-name">Cuenta privada</span>
              <span className="account-mail">Sesión verificada</span>
            </span>
                    </div>
                </div>
            </aside>

            <button className="sidebar-scrim" type="button" aria-label="Cerrar menú" data-open={open}
                    hidden={!isSignedIn} onClick={() => setOpen(false)}/>

            <div className="app-main">
                <header className="topbar">
                    <button ref={menuRef} id="menuBtn" className="icon-button topbar-menu" type="button"
                            aria-label="Abrir menú"
                            aria-expanded={open} aria-controls="sidebar" hidden={!isSignedIn}
                            onClick={() => setOpen(true)}>
                        <svg className="icon">
                            <use href="#i-menu"/>
                        </svg>
                    </button>

                    {!isSignedIn && (
                        <a className="brand topbar-brand" href="#main">
                            <span className="brand-mark"><svg className="icon"><use href="#i-file"/></svg></span>
                            <span className="brand-name">Mis estudios</span>
                        </a>
                    )}

                    {isSignedIn && (
                        <nav className="crumbs" aria-label="Ruta de navegación">
                            <span>Archivo</span>
                            <svg className="icon">
                                <use href="#i-chevron-right"/>
                            </svg>
                            <span aria-current="page">{labels[view.value]}</span>
                        </nav>
                    )}

                    <div className="topbar-actions">
                        <span className="private" hidden={!isSignedIn}><svg className="icon"><use href="#i-lock"/></svg> Cuenta privada verificada</span>
                        <button className="icon-button optional" id="export-history" type="button"
                                title="Exportar historia" aria-label="Exportar historia" hidden={!isSignedIn}
                                onClick={() => setExporting(true)}>
                            <svg className="icon">
                                <use href="#i-download"/>
                            </svg>
                        </button>
                        <button className="icon-button" id="recover-studies" type="button" title="Recuperar informe"
                                aria-label="Recuperar informe" hidden={!isSignedIn}
                                onClick={() => setRecoveringStudyId('recovery')}>
                            <svg className="icon">
                                <use href="#i-restore"/>
                            </svg>
                        </button>
                        <ThemeToggle/>
                        <button className="button quiet topbar-signout" id="signout" type="button" hidden={!isSignedIn}
                                onClick={onSignOut}>Salir
                        </button>
                    </div>
                </header>

                {children}
            </div>
        </div>
    );
}