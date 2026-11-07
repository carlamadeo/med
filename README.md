# Mis estudios

Archivo personal de informes médicos para usar desde el celular o la computadora. La página se publica en GitHub Pages y guarda los estudios en una carpeta privada de Google Drive llamada **Mis estudios**. Usá la misma cuenta de Google en ambos dispositivos.

Al elegir un PDF, la página lee hasta las primeras seis páginas en el navegador y sugiere la fecha del estudio, el tipo y el profesional. Si falta información y hay páginas escaneadas entre las primeras tres, intenta leerlas con OCR en español. Revisá los datos antes de guardar. Si no encuentra un dato, el campo queda disponible para completarlo a mano. El PDF se sube a Drive al pulsar **Guardar estudio**.

## Publicar

1. Creá un repositorio en tu cuenta de GitHub y subí este código a la rama `main`. El sitio de Pages puede ser público: publica la interfaz, mientras que los datos de cada cuenta quedan en Drive. Para publicar desde un repositorio privado, verificá que tu plan de GitHub admita Pages en repositorios privados.
2. En Google Cloud, creá un proyecto y habilitá **Google Drive API**. En **Google Auth Platform**, configurá la pantalla de autorización. Si la audiencia es externa y la app está en modo de prueba, agregá como usuaria de prueba la cuenta con la que vas a usar el archivo.
3. Creá un cliente OAuth de tipo **Aplicación web**. En **Orígenes autorizados de JavaScript**, agregá el origen de la página, por ejemplo `https://tu-usuario.github.io`, sin el nombre del repositorio al final. El permiso de la app es `https://www.googleapis.com/auth/drive.file`.
4. En GitHub, agregá el **ID de cliente** de Google como variable del repositorio llamada `GOOGLE_CLIENT_ID` en **Settings → Secrets and variables → Actions → Variables**. El ID es público. Esta app funciona sin el secreto del cliente.
5. En **Settings → Pages**, elegí **GitHub Actions** como origen. En **Actions → Publicar Mis estudios**, ejecutá el flujo. Abrí la URL que muestra la ejecución en un navegador normal y elegí **Conectar Google Drive**.

[Configurar GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Crear el ID de cliente de Google](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid) · [Alcance del permiso de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

## Probar en la computadora

Con Node.js 24, ejecutá `npm ci`, `npm run build` y `npm start`. La vista previa abre en `http://localhost:4173`. Para probar con Drive real, agregá `http://localhost` y `http://localhost:4173` al cliente OAuth y pasá su ID al compilar:

```sh
GOOGLE_CLIENT_ID='tu-id.apps.googleusercontent.com' npm run build
npm start
```

El acceso se mantiene en la pestaña. Si cerrás la página o vence la sesión, podés conectar Drive de nuevo. Los PDFs que guardes también se pueden abrir desde la carpeta de Drive. Al eliminar un estudio desde la app, pasa a la papelera de Drive.
