type Permission = NotificationPermission | 'unsupported' | 'unavailable';

const permissionLabels: Record<Permission, string> = {
    granted: 'concedido',
    denied: 'denegado',
    default: 'pendiente',
    unsupported: 'no disponible',
    unavailable: 'no disponible',
};

export function AppointmentReminderNote({permission}: {permission: Permission}) {
    return (
        <div className="appointment-reminder-note">
            <p className="appointment-note">
                Los avisos requieren la aplicación abierta, una sesión activa y el turno sincronizado.
                {' '}Permiso {permissionLabels[permission]}.
            </p>
            {(!navigator.locks || !navigator.serviceWorker?.controller) && (
                <p className="appointment-note" role="status">
                    Los avisos del navegador estarán disponibles cuando la aplicación termine de iniciar,
                    si el navegador los admite.
                </p>
            )}
        </div>
    );
}
