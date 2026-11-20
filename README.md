# Mis estudios

Archivo personal de informes médicos para usar desde el celular o la computadora. La página se publica en GitHub Pages y
guarda los estudios en una carpeta privada de Google Drive llamada **Mis estudios**. Usá la misma cuenta de Google en
ambos dispositivos.

Al elegir un PDF, la página lee hasta las primeras seis páginas en el navegador y sugiere la fecha del estudio, sus
tipos y el profesional. Para el médico, se prioriza el nombre del encabezado; la firma se usa como respaldo si no se
encuentra allí. Podés seleccionar uno o varios tipos para el mismo informe: por ejemplo, **Mamografía** y **Ecografía**.
Cada estudio aparece al filtrar por cualquiera de sus tipos. Los estudios guardados con un solo tipo siguen funcionando.
Si falta información, intenta leer con OCR en español las páginas escaneadas entre las primeras tres y los sellos de
firma que aparecen como imágenes en las primeras seis. Revisá los datos antes de guardar. Si no encuentra un dato, el
campo queda disponible para completarlo a mano. También podés leer archivos JPEG o PNG, o tomar una foto desde
el celular. El adjunto se sube a Drive al pulsar **Guardar estudio**.

El campo **Portal o institución** permite escribir un nombre nuevo o elegir entre las instituciones de todos tus
estudios guardados. Las sugerencias se ordenan alfabéticamente y no repiten nombres por diferencias de mayúsculas,
tildes o espacios. Un nombre nuevo aparece después de guardar el estudio; al conectar Drive en otro dispositivo, también
estará disponible allí.

Para incorporar estudios anteriores, elegí **Importar estudios** y seleccioná varios PDF. Prepará un archivo por
estudio, con todas las páginas del informe. La aplicación lee cada PDF y muestra una ficha para revisar y corregir.
Podés asignar una institución a varias fichas seleccionadas y guardar juntas las que tengan nombre, fecha y tipo.
Las fichas pendientes permanecen disponibles mientras la página siga abierta. Elegí **Conservar borrador** para
retomar la tanda con la misma cuenta en ese navegador. Antes de recargar, usá **Actualizar borrador** para conservar
los últimos cambios. La opción guarda los PDF, los datos editados y las huellas de los informes importados con esa
opción activa. Las huellas permiten advertir si volvés a elegir el mismo informe con otro nombre. Podés administrar
el borrador y las huellas desde el diálogo de importación.

Las vistas de **Operaciones** y **Portales** permiten guardar fichas independientes en la misma carpeta de Drive. Una
operación puede agrupar estudios mediante el selector de su ficha; para eliminarla primero hay que desvincularlos. Desde
cada portal se pueden consultar los estudios que coinciden con el nombre de la institución. Las fichas de operaciones y
portales también se sincronizan al conectar la misma cuenta en otro dispositivo. Si otra sesión modifica una ficha
mientras la estás editando, actualizá los datos antes de volver a guardar.

En **Resumen** podés buscar estudios por nombre, profesional o institución. En **Biblioteca**
podés combinar esa búsqueda con uno o varios tipos y una especialidad, y ordenar por fecha, nombre,
profesional o institución. Elegí o escribí la especialidad al agregar o editar un estudio.
Desde Portales y Operaciones podés abrir la Biblioteca con el filtro correspondiente. La lista muestra hasta
50 fichas por página. **Resultados filtrados** en la exportación incluye todas las coincidencias.

Usá **Buscar en el archivo** o `Ctrl+K` / `⌘K` para abrir la búsqueda global. El atajo `n` abre un estudio nuevo.
Si Drive devuelve una ficha ilegible, las demás quedan disponibles y la interfaz avisa cuántas faltan. La
exportación espera a que se pueda leer el historial completo.

Desde **Próximo turno** en Resumen o desde **Turnos**, usá **Preparar consulta** para revisar los adjuntos de los
estudios vinculados y descargarlos juntos en un ZIP. Los enlaces a visores se incluyen cuando los marcás.
**Agregar al calendario** descarga un archivo `.ics` con la fecha y la hora del turno, un título neutro y un
aviso opcional. Si reprogramás el turno, reemplazá el evento anterior en tu calendario.

Si una importación desde **Bandeja de entrada** queda sin confirmar, la reserva del archivo se conserva en este
navegador para la cuenta que inició el guardado. Volvé a conectarte para que la aplicación revise el estado del
archivo en Drive y reutilice el identificador original cuando haga falta.

## Publicar

1. Creá un repositorio en tu cuenta de GitHub y subí este código a la rama `main`. El sitio de Pages puede ser público:
   publica la interfaz, mientras que los datos de cada cuenta quedan en Drive. Para publicar desde un repositorio
   privado, verificá que tu plan de GitHub admita Pages en repositorios privados.
2. En Google Cloud, creá un proyecto y habilitá **Google Drive API**. En **Google Auth Platform**, configurá la pantalla
   de autorización. Si la audiencia es externa y la app está en modo de prueba, agregá como usuaria de prueba la cuenta
   con la que vas a usar el archivo.
3. Creá un cliente OAuth de tipo **Aplicación web**. En **Orígenes autorizados de JavaScript**, agregá el origen de la
   página, por ejemplo `https://tu-usuario.github.io`, sin el nombre del repositorio al final. El permiso de la app es
   `https://www.googleapis.com/auth/drive.file`.
4. En GitHub, agregá el **ID de cliente** de Google como variable del repositorio llamada `GOOGLE_CLIENT_ID` en
   **Settings → Secrets and variables → Actions → Variables**. El ID es público. Esta app funciona sin el secreto del
   cliente.
5. En **Settings → Pages**, elegí **GitHub Actions** como origen. En **Actions → Publicar Mis estudios**, ejecutá el
   flujo. Abrí la URL que muestra la ejecución en un navegador normal y elegí **Conectar Google Drive**.

[Configurar GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Crear el ID de cliente de Google](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid) · [Alcance del permiso de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

## Probar en la computadora

Con Node.js 24.15 o posterior de la serie 24, o Node.js 26 o superior, ejecutá `npm ci`, `npm run build` y `npm start`. La vista previa abre en `http://localhost:4173`. Para
probar con Drive real, agregá `http://localhost` y `http://localhost:4173` al cliente OAuth y pasá su ID al compilar:

```sh
GOOGLE_CLIENT_ID='tu-id.apps.googleusercontent.com' npm run build
npm start
```

El acceso se conserva al recargar la misma pestaña y los estudios se cargan automáticamente, mientras el permiso de
Google siga vigente. Se guarda temporalmente en `sessionStorage`, con su vencimiento original; no se renueva al
recargar. Al pulsar **Salir**, se borra de la pestaña. Si cerrás la pestaña, vence el permiso o Google lo rechaza, tenés
que conectar Drive de nuevo. Si el navegador bloquea el almacenamiento de sesión, el acceso se mantiene solo hasta
recargar. Los PDFs que guardes también se pueden abrir desde la carpeta de Drive. Al eliminar un estudio desde la app,
pasa a la papelera de Drive.

Para desarrollo usá `npm run dev`; los controles principales son `npm run typecheck`, `npm run lint`,
`npm run test:coverage`, `npm run test:e2e`, `npm run test:offline`, `npm run test:outbox` y `npm run test:lighthouse`.
Lighthouse mide la pantalla de acceso con la configuración disponible al compilar. El procesamiento de PDF y OCR se
ejecuta en workers; sus recursos se preparan con `npm run vendor` antes de iniciar o compilar. La aplicación guarda sus
recursos públicos para poder abrir la interfaz sin conexión. Mientras siga vigente la misma sesión, puede mostrar la
última copia de estudios, operaciones y portales que haya cargado; estos datos pueden estar desactualizados hasta
recuperar la conexión.

Después de verificar la cuenta estando en línea, es posible guardar o eliminar estudios, operaciones y portales sin
conexión. Los cambios y PDFs pendientes permanecen en este navegador y se envían al volver a conectarse con la misma
cuenta, mientras la página esté abierta. Si la ficha cambió en Drive, la cola se detiene y muestra el conflicto; se
puede descartar el cambio pendiente después de revisarlo. Cerrar sesión no elimina la cola, pero se necesita volver a
conectar la misma cuenta para verla y sincronizarla. Borrar los datos del sitio en el navegador también elimina los
cambios pendientes. Para encolar o sincronizar cambios se necesita un navegador con Web Locks. Una operación nueva
creada sin conexión debe sincronizarse antes de poder asociarle un estudio.
