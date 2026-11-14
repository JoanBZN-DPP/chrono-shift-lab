# The Chrono Shift Lab

[Jugar](https://joanbzn-dpp.github.io/chrono-shift-lab/) · [Código público](https://github.com/JoanBZN-DPP/chrono-shift-lab)

Juego de puzles temporales con 30 niveles, clones, portales, cintas, puntuación por nivel, lobby con código, ranking y panel de administrador. Se conserva el botón **Cerrar paneles**.

## Estado publicado

El juego está desplegado en GitHub Pages y conectado a un proyecto real de Firebase Realtime Database en `us-central1`. La configuración pública está en `firebase-config.js`; una configuración web pública no es una clave privada.

Está habilitado el acceso anónimo y Google Authentication opcional para jugadores, y el dominio de GitHub Pages está autorizado. La administración usa Email/Password de Firebase en una app Firebase separada. Las reglas publicadas de `firebase.rules.json` no dejan la raíz abierta. La persistencia real conserva las salas, jugadores, puntuaciones y snapshots descritos más abajo.

## Uso

1. Para jugar, puedes entrar con Google desde **Partidas / Unirme** si quieres recuperar el mismo UID y progreso en otro computador; también puedes unirte por código con la identidad anónima del navegador.
2. En **Partidas / Unirme**, escribe un apodo y el código que comparte el administrador. Todos los jugadores deben entrar en la misma partida; el reloj sincronizado es el del servidor y continúa aunque cierres el juego.
3. Para administrar, abre **Panel de administración** en la pantalla principal o en la ayuda inicial e introduce la contraseña compartida. En modo Firebase, el juego autentica la identidad pública fija `chrono-shift-admin@chrono-shift-lab.firebaseapp.com` mediante Email/Password en una app Firebase separada, usa persistencia `NONE` y comprueba `/admins/{uid}: true` antes de desbloquear el panel. La contraseña no se guarda en el navegador, en `localStorage` ni en este repositorio. Al crear una partida, comparte el código y pulsa **Iniciar** desde el panel.
4. Un invitado anónimo solo tiene identidad en ese navegador. Google es opcional para jugadores y no se usa como paso de administración; la identidad/UID de jugador y su progreso permanecen separados de la sesión administrativa.

La práctica local no implica guardado en la nube.

## Datos y seguridad

Existe una sola sala activa global en `match/state`. `players/{uid}` mantiene un único registro por UID con puntuación y niveles superados; no se conserva un archivo histórico de partidas. El snapshot JSON conserva nivel, movimientos, clones, posiciones, bloques, bucle y tiempo empleado. Los arrays vacíos también se conservan dentro del JSON.

Solo un UID autorizado en `/admins` puede gestionar la partida. La autenticación administrativa usa una app Firebase nombrada y su propio `adminDb`; no sustituye la autenticación ni el UID de jugadores. Cada jugador solo puede escribir su propio registro y los usuarios autenticados pueden leer el ranking. El código de acceso no sustituye a las reglas de seguridad. Las puntuaciones se calculan en el cliente, por lo que no hay protección antifraude de competición.

## Pruebas automatizadas

La validación automatizada cubre sintaxis/configuración, comportamiento del juego y progreso, separación entre las sesiones de jugador y administrador, errores de contraseña/rol, límites de espera, reintentos y reglas seguras de RTDB:

```sh
node tests/smoke.test.js
node tests/behavior.test.js
node tests/firebase-auth.test.js
npx firebase-tools@13.35.1 emulators:exec --only database --project demo-chrono-shift 'node tests/rtdb-emulator.test.js'
```

La última orden usa Java y un emulador local, no el proyecto Firebase real. `firebase.json` también permite desplegar solo las reglas con Firebase CLI una vez autorizado el proyecto correcto.

La dependencia PeerJS conserva su aviso MIT en `THIRD_PARTY_NOTICES.md`; ese aviso no cambia la licencia del código original del juego.
