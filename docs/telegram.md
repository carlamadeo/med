# Carga desde Telegram

El bot guarda los estudios y los turnos en tu cuenta de Mis estudios después de que confirmás la ficha en el chat. Lee
el texto del PDF y, si es un escaneo, intenta leerlo con OCR en español en el equipo que ejecuta el bot. Podés pegar el
enlace del visor junto al PDF, agregarlo desde el botón de la ficha o cargar un estudio con solo el enlace. Para un
turno, reenviá la confirmación o escribí la fecha y la hora en el chat.

## Activar el bot

1. Creá un bot con [@BotFather](https://t.me/BotFather) y poné el token en el archivo local `.env.telegram` como
   `TELEGRAM_BOT_TOKEN=...`. Guardalo en el archivo y evitá enviarlo por chat.
2. Desde la carpeta del repositorio, ejecutá `npm ci` y `npm run bot:build`. Ejecutá `npm run bot -- identify` y mandale
   al bot el código que muestra la terminal. Copiá la línea `TELEGRAM_OWNER_ID=...` al mismo archivo local. Solo ese
   usuario podrá cargar fichas.
3. En el mismo proyecto de Google Cloud que ya usa Mis estudios, creá
   un [cliente OAuth de escritorio](https://developers.google.com/identity/protocols/oauth2/native-app). Descargá su
   JSON como `.data/telegram/google-client.json`. El bot busca la carpeta existente de Mis estudios en la cuenta que
   autorices.
4. Ejecutá `npm run bot -- authorize --calendar` y abrí el enlace que aparece en la terminal. Elegí la cuenta que ya
   usás en Mis estudios. Si solo querés Drive, omití `--calendar`. Para Calendar, habilitá la API en el mismo proyecto.
   Si el proyecto OAuth sigue en modo de prueba, Google puede pedir que vuelvas a autorizar al cabo de siete días.
5. Ejecutá `npm run bot` y mandale `/start` al bot. Probá primero con un PDF ficticio y un turno de prueba. Verificá que
   ambos aparezcan en Mis estudios y, si lo autorizaste, que el turno aparezca en el calendario **Turnos**.

Mantené **una sola instancia** del bot en ejecución. Si cerrás la terminal o la computadora duerme, el bot deja de
responder hasta que el proceso vuelva a estar activo. El archivo de entorno, los permisos y la ficha pendiente quedan en
archivos locales ignorados por Git. El bot descarga los PDF desde Telegram para analizarlos y guardarlos en Drive, y no
necesita reenviar el informe a servicios de OCR externos. Telegram conserva la conversación según la configuración del
chat.

## Usar el chat

- Mandá un PDF como documento, con o sin enlace en el texto del mensaje. Si hay varios enlaces, elegí el del visor desde
  **Agregar enlace al visor**. El enlace se guarda en la ficha; si el portal requiere iniciar sesión, lo hará al
  abrirlo.
- Para cargar un turno, podés escribir «Turno con la Dra. Pérez el 25/11/2026 a las 15:30 en el Hospital Italiano».
  Revisá la fecha y hora de Buenos Aires antes de tocar **Guardar**.
- Usá **Corregir** para completar campos de la ficha. Las modificaciones muestran una confirmación nueva. Usá
  `/pendiente` si querés volver a una ficha que dejaste abierta.
