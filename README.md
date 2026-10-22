# Sistema de Gestión de Inventario TI · Colegio Americano de Barranquilla

Aplicación web para controlar los **activos tecnológicos** (equipos, cámaras, switches, etc.) y los
**consumibles** (cables, adaptadores, conectores…) del Departamento TIC: registro, entradas y salidas de
stock, traslados, alertas, mantenimientos preventivos, órdenes de requerimiento, auditoría y usuarios.

- **Tipo:** aplicación web de una sola página (SPA) en HTML, CSS y JavaScript **sin frameworks ni compilación**.
- **Datos:** Firebase Realtime Database (tiempo real).
- **Publicación:** GitHub Pages (`https://jropero07.github.io/Inventario/`).
- **Instalable** como app (PWA) en celular y computador.

> Documento pensado para que cualquier persona pueda continuar el desarrollo. Ver también
> [`SEGURIDAD_FIREBASE.md`](SEGURIDAD_FIREBASE.md) y [`CHANGELOG.md`](CHANGELOG.md).

---

## 1. Estructura del proyecto

```
index.html                 Estructura de toda la interfaz (pestañas, formularios, modales)
css/styles.css             Estilos (incluye modo oscuro y vista móvil al final del archivo)
js/app.js                  Lógica principal: inventario, movimientos, alertas, exportaciones, panel…
js/auth.js                 Usuarios propios, roles, contraseñas, bitácora de accesos, inactividad
js/theme.js                Modo claro / oscuro (se carga primero para evitar parpadeo)
sw.js                      Service worker (PWA): caché de la interfaz, red primero
manifest.webmanifest       Datos de instalación de la app (nombre, íconos, colores)
database.rules.json        Reglas de seguridad de Realtime Database (se pegan en la consola)
firestore.rules            Reglas de Firestore (solo si se habilita Firestore; hoy no se usa)
assets/                    Logos, íconos de la app y plantilla Word del formato de pedido
SEGURIDAD_FIREBASE.md      Guía de configuración de seguridad en Firebase
```

### Librerías externas (CDN, cargadas en `index.html`)

| Librería | Uso |
|---|---|
| Firebase JS SDK 11.4.0 (módulos ES desde gstatic) | Base de datos, autenticación anónima |
| SheetJS (xlsx 0.18.5) | Exportar e importar Excel |
| html2pdf.js 0.10.1 | Generar PDF desde HTML |
| JSZip 3.10.1 | Diligenciar la plantilla Word del formato de pedido |
| docx 8.2.2 | (Heredado; ya no se usa para la orden) |
| FileSaver 2.0.5 | Descargar archivos |
| html5-qrcode 2.3.8 | Escáner con cámara |
| qrcodejs 1.0.0 | Generar códigos QR |
| Font Awesome 6.7.2 (estilo *Solid*) | Íconos (`<i class="fa-solid fa-...">`) |

---

## 2. Puesta en marcha

### Requisitos
- Una cuenta con acceso al proyecto Firebase **inventario-app-dfead**.
- El repositorio de GitHub donde se publica la página.

### Ejecutar en local
Los módulos ES y la cámara exigen servidor HTTP (no abrir el archivo con doble clic):

```bash
cd carpeta-del-proyecto
python3 -m http.server 8080
# abrir http://localhost:8080
```

> La clave de Firebase está restringida por dominio. Si en local no conecta, agregue
> `http://localhost/*` a los referentes permitidos de la clave (ver sección 7).

### Publicar en GitHub Pages
1. Subir **todos** los archivos a la raíz del repositorio (incluidos `sw.js` y `manifest.webmanifest`).
2. Settings → Pages → rama principal / carpeta raíz.
3. Tras publicar, recargar la página. El service worker toma siempre la versión nueva cuando hay internet.

### Configuración de Firebase (una sola vez)
Detallada en `SEGURIDAD_FIREBASE.md`. Resumen:
1. **Authentication → Método de acceso → Anónimo:** habilitado.
2. **Dominios autorizados:** `jropero07.github.io`.
3. **Realtime Database → Reglas:** pegar `database.rules.json` y publicar.
4. **Google Cloud → Credenciales:** restringir la clave del navegador a `https://jropero07.github.io/*`.

La configuración del proyecto (`firebaseConfig`) está al inicio de `js/app.js`. Esa clave **no es secreta**
(Firebase la expone por diseño); la seguridad depende de las reglas y de la restricción de dominio.

### Primer uso
Si la base no tiene usuarios, la app muestra **"Crear Administrador"**. Ese primer usuario gestiona al resto.

---

## 3. Funcionalidades

| Módulo | Qué hace |
|---|---|
| **Inicio** | Indicadores (activos, consumibles, alertas críticas, mantenimientos), consumo de 6 meses, activos por estado y categoría, próximos mantenimientos y últimos movimientos. |
| **Activos** | Registro de equipos con SKU automático, estado, ubicación, responsable y especificaciones. |
| **Consumibles** | Registro con stock actual, stock mínimo y prioridad de alerta; analítica de consumo por artículo y espacio (con desplegable por espacio). |
| **Inventario General** | Búsqueda, filtros, escáner (abre la ficha si coincide), exportación PDF / Excel / CSV de solo las columnas útiles, carga masiva CSV/Excel. |
| **Alertas** | Pestañas Todas / Críticas / Preventivas (consumibles) y **Mantenimiento** (activos) con exportación. Orden de Requerimiento en el formato oficial GA-LO-CO01 (Word y PDF). |
| **Historial de Movimientos** | Kárdex con filtros (incluido usuario), detalle "antes → después" de cada edición y **reversión de salidas**. |
| **Papelera** | Lo eliminado se puede restaurar; solo el Administrador elimina definitivamente. |
| **Ficha "Ver"** | Toda la información del artículo, últimos movimientos y acciones (editar, QR, copiar, hoja de vida, mantenimiento). |
| **Hoja de vida** | Eventos de cada activo (creación, cambios, traslados, notas, mantenimientos). Solo se agregan, no se borran. |
| **Usuarios** | Roles, permisos personalizados, clave temporal o fija, recuperación de clave, bloqueo por intentos, bitácora de accesos. |
| **Otros** | Modo claro/oscuro (automático + botón), vista móvil en tarjetas, ordenar y paginar tablas, aviso de conexión, cierre por inactividad con aviso previo, texto en MAYÚSCULAS, PWA instalable. |

---

## 4. Reglas de negocio importantes

### Código / SKU
`ACT-[CATEGORÍA]-001` para activos y `CON-[CATEGORÍA]-001` para consumibles; el correlativo es
independiente por tipo y categoría (`nextAvailableSku` en `app.js`). Alias de categoría en `categoryPrefix`
(REDES→RED, AUDIO→AUD, CÓMPUTO→COMP…). No se permiten SKU ni seriales duplicados.

### Alertas de consumibles (`alertLevel`)
- **Crítico:** `stockActual <= stockMinimo`.
- **Preventivo:** solo si prioridad = Alta, `stockMinimo >= 3` y `stockActual` = mínimo + 2 o mínimo + 3.
- La Orden de Requerimiento toma los artículos seleccionados; si no hay selección, todos los visibles en el filtro.
  Cantidad sugerida = `mínimo − actual + 1`. **Cantidad Autorizada siempre en blanco.** "Uso" por defecto: PLANTEL.

### Movimientos de stock
- Entradas y salidas usan `runTransaction` (no se puede dejar stock negativo).
- **Salida repartida:** una salida puede dividirse en varios destinos; el stock se descuenta una vez y queda
  un movimiento por destino.
- **Reversión de salida:** devuelve unidades al stock, marca la salida (`cantidadRevertida`) y registra
  "Reversión de salida". La analítica descuenta lo revertido.

### Fechas de auditoría
`fechaCreacion` se fija al crear; `fechaUltimaModificacion` cambia **solo** con cambios reales
(edición, traslado, entrada/salida, mantenimiento), nunca por leer o refrescar.

### Mantenimiento preventivo (activos)
`proximoMantenimiento` y `ultimoMantenimiento` (AAAA-MM-DD). Se programan desde **Ver → Mantenimiento**
(atajos 1, 3, 6 y 12 meses o calendario). Alertan si están vencidos o a 15 días o menos.
El formulario de edición **conserva** estas fechas (solo cambian desde el modal de mantenimiento).

### Texto
Todo texto que escribe el usuario se guarda en MAYÚSCULAS (`upperText`), excepto el usuario de inicio de
sesión (minúsculas) y las contraseñas.

---

## 5. Modelo de datos (Realtime Database)

```
inventario/{id}          Artículos (activos y consumibles)
movimientos/{id}         Kárdex de operaciones
papelera/{id}            Artículos eliminados (misma clave que tenían en inventario)
hojaVida/{idArticulo}/{id}  Eventos de la hoja de vida (solo agregar)
usuarios/{id}            Usuarios de la aplicación
solicitudesClave/{id}    Solicitudes de "olvidé mi contraseña"
accesos/{id}             Bitácora de accesos (solo agregar)
```

**inventario** — `tipo` ("Activo" | "Consumible"), `codigo`, `nombre`, `categoria`, `marca`, `modelo`, `serial`,
`estado` (Disponible | Asignado | En mantenimiento | Baja), `espacio`, `responsable`, `fechaIngreso`,
`fechaAsignacion`, `unidad`, `stockActual`, `stockMinimo`, `prioridadAlerta` (Alta | Baja), `especificaciones`,
`proximoMantenimiento`, `ultimoMantenimiento`, `fechaCreacion`, `fechaUltimaModificacion`, `createdAt`, `updatedAt`.
La normalización y los valores por defecto están en `normalizeItem` (`app.js`).

**movimientos** — `fechaHora`, `tipo`, `codigo`, `serial`, `nombre`, `tipoAccion` (Registro | Entrada | Salida |
Edición | Eliminación | Restauración | Reversión de salida), `cantidad`, `espacioDestino`, `usuario`,
opcionales: `detalle` (cambios "antes → después"), `cantidadRevertida`, `refSalida`, `motivo`, `salidaHacia`.

**usuarios** — `usuario` (minúsculas), `nombre`, `rol`, `permisos`, `salt`, `hash` (PBKDF2-SHA256, 100 000
iteraciones), `claveTemporal`, `activo`, `bloqueado`, `bloqueadoHasta`, `intentosFallidos`, `ultimoIngreso`.

> Firestore aparece en el código como espejo opcional (sincronización silenciosa con tiempo límite).
> Hoy no está habilitado y **ninguna función depende de él**.

---

## 6. Usuarios, roles y permisos (`auth.js`)

| Rol | Alcance |
|---|---|
| **Administrador** | Todo, incluida la gestión de usuarios, vaciar papelera y eliminar definitivamente. |
| **Control total** | Todo excepto la gestión de usuarios. |
| **Solo lector** | Solo consultas. |
| **Personalizado** | Permisos marcados uno a uno. |

Claves de permiso (`PERMISOS`): `crear`, `editar`, `clonar`, `eliminar`, `movimientos`, `traslado`, `qr`,
`hojaVida`, `orden`, `exportar`, `importar` (+ `usuarios` solo para el Administrador).

- En HTML, un elemento con `data-perm="clave"` se oculta si el usuario no tiene ese permiso.
- En JS se usa `can("clave")` para mostrar botones y `allowed("clave")` / validaciones internas antes de escribir.
- Contraseña mínima: 4 caracteres (`MIN_PASSWORD`). 5 intentos fallidos bloquean la cuenta
  (si es el único Administrador, el bloqueo dura 15 minutos).
- Inactividad: aviso a los 9 minutos y cierre a los 10 (`INACTIVIDAD_MS`).

---

## 7. Seguridad: lo que hay y sus límites

- La app inicia una **sesión anónima de Firebase** y las reglas exigen `auth != null`: nadie puede leer ni
  escribir la base directamente con la URL. `movimientos`, `hojaVida` y `accesos` tienen validaciones y
  restricciones de solo agregar.
- Los **roles se controlan en el navegador**. Una persona con conocimientos técnicos que abra la app podría
  saltárselos. Para un control por rol en el servidor habría que migrar a cuentas reales de Firebase
  Authentication y validar el rol en las reglas.
- Siguiente refuerzo recomendado: **Firebase App Check** con reCAPTCHA.
- Cualquier ruta nueva en la base debe agregarse a `database.rules.json` (todo lo no declarado está bloqueado).

---

## 8. Cómo hacer cambios sin romper nada

1. **No reconstruir desde cero ni migrar a frameworks.** Mantener el diseño (sidebar azul, tablas, colores).
2. Las funciones clave están en `app.js`: `guardarItemFirebase`, `registrarMovimiento`,
   `registrarMovimientoStock`, `renderInventoryTable`, `renderGeneralInventoryTable`, `renderMovements`,
   `renderCriticals`, `renderAnalytics`, `renderDashboard`, `openViewModal`, `exportData`.
3. **Campo nuevo en artículos:** agregarlo en `normalizeItem`; si no viene del formulario de edición,
   conservarlo en `guardarItemFirebase` (igual que `proximoMantenimiento`); agregarlo a `AUDIT_FIELDS` si
   debe aparecer en el detalle de cambios y a `EXPORT_COLUMNS` si se exporta.
4. **Ruta nueva en la base:** declararla en `database.rules.json` y volver a publicar las reglas.
5. **Colores:** usar las variables CSS (`--bg`, `--card`, `--line`, `--text`, `--muted`, `--blue`…) para que
   funcione el modo oscuro. Si se usa un color fijo, agregar su versión en la sección "Modo oscuro" de `styles.css`.
6. **Íconos:** Font Awesome *Solid* (`fa-solid fa-nombre`).
7. **Al publicar una versión con cambios grandes**, subir el número de `CACHE` en `sw.js`
   (por ejemplo `invti-v45` → `invti-v46`) para limpiar la caché anterior.
8. Tras cambiar algo, probar: crear, editar, entrada/salida, traslado, exportar, la vista móvil y el modo oscuro.

---

## 9. Soporte

Desarrollado y mantenido por el Departamento TIC del Colegio Americano de Barranquilla.
Responsable inicial: Jesús Ropero.
