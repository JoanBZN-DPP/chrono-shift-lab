# The Chrono Shift Lab

[Jugar](https://joanbzn-dpp.github.io/chrono-shift-lab/) · [Código público](https://github.com/JoanBZN-DPP/chrono-shift-lab)

Juego de puzles temporales con 30 niveles, clones, portales, cintas, puntuación por nivel, lobby/código, ranking y panel de administrador. Se conserva el botón **Cerrar paneles**.

## Estado de Firebase

**La conexión real está pendiente.** `firebase-config.js` contiene `null`: la práctica y el modo PeerJS funcionan, pero P2P no conserva las partidas al desconectarse el anfitrión. Publicar el sitio en GitHub Pages no crea por sí solo una base de datos.

El cliente de Firebase RTDB, la autenticación, el guardado de progreso y las reglas están preparados y tienen pruebas locales. No se ha verificado una conexión con un proyecto real.

## Activar la persistencia

1. En [Firebase Console](https://console.firebase.google.com/), crea un proyecto, registra una aplicación web y crea una **Realtime Database** en modo bloqueado. No se necesitan claves privadas en este repositorio.
2. En **Authentication**, activa los proveedores **Anonymous** y **Google**. Añade `joanbzn-dpp.github.io` a los dominios autorizados.
3. Copia la configuración pública de la aplicación web a `firebase-config.js`, sustituyendo `null` por el objeto `firebaseConfig`. Debe incluir `apiKey`, `authDomain`, `projectId`, `appId` y la `databaseURL` de RTDB.
4. Publica el contenido de `firebase.rules.json` en las reglas de Realtime Database. No abras la raíz con `read: true` o `write: true`.
5. Abre el juego, entra con Google y pulsa **Panel Admin**. Copia el UID que aparece y crea el dato `/admins/EL_UID: true` desde Firebase Console, nunca desde un cliente del juego. Recarga el juego. La contraseña local del panel queda como segundo bloqueo de ese navegador.
6. Crea una partida y comprueba desde otro equipo que aparece usando el mismo enlace y código. Para continuar como el mismo jugador, usa la misma cuenta Google.

Los invitados anónimos conservan su identidad solo en ese navegador. Vincular un invitado a una cuenta Google nueva para Firebase conserva su UID; si esa cuenta Google ya existe, se recupera su progreso existente y no se fusionan automáticamente los dos historiales.

## Datos y seguridad

`match/state` conserva partida, código, parámetros y tiempos. `players/{uid}` conserva puntuación y un snapshot JSON del nivel, movimientos, clones, posiciones, bloques, bucle y tiempo empleado. El guardado se agrupa durante la partida; los arrays vacíos se conservan dentro de JSON.

Solo un UID autorizado en `/admins` puede gestionar la partida. Cada jugador solo puede escribir su propio registro; los usuarios autenticados pueden leer el ranking. Las puntuaciones se calculan en el cliente: este juego no ofrece protección antifraude de competición.

## Pruebas

```sh
node tests/smoke.test.js
node tests/behavior.test.js
npx firebase-tools@13.35.1 emulators:exec --only database --project demo-chrono-shift 'node tests/rtdb-emulator.test.js'
```

La última orden usa Java y un emulador local, no un proyecto Firebase real. `firebase.json` también permite desplegar solo las reglas con Firebase CLI una vez autorizado el proyecto correcto.

La dependencia PeerJS conserva su aviso MIT en `THIRD_PARTY_NOTICES.md`; ese aviso no cambia la licencia del código original del juego.
