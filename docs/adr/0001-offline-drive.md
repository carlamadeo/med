# 0001. Copias locales y cambios pendientes de Drive

Estado: vigente. Fecha: 2026-11-12.

## Contexto

La aplicación no tiene servidor propio. Drive es la fuente de verdad y los documentos pueden contener información médica. Una pérdida de red o un cambio de cuenta no deben enviar datos a otra cuenta ni borrar silenciosamente un cambio pendiente.

## Decisión

El service worker guarda únicamente recursos públicos de la aplicación. Las fichas consultadas se guardan en IndexedDB y la copia se vincula a un hash del token de la sesión. Al cambiar o vencer el token no se muestra la copia anterior. Esto permite la lectura sin red durante la misma sesión, pero obliga a volver a cargar los datos tras renovar el token.

La cola de cambios se guarda en otra base de IndexedDB y se asocia al identificador de la cuenta que devuelve `about.user.permissionId` de Drive. La identidad debe haberse verificado en línea antes de aceptar cambios sin red. Cerrar sesión borra la caché de fichas, no la cola. Se reserva un ID de Drive antes de enviar una ficha nueva y se conserva para poder reintentar. Los cambios a una misma ficha no se acumulan de forma concurrente y Web Locks serializa el envío entre pestañas.

Al recuperar la conexión se verifica de nuevo la cuenta. Un conflicto detiene la cola para que la persona revise el cambio pendiente; la aplicación no sobrescribe automáticamente la ficha de Drive. Un resultado de red incierto conserva el cambio. Descartarlo requiere una acción explícita. Al borrar los datos del sitio se borra también la cola local.

## Límites

La usuaria eligió mantener las credenciales en `sessionStorage`, no en el almacenamiento persistente ni en el service worker. Por ello la sincronización automática requiere que una página de la aplicación esté abierta y que la sesión siga activa o se reconecte; no se promete envío con la página cerrada. El navegador puede desalojar almacenamiento local, y los PDFs pendientes ocupan espacio en el dispositivo. La cola admite estudios, operaciones y portales; una operación nueva debe sincronizarse antes de asociarle estudios. El chequeo de versión se realiza antes de escribir en Drive y no constituye una transacción entre dispositivos.

Si se pierde la respuesta de una eliminación, el reintento acepta el resultado solo cuando Drive confirma que el mismo archivo de la aplicación está en la papelera; un 404 o una pérdida de acceso no se consideran éxito. Si se pierde la respuesta de una edición que Drive ya aplicó, el cambio de versión puede producir un conflicto: se conserva el elemento pendiente para revisión manual, incluso si el contenido remoto ya coincide. No se presume que un PDF remoto sea idéntico sin comprobar su contenido.
