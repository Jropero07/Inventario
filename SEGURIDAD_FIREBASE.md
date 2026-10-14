# Protección de la base de datos (Firebase)

Firebase avisó que las reglas permitían que **cualquier persona con la dirección de la base de datos** la leyera o modificara.
Desde esta versión la aplicación inicia una sesión técnica anónima de Firebase antes de cargar, y las nuevas reglas
rechazan todo acceso que no venga de una sesión de Firebase.

> **v40:** las reglas incluyen la nueva ruta `hojaVida` (Hoja de vida en Realtime Database).
> Si ya publicaste las reglas antes, vuelve a pegar `database.rules.json` y publica.

## Pasos (en este orden)

1. **Publicar esta versión** en GitHub Pages (reemplazar `index.html`, `css/`, `js/` y `assets/`).
2. **Activar el inicio de sesión anónimo**
   Consola de Firebase → proyecto *Inventario app* → **Authentication** → *Comenzar* (si aparece) →
   pestaña **Sign-in method / Método de acceso** → **Anónimo** → *Habilitar* → *Guardar*.
3. **Revisar dominios autorizados**
   Authentication → **Settings / Configuración** → *Dominios autorizados* → confirmar que esté `jropero07.github.io`
   (agregarlo si no está).
4. **Reemplazar las reglas de Realtime Database**
   Realtime Database → pestaña **Reglas** → borrar todo → pegar el contenido de `database.rules.json` → **Publicar**.
5. **Reemplazar las reglas de Firestore**
   Firestore Database → pestaña **Reglas** → pegar el contenido de `firestore.rules` → **Publicar**.
6. Abrir la aplicación, iniciar sesión y probar: crear, entrada/salida, traslado y Gestión de usuarios.

> Si la app muestra "Active el inicio de sesión Anónimo…", falta el paso 2.

## Qué protege y qué no

- **Protege:** bots y personas que intenten leer, modificar o borrar la base de datos directamente con su URL,
  sin abrir la aplicación. También impide borrar de golpe todo el historial de movimientos y deja la
  bitácora de accesos como solo-agregar (no se puede editar ni borrar lo registrado).
- **No protege por completo:** alguien con conocimientos técnicos que abra la aplicación podría usar esa sesión
  técnica desde la consola del navegador. Para un control total por rol en el servidor, el siguiente paso es
  migrar los usuarios a cuentas reales de Firebase Authentication (correo y contraseña) y validar el rol en las reglas.
