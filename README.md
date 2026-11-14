# The Chrono Shift Lab

[Jugar](https://joanbzn-dpp.github.io/chrono-shift-lab/) · [Código público](https://github.com/JoanBZN-DPP/chrono-shift-lab)

Juego de puzles temporales con 30 niveles, clones, portales, cintas, puntuación por nivel, lobby con código, ranking y panel de administrador. Se conserva el botón **Cerrar paneles**.

## Estado publicado

El juego está desplegado en GitHub Pages y conectado a un proyecto real de Firebase Realtime Database en `us-central1`. La configuración pública está en `firebase-config.js`; una configuración web pública no es una clave privada.

Está habilitado el acceso anónimo y Google Authentication, y el dominio de GitHub Pages está autorizado. Las reglas publicadas de `firebase.rules.json` no dejan la raíz abierta. La persistencia real conserva las salas, jugadores, puntuaciones y snapshots descritos más abajo.

## Uso

1. Entra con Google **antes de jugar** para recuperar el mismo UID y progreso si continúas desde otro computador.
2. En **Partidas / Unirme**, escribe un apodo y el código que comparte el administrador. Todos los jugadores deben entrar en la misma partida; el reloj sincronizado es el del servidor y continúa aunque cierres el juego.
3. Para administrar, usa la misma cuenta Google autorizada y luego la contraseña local del panel. Si el navegador bloquea la ventana emergente de Google, el inicio continúa en la misma pestaña; al volver desde el acceso iniciado en **Panel Admin**, aparece directamente el campo de contraseña. La contraseña local no reemplaza el rol de administrador de Firebase. Al crear una partida, comparte el código y pulsa **Iniciar** desde el panel.
4. Un invitado anónimo solo tiene identidad en ese navegador. Vincularlo a una cuenta Google nueva para Firebase conserva su UID; si la cuenta Google ya tenía un historial, se recupera ese historial sin fusionar ambos automáticamente.

La práctica local no implica guardado en la nube.

## Datos y seguridad

Existe una sola sala activa global en `match/state`. `players/{uid}` mantiene un único registro por UID con puntuación y niveles superados; no se conserva un archivo histórico de partidas. El snapshot JSON conserva nivel, movimientos, clones, posiciones, bloques, bucle y tiempo empleado. Los arrays vacíos también se conservan dentro del JSON.

Solo un UID autorizado en `/admins` puede gestionar la partida. Cada jugador solo puede escribir su propio registro y los usuarios autenticados pueden leer el ranking. El código de acceso no sustituye a las reglas de seguridad. Las puntuaciones se calculan en el cliente, por lo que no hay protección antifraude de competición.

## Verificación realizada

En el sitio publicado se comprobó la conexión real a Firebase, el acceso Google y el rol administrador, la creación e inicio de una partida y el ingreso por código desde otra pestaña. Después de mover y crear un clon, recargar y reingresar recuperó un clon en el bucle 2. Completar el primer nivel produjo 931 puntos, visibles en tiempo real en la pestaña de administración.

Estas comprobaciones se hicieron con pestañas y recargas del navegador, no con dos computadores físicos. También pasaron las pruebas de sintaxis/configuración, comportamiento y reglas en el emulador RTDB:

```sh
node tests/smoke.test.js
node tests/behavior.test.js
npx firebase-tools@13.35.1 emulators:exec --only database --project demo-chrono-shift 'node tests/rtdb-emulator.test.js'
```

La última orden usa Java y un emulador local, no el proyecto Firebase real. `firebase.json` también permite desplegar solo las reglas con Firebase CLI una vez autorizado el proyecto correcto.

La dependencia PeerJS conserva su aviso MIT en `THIRD_PARTY_NOTICES.md`; ese aviso no cambia la licencia del código original del juego.
