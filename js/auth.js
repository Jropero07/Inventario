/* =========================================================
   Módulo de usuarios, roles y contraseñas
   Usuarios propios almacenados en Firebase RTDB: usuarios/
   Solicitudes de recuperación de clave: solicitudesClave/
   ========================================================= */
import { ref, get, set, update, push, remove, onValue } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js";

export const PERMISOS = {
  crear: "Crear registros (Guardar / Generar SKU)",
  editar: "Editar",
  clonar: "Copiar / Duplicar",
  eliminar: "Eliminar",
  movimientos: "Entradas y salidas de stock",
  traslado: "Traslado Express",
  qr: "Código QR",
  hojaVida: "Hoja de vida y notas",
  orden: "Orden de requerimiento",
  exportar: "Exportar (Excel, PDF, JSON)",
  importar: "Importar (CSV / Excel, JSON)"
};
export const ROLES = ["Administrador", "Control total", "Solo lector", "Personalizado"];

const SESSION_KEY = "invti_session";
const MIN_PASSWORD = 8;
const PBKDF2_ITERATIONS = 100000;

let db = null;
let currentUser = null;
let usuarios = {};
let onReadyCallback = null;
let editingUserId = "";

const $ = id => document.getElementById(id);

function clean(value, max = 120) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F-\u009F<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
function normUser(value) { return clean(value, 60).toLowerCase(); }

function toast(message, isError = false) {
  const t = $("toast");
  if (!t) return;
  t.textContent = message;
  t.style.background = isError ? "#b91c1c" : "#172033";
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- Hash de contraseñas (PBKDF2-SHA256) ---------- */
function bufToHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function randomSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return bufToHex(a); }
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return bufToHex(bits);
}
function passwordError(pass, confirm) {
  if (pass.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (pass !== confirm) return "Las contraseñas no coinciden.";
  return "";
}

/* ---------- Permisos ---------- */
export function permisosDeRol(rol, personalizados = {}) {
  const all = Object.fromEntries(Object.keys(PERMISOS).map(k => [k, true]));
  if (rol === "Administrador") return { ...all, usuarios: true };
  if (rol === "Control total") return { ...all, usuarios: false };
  if (rol === "Personalizado") return Object.fromEntries(Object.keys(PERMISOS).map(k => [k, personalizados?.[k] === true]));
  return {};
}
export function can(perm) {
  if (!currentUser) return false;
  return permisosDeRol(currentUser.rol, currentUser.permisos)[perm] === true;
}
export function getCurrentUser() { return currentUser; }

function applyPermissions() {
  document.querySelectorAll("[data-perm]").forEach(el => {
    el.classList.toggle("perm-hidden", !can(el.dataset.perm));
  });
  $("userMenuName").textContent = currentUser ? (currentUser.nombre || currentUser.usuario) : "";
  $("userMenuRole").textContent = currentUser ? currentUser.rol : "";
}

/* ---------- Sesión ---------- */
function saveSession(id, user) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, h: user.hash.slice(0, 16) })); } catch {}
}
function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }

function showScreen(name) {
  ["loginCard", "setupCard", "forgotCard", "forceChangeCard"].forEach(id => { $(id).hidden = id !== name; });
  $("authScreen").hidden = !name;
  document.body.classList.toggle("auth-locked", !!name);
  const focus = $(name)?.querySelector("input");
  if (focus) setTimeout(() => focus.focus(), 30);
}

function enterApp(id, user) {
  currentUser = { id, ...user };
  saveSession(id, user);
  showScreen("");
  applyPermissions();
  if (onReadyCallback) { const cb = onReadyCallback; onReadyCallback = null; cb(currentUser); }
  if (can("usuarios")) listenAdminData();
}

async function loadUsers() {
  const snap = await get(ref(db, "usuarios"));
  usuarios = snap.val() || {};
  return usuarios;
}
function findUserByName(usuario) {
  const key = normUser(usuario);
  return Object.entries(usuarios).find(([, u]) => normUser(u.usuario) === key) || null;
}
function activeAdmins(excludeId = "") {
  return Object.entries(usuarios).filter(([id, u]) => id !== excludeId && u.rol === "Administrador" && u.activo !== false).length;
}

/* ---------- Ingreso ---------- */
async function submitLogin(e) {
  e.preventDefault();
  const usuario = normUser($("loginUser").value);
  const pass = $("loginPassword").value;
  const btn = $("loginSubmitBtn");
  if (!usuario || !pass) { toast("Ingrese usuario y contraseña.", true); return; }
  btn.disabled = true;
  try {
    await loadUsers();
    const found = findUserByName(usuario);
    const valid = found && found[1].activo !== false && (await hashPassword(pass, found[1].salt)) === found[1].hash;
    if (!valid) { toast("Usuario o contraseña incorrectos, o usuario inactivo.", true); return; }
    $("loginPassword").value = "";
    const [id, user] = found;
    update(ref(db, `usuarios/${id}`), { ultimoIngreso: Date.now() }).catch(() => {});
    if (user.claveTemporal) {
      currentUser = { id, ...user };
      $("forceChangeInfo").textContent = `Hola ${user.nombre || user.usuario}, su clave es temporal. Defina una nueva contraseña para continuar.`;
      showScreen("forceChangeCard");
      return;
    }
    enterApp(id, user);
  } catch (error) {
    console.error("Error de ingreso:", error);
    toast("No se pudo validar el ingreso. Revise la conexión o las reglas de Firebase.", true);
  } finally { btn.disabled = false; }
}

async function submitSetup(e) {
  e.preventDefault();
  const usuario = normUser($("setupUser").value);
  const nombre = clean($("setupName").value);
  const pass = $("setupPassword").value, confirm = $("setupPassword2").value;
  if (!usuario || !nombre) { toast("Complete usuario y nombre.", true); return; }
  const err = passwordError(pass, confirm); if (err) { toast(err, true); return; }
  try {
    await loadUsers();
    if (Object.keys(usuarios).length) { toast("Ya existe un administrador. Inicie sesión.", true); showScreen("loginCard"); return; }
    const salt = randomSalt();
    const user = { usuario, nombre, rol: "Administrador", permisos: {}, salt, hash: await hashPassword(pass, salt), claveTemporal: false, activo: true, creado: Date.now(), actualizado: Date.now() };
    const r = push(ref(db, "usuarios"));
    await set(r, user);
    usuarios[r.key] = user;
    toast("Administrador inicial creado.");
    enterApp(r.key, user);
  } catch (error) { console.error(error); toast("No se pudo crear el administrador. Revise las reglas de Firebase.", true); }
}

async function submitForgot(e) {
  e.preventDefault();
  const usuario = normUser($("forgotUser").value);
  if (!usuario) { toast("Ingrese su usuario.", true); return; }
  try {
    await set(push(ref(db, "solicitudesClave")), { usuario, motivo: clean($("forgotReason").value, 200), fecha: Date.now() });
    $("forgotUser").value = ""; $("forgotReason").value = "";
    toast("Solicitud enviada. Un Administrador le asignará una clave temporal.");
    showScreen("loginCard");
  } catch (error) { console.error(error); toast("No se pudo enviar la solicitud.", true); }
}

async function changeOwnPassword(pass, confirm) {
  const err = passwordError(pass, confirm); if (err) throw new Error(err);
  const salt = randomSalt();
  const hash = await hashPassword(pass, salt);
  const changes = { salt, hash, claveTemporal: false, actualizado: Date.now() };
  await update(ref(db, `usuarios/${currentUser.id}`), changes);
  Object.assign(currentUser, changes);
  if (usuarios[currentUser.id]) Object.assign(usuarios[currentUser.id], changes);
  return changes;
}

async function submitForceChange(e) {
  e.preventDefault();
  try {
    await changeOwnPassword($("forcePassword").value, $("forcePassword2").value);
    $("forcePassword").value = ""; $("forcePassword2").value = "";
    toast("Contraseña actualizada.");
    const { id, ...user } = currentUser;
    enterApp(id, user);
  } catch (error) { toast(error.message || "No se pudo cambiar la contraseña.", true); }
}

async function submitChangePassword(e) {
  e.preventDefault();
  try {
    const actual = $("changeCurrent").value;
    if ((await hashPassword(actual, currentUser.salt)) !== currentUser.hash) throw new Error("La contraseña actual no es correcta.");
    const changes = await changeOwnPassword($("changeNew").value, $("changeNew2").value);
    saveSession(currentUser.id, { ...currentUser, ...changes });
    $("changePasswordForm").reset();
    closeModal("changePasswordModal");
    toast("Contraseña actualizada.");
  } catch (error) { toast(error.message || "No se pudo cambiar la contraseña.", true); }
}

function logout() { clearSession(); location.reload(); }

/* ---------- Modales ---------- */
function openModal(id) { $(id).hidden = false; $(id).setAttribute("aria-hidden", "false"); }
function closeModal(id) { $(id).hidden = true; $(id).setAttribute("aria-hidden", "true"); }

/* ---------- Gestión de usuarios (solo Administrador) ---------- */
let adminListening = false;
function listenAdminData() {
  if (adminListening) return;
  adminListening = true;
  onValue(ref(db, "usuarios"), snap => { usuarios = snap.val() || {}; renderUsers(); });
  onValue(ref(db, "solicitudesClave"), snap => renderRequests(snap.val() || {}));
}

function renderPermChecks() {
  const box = $("userPermChecks");
  box.replaceChildren();
  Object.entries(PERMISOS).forEach(([key, label]) => {
    const l = document.createElement("label"); l.className = "perm-check";
    const c = document.createElement("input"); c.type = "checkbox"; c.value = key; c.name = "userPerm";
    const s = document.createElement("span"); s.textContent = label;
    l.append(c, s); box.appendChild(l);
  });
}
function togglePermBox() { $("userPermField").hidden = $("userRole").value !== "Personalizado"; }

function resetUserForm() {
  editingUserId = "";
  $("userForm").reset();
  $("userFormTitle").textContent = "Nuevo usuario";
  $("userSaveBtn").querySelector("span").textContent = "Crear usuario";
  $("userPasswordHint").textContent = "";
  $("userUsername").disabled = false;
  $("userTemporal").checked = true;
  togglePermBox();
}

function editUser(id) {
  const u = usuarios[id]; if (!u) return;
  editingUserId = id;
  $("userFormTitle").textContent = `Editar usuario: ${u.usuario}`;
  $("userSaveBtn").querySelector("span").textContent = "Guardar cambios";
  $("userUsername").value = u.usuario; $("userUsername").disabled = true;
  $("userFullName").value = u.nombre || "";
  $("userRole").value = u.rol;
  $("userActive").checked = u.activo !== false;
  $("userTemporal").checked = !!u.claveTemporal;
  $("userPassword").value = ""; $("userPassword2").value = "";
  $("userPasswordHint").textContent = "Deje la contraseña vacía para conservar la actual.";
  document.querySelectorAll('input[name="userPerm"]').forEach(c => { c.checked = u.permisos?.[c.value] === true; });
  togglePermBox();
  $("userForm").scrollIntoView({ block: "nearest" });
}

function resetPasswordFor(id) {
  editUser(id);
  $("userTemporal").checked = true;
  $("userPassword").focus();
  toast("Asigne la nueva clave temporal y guarde los cambios.");
}

async function submitUserForm(e) {
  e.preventDefault();
  const usuario = normUser($("userUsername").value);
  const nombre = clean($("userFullName").value);
  const rol = ROLES.includes($("userRole").value) ? $("userRole").value : "Solo lector";
  const activo = $("userActive").checked;
  const claveTemporal = $("userTemporal").checked;
  const pass = $("userPassword").value, confirm = $("userPassword2").value;
  const permisos = {};
  if (rol === "Personalizado") document.querySelectorAll('input[name="userPerm"]').forEach(c => { permisos[c.value] = c.checked; });
  if (!usuario || !nombre) { toast("Complete usuario y nombre.", true); return; }
  if (!/^[a-z0-9._-]{3,60}$/.test(usuario)) { toast("El usuario solo admite letras, números, punto, guion y guion bajo (mínimo 3).", true); return; }
  try {
    if (!editingUserId) {
      if (findUserByName(usuario)) throw new Error("Ese nombre de usuario ya existe.");
      const err = passwordError(pass, confirm); if (err) throw new Error(err);
      const salt = randomSalt();
      await set(push(ref(db, "usuarios")), { usuario, nombre, rol, permisos, salt, hash: await hashPassword(pass, salt), claveTemporal, activo, creado: Date.now(), actualizado: Date.now() });
      toast(`Usuario ${usuario} creado.`);
    } else {
      const before = usuarios[editingUserId];
      const losesAdmin = before.rol === "Administrador" && (rol !== "Administrador" || !activo);
      if (losesAdmin && activeAdmins(editingUserId) === 0) throw new Error("Debe existir al menos un Administrador activo.");
      if (editingUserId === currentUser.id && !activo) throw new Error("No puede desactivar su propio usuario.");
      const changes = { nombre, rol, permisos, activo, claveTemporal, actualizado: Date.now() };
      if (pass || confirm) {
        const err = passwordError(pass, confirm); if (err) throw new Error(err);
        changes.salt = randomSalt();
        changes.hash = await hashPassword(pass, changes.salt);
      }
      await update(ref(db, `usuarios/${editingUserId}`), changes);
      if (changes.hash) await clearRequestsFor(before.usuario);
      toast(`Usuario ${before.usuario} actualizado.`);
    }
    resetUserForm();
  } catch (error) { toast(error.message || "No se pudo guardar el usuario.", true); }
}

async function deleteUser(id) {
  const u = usuarios[id]; if (!u) return;
  if (id === currentUser.id) { toast("No puede eliminar su propio usuario.", true); return; }
  if (u.rol === "Administrador" && activeAdmins(id) === 0) { toast("Debe existir al menos un Administrador activo.", true); return; }
  if (!confirm(`¿Eliminar el usuario ${u.usuario}?`)) return;
  try { await remove(ref(db, `usuarios/${id}`)); toast("Usuario eliminado."); }
  catch (error) { console.error(error); toast("No se pudo eliminar el usuario.", true); }
}

let pendingRequests = {};
async function clearRequestsFor(usuario) {
  const jobs = Object.entries(pendingRequests).filter(([, r]) => normUser(r.usuario) === normUser(usuario)).map(([id]) => remove(ref(db, `solicitudesClave/${id}`)));
  await Promise.allSettled(jobs);
}

function makeBtn(text, cls, handler) {
  const b = document.createElement("button"); b.type = "button"; b.className = `mini-btn ${cls}`;
  const s = document.createElement("span"); s.textContent = text; b.appendChild(s);
  b.addEventListener("click", handler); return b;
}
function td(text) { const c = document.createElement("td"); c.textContent = text; return c; }

function renderUsers() {
  const body = $("usersTableBody"); if (!body) return;
  body.replaceChildren();
  Object.entries(usuarios).sort((a, b) => String(a[1].usuario).localeCompare(String(b[1].usuario), "es")).forEach(([id, u]) => {
    const tr = document.createElement("tr");
    tr.append(td(u.usuario), td(u.nombre || "—"), td(u.rol), td(u.claveTemporal ? "Temporal" : "Fija"), td(u.activo === false ? "Inactivo" : "Activo"));
    const act = document.createElement("td"); act.className = "actions";
    act.append(makeBtn("Editar", "edit", () => editUser(id)), makeBtn("Restablecer clave", "transfer", () => resetPasswordFor(id)), makeBtn("Eliminar", "delete", () => deleteUser(id)));
    tr.appendChild(act); body.appendChild(tr);
  });
  $("usersCount").textContent = `${Object.keys(usuarios).length} usuarios`;
}

function renderRequests(data) {
  pendingRequests = data;
  const box = $("passwordRequests"); if (!box) return;
  box.replaceChildren();
  const entries = Object.entries(data).sort((a, b) => (b[1].fecha || 0) - (a[1].fecha || 0));
  $("userRequestsBadge").textContent = String(entries.length);
  $("userRequestsBadge").hidden = entries.length === 0;
  $("passwordRequestsWrap").hidden = entries.length === 0;
  entries.forEach(([rid, r]) => {
    const row = document.createElement("div"); row.className = "password-request";
    const info = document.createElement("span");
    info.textContent = `${r.usuario} · ${new Date(r.fecha || 0).toLocaleString("es-CO")}${r.motivo ? ` · ${r.motivo}` : ""}`;
    const found = findUserByName(r.usuario);
    const actions = document.createElement("div"); actions.className = "actions";
    if (found) actions.appendChild(makeBtn("Asignar clave temporal", "edit", () => resetPasswordFor(found[0])));
    actions.appendChild(makeBtn("Descartar", "delete", () => remove(ref(db, `solicitudesClave/${rid}`)).catch(() => {})));
    row.append(info, actions); box.appendChild(row);
  });
}

/* ---------- Inicialización ---------- */
export async function initAuth(database, onReady) {
  db = database;
  onReadyCallback = onReady;
  renderPermChecks();
  $("loginCard").addEventListener("submit", submitLogin);
  $("setupCard").addEventListener("submit", submitSetup);
  $("forgotCard").addEventListener("submit", submitForgot);
  $("forceChangeCard").addEventListener("submit", submitForceChange);
  $("forgotLink").addEventListener("click", () => showScreen("forgotCard"));
  $("forgotBackBtn").addEventListener("click", () => showScreen("loginCard"));
  $("forceLogoutBtn").addEventListener("click", logout);
  $("logoutBtn").addEventListener("click", logout);
  $("changePasswordBtn").addEventListener("click", () => openModal("changePasswordModal"));
  $("closeChangePasswordBtn").addEventListener("click", () => closeModal("changePasswordModal"));
  $("cancelChangePasswordBtn").addEventListener("click", () => closeModal("changePasswordModal"));
  $("changePasswordForm").addEventListener("submit", submitChangePassword);
  $("manageUsersBtn").addEventListener("click", () => { resetUserForm(); openModal("usersModal"); });
  $("closeUsersBtn").addEventListener("click", () => closeModal("usersModal"));
  $("userRole").addEventListener("change", togglePermBox);
  $("userForm").addEventListener("submit", submitUserForm);
  $("userResetBtn").addEventListener("click", resetUserForm);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("usersModal").hidden) closeModal("usersModal");
    if (!$("changePasswordModal").hidden) closeModal("changePasswordModal");
  });

  try {
    await loadUsers();
    if (!Object.keys(usuarios).length) { showScreen("setupCard"); return; }
    const session = readSession();
    const user = session && usuarios[session.id];
    if (user && user.activo !== false && !user.claveTemporal && String(user.hash || "").slice(0, 16) === session.h) {
      enterApp(session.id, user);
      return;
    }
    clearSession();
    showScreen("loginCard");
  } catch (error) {
    console.error("No se pudo leer usuarios:", error);
    showScreen("loginCard");
    toast("No se pudo leer la lista de usuarios. Revise las reglas de Firebase para la ruta usuarios/.", true);
  }
}
