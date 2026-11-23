# Plan del bot de Telegram

El bot personal recibe estudios y turnos. Una ficha se guarda en Mis estudios recién después de confirmarla en el chat. El flujo y el campo opcional de visor se aprobaron en la conversación.

1. Implementar el borrador y la confirmación en `src/bot/conversation.ts`. Probar adjunto más enlace, estudio con solo enlace, botones anteriores a una corrección, cancelación y turnos con fecha y hora.
2. Reusar los repositorios de Drive y Calendar en `src/bot/google.ts`. Reservar y persistir el ID antes de guardar para permitir reintentos. Mantener los permisos de la aplicación y autorizar una sola cuenta de Telegram.
3. Añadir el proceso de Telegram en `src/bot/main.ts`, lectura de PDF en el servidor y autorización de Google. Guardar el estado mínimo fuera del repositorio. Probar el formato de Drive con respuestas simuladas y documentar la activación.
