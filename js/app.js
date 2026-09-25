import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue, remove, update, runTransaction } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js";
import { getFirestore, collection, doc, setDoc, addDoc, getDocs, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB-FX1wyTkycQ-21QRDf5VWy5p9N__ZNl8",
  authDomain: "inventario-app-dfead.firebaseapp.com",
  databaseURL: "https://inventario-app-dfead-default-rtdb.firebaseio.com",
  projectId: "inventario-app-dfead",
  storageBucket: "inventario-app-dfead.firebasestorage.app",
  messagingSenderId: "1012268791157",
  appId: "1:1012268791157:web:e2be525efa0cc13c318f3c"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const firestore = getFirestore(app);
const inventarioRef = ref(db, "inventario");
const movimientosRef = ref(db, "movimientos");

const $ = id => document.getElementById(id);
let inventario = [];
let movimientos = [];
let scanner = null;
let scannerRunning = false;
let assetEditingId = "";
let consumableEditingId = "";
let orderCounter = 1;
let currentOrderFolio = "";
let pendingMovement = null;
let qrItem = null;
let alertFilter = "all";
const selectedAlertIds = new Set();
let orderQuantities = new Map();
let transferItem = null;
let pendingDeleteId = null;
let editModalContext = null;
let editModalFormKind = "";

const LIMITS = { codigo:80, nombre:140, categoria:80, marca:80, modelo:100, serial:100, espacio:120, responsable:120, unidad:40, especificaciones:1000 };

function sanitizeText(value, max=160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/[<>`]/g, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:\s*text\/html/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function safeInt(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function fmtDateTime(ts) { try { return new Date(ts).toLocaleString("es-CO"); } catch { return ""; } }
function showToast(message, isError=false) {
  const t=$("toast"); t.textContent=sanitizeText(message,180); t.style.background=isError?"#b91c1c":"#172033";
  t.classList.add("show"); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>t.classList.remove("show"),2800);
}
function setSync(text,state="") { $("syncStatus").textContent=text; $("syncDot").className="sync-dot "+state; }
function makeEl(tag,text="",className="") { const el=document.createElement(tag); if(className) el.className=className; el.textContent=sanitizeText(text,500); return el; }

function normalizeItem(raw) {
  const item = {
    idFirebase: raw.idFirebase || "",
    tipo: raw.tipo === "Consumible" ? "Consumible" : "Activo",
    codigo: sanitizeText(raw.codigo, LIMITS.codigo),
    nombre: sanitizeText(raw.nombre, LIMITS.nombre),
    categoria: sanitizeText(raw.categoria, LIMITS.categoria),
    marca: sanitizeText(raw.marca, LIMITS.marca),
    modelo: sanitizeText(raw.modelo, LIMITS.modelo),
    serial: sanitizeText(raw.serial, LIMITS.serial),
    fechaIngreso: sanitizeText(raw.fechaIngreso, 20),
    fechaAsignacion: sanitizeText(raw.fechaAsignacion || raw.fechaEgreso, 20),
    estado: ["Disponible","Asignado","En mantenimiento","Baja"].includes(raw.estado) ? raw.estado : "Disponible",
    espacio: sanitizeText(raw.espacio, LIMITS.espacio),
    responsable: sanitizeText(raw.responsable, LIMITS.responsable),
    unidad: sanitizeText(raw.unidad, LIMITS.unidad),
    stockActual: Number.isSafeInteger(raw.stockActual) && raw.stockActual >= 0 ? raw.stockActual : 0,
    stockMinimo: Number.isSafeInteger(raw.stockMinimo) && raw.stockMinimo >= 0 ? raw.stockMinimo : 0,
    prioridadAlerta: raw.prioridadAlerta === "Baja" ? "Baja" : "Alta",
    especificaciones: sanitizeText(raw.especificaciones, LIMITS.especificaciones),
    // Auditoría independiente: creación y última modificación.
    fechaCreacion: Number.isFinite(raw.fechaCreacion) ? raw.fechaCreacion : (Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()),
    fechaUltimaModificacion: Number.isFinite(raw.fechaUltimaModificacion)
      ? raw.fechaUltimaModificacion
      : ((Number.isFinite(raw.updatedAt) && raw.updatedAt > (Number.isFinite(raw.fechaCreacion) ? raw.fechaCreacion : (Number.isFinite(raw.createdAt) ? raw.createdAt : 0))) ? raw.updatedAt : 0),
    // Campos antiguos conservados por compatibilidad.
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : (Number.isFinite(raw.fechaCreacion) ? raw.fechaCreacion : Date.now()),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : (Number.isFinite(raw.fechaUltimaModificacion) && raw.fechaUltimaModificacion > 0 ? raw.fechaUltimaModificacion : (Number.isFinite(raw.fechaCreacion) ? raw.fechaCreacion : Date.now()))
  };
  return item;
}

function isFormCompletelyBlank(formId) {
  const form = $(formId);
  if (!form) return false;
  // Los select con valores por defecto (p. ej. Estado = Disponible) no cuentan
  // como contenido introducido por el usuario para esta alerta específica.
  return [...form.querySelectorAll("input:not([type=hidden]), textarea")]
    .every(field => String(field.value ?? "").trim() === "");
}

function requireField(id, required) {
  const field = $(id);
  if (field) field.required = required;
}

function buildItemFromForm(formKind, prefix="") {
  const field=(id)=>$(prefix+id);
  if(formKind==="Consumible") {
    const stock=safeInt(field("cStock").value), minimo=safeInt(field("cMinimo").value);
    const codigo=sanitizeText(field("cCodigo").value,LIMITS.codigo);
    const nombre=sanitizeText(field("cNombre").value,LIMITS.nombre);
    const categoria=sanitizeText(field("cCategoria").value,LIMITS.categoria);
    const marca=sanitizeText(field("cMarca").value,LIMITS.marca);
    const modelo=sanitizeText(field("cModelo").value,LIMITS.modelo);
    const serial=sanitizeText(field("cSerial").value,LIMITS.serial);
    const unidad=sanitizeText(field("cUnidad").value,LIMITS.unidad);
    const fechaIngreso=sanitizeText(field("cFecha").value,20);
    const espacio=sanitizeText(field("cEspacio").value,LIMITS.espacio);
    const prioridadAlerta=field("cPrioridadAlerta").value === "Baja" ? "Baja" : "Alta";

    if(!codigo || !nombre || !categoria || !espacio || stock===null || minimo===null){
      throw new Error("Todos los campos son obligatorios para guardar un consumible.");
    }
    if(stock < 0 || minimo < 0) throw new Error("El stock actual y el stock mínimo no pueden ser negativos.");

    return normalizeItem({
      tipo:"Consumible",codigo,nombre,categoria,marca,modelo,serial,unidad,fechaIngreso,espacio,
      stockActual:stock,stockMinimo:minimo,prioridadAlerta,estado:"Disponible",createdAt:Date.now(),updatedAt:Date.now()
    });
  }

  const codigo=sanitizeText(field("codigo").value,LIMITS.codigo);
  const nombre=sanitizeText(field("nombre").value,LIMITS.nombre);
  const categoria=sanitizeText(field("categoria").value,LIMITS.categoria);
  const marca=sanitizeText(field("marca").value,LIMITS.marca);
  const modelo=sanitizeText(field("modelo").value,LIMITS.modelo);
  const serial=sanitizeText(field("serial").value,LIMITS.serial);
  const fechaIngreso=sanitizeText(field("fechaIngreso").value,20);
  const estado=["Disponible","Asignado","En mantenimiento","Baja"].includes(field("estado").value)?field("estado").value:"Disponible";
  const espacio=sanitizeText(field("espacio").value,LIMITS.espacio);
  const fechaAsignacion=estado==="Asignado" ? sanitizeText(field("fechaAsignacion").value,20) : "";
  const responsable=estado==="Asignado" ? sanitizeText(field("responsable").value,LIMITS.responsable) : "";

  if(!codigo || !nombre || !categoria || !marca || !modelo || !estado || !espacio){
    throw new Error("Complete todos los campos obligatorios del activo. El número de serie es opcional.");
  }
  if(estado==="Asignado" && !responsable) throw new Error("Indique la persona responsable del activo.");
  if(estado==="Asignado" && !fechaAsignacion) throw new Error("Indique la fecha de asignación del activo.");

  return normalizeItem({
    tipo:"Activo",codigo,nombre,categoria,marca,modelo,serial,
    fechaIngreso,fechaAsignacion,estado,espacio,responsable,
    stockActual:0,stockMinimo:0,createdAt:Date.now(),updatedAt:Date.now()
  });
}

function normalizedKey(value) {
  return sanitizeText(value, 160).trim().toUpperCase();
}

function validateUniqueCode(code, editingId="") {
  const key=normalizedKey(code);
  if(!key) return true;
  return !inventario.some(item=>item.idFirebase!==editingId && normalizedKey(item.codigo)===key);
}

function findDuplicateSerial(serial, editingId="") {
  const key=normalizedKey(serial);
  if(!key) return null;
  return inventario.find(item=>item.idFirebase!==editingId && normalizedKey(item.serial)===key) || null;
}

let serialValidationTimer = null;
let consumableSerialValidationTimer = null;

async function validateSerialInputField(fieldId, editingId="") {
  const field=$(fieldId);
  if(!field) return true;
  const serial=sanitizeText(field.value,LIMITS.serial);
  field.setCustomValidity("");
  if(!serial) { field.title=""; return true; }
  const duplicate=findDuplicateSerial(serial,editingId);
  if(duplicate){
    field.setCustomValidity(`El número de serie ya existe en "${duplicate.nombre || "otro registro"}".`);
    field.title=`Serial duplicado: ${duplicate.nombre || "otro registro"}`;
    return false;
  }
  field.title="";
  return true;
}

async function validateSerialField(editingId="") {
  return validateSerialInputField("serial",editingId);
}

async function validateConsumableSerialField(editingId="") {
  return validateSerialInputField("cSerial",editingId);
}

function validateCurrentCode(code, editingId="") {
  const key=normalizedKey(code);
  if(!key) return true;
  if(!validateUniqueCode(code,editingId)){
    throw new Error("El Código / SKU ya existe. Utilice un código único.");
  }
  return true;
}

function withTimeout(promise, ms=5000) {
  return Promise.race([promise, new Promise((_,reject)=>setTimeout(()=>reject(new Error("Tiempo de espera agotado en Firestore.")),ms))]);
}

async function registrarMovimiento(item, tipoAccion, cantidad=0, espacioDestino="") {
  const qty=safeInt(cantidad);
  const movimiento={
    fechaHora:Date.now(),
    tipo:sanitizeText(item.tipo,20),
    codigo:sanitizeText(item.codigo,LIMITS.codigo),
    serial:sanitizeText(item.serial,LIMITS.serial),
    nombre:sanitizeText(item.nombre,LIMITS.nombre),
    tipoAccion:sanitizeText(tipoAccion,40),
    cantidad:qty===null?0:Math.max(0,qty),
    espacioDestino:sanitizeText(espacioDestino,LIMITS.espacio)
  };
  const movementRef=push(movimientosRef);
  // Espejo de auditoría en Firestore: no bloquea ni afecta el resultado de RTDB.
  withTimeout(setDoc(doc(firestore,"movimientos",movementRef.key),{...movimiento,idEvento:movementRef.key}))
    .catch(error=>console.warn("Firestore no registró el movimiento; RTDB sigue siendo la fuente principal.",error));
  try {
    await set(movementRef, movimiento);
    return true;
  } catch(error) {
    console.error("No se pudo guardar el movimiento en Realtime Database.", error);
    return false;
  }
}

function toFirebasePayload(item) {
  const clean = normalizeItem(item);
  delete clean.idFirebase;
  return clean;
}

async function syncFirestoreAsset(item,id) {
  try {
    const payload={...toFirebasePayload(item), idFirebase:id, firestoreUpdatedAt:serverTimestamp()};
    await withTimeout(setDoc(doc(firestore,"inventario",id),payload,{merge:true}));
  } catch(error) {
    console.warn("Firestore no disponible para la auditoría; la operación principal se mantiene en RTDB.",error);
  }
}

async function addLifecycleEvent(item,eventType,details="") {
  if(item.tipo!=="Activo") return;
  try {
    await withTimeout(addDoc(collection(firestore,"inventario",item.idFirebase,"hojaVida"),{fechaHora:serverTimestamp(),tipo:sanitizeText(eventType,80),detalle:sanitizeText(details,1000),ubicacion:item.espacio||"",responsable:item.responsable||"",estado:item.estado||""}));
  } catch(error) { console.warn("No se pudo registrar evento en Hoja de Vida.",error); }
}

function itemComparable(item) {
  const x=normalizeItem(item);
  delete x.idFirebase; delete x.createdAt; delete x.updatedAt; delete x.fechaUltimaModificacion; delete x.fechaCreacion;
  return JSON.stringify(x);
}
function hasRealItemChange(before, after) { return itemComparable(before) !== itemComparable(after); }

async function guardarItemFirebase(item, existingId="") {
  const clean=toFirebasePayload(item);
  const id=String(existingId || "").trim();

  if(id) {
    const before=inventario.find(x=>x.idFirebase===id);
    if(!before) throw new Error("No se encontró el registro original para editarlo. Vuelva a cargar la página e inténtelo de nuevo.");

    const now=Date.now();
    const created=Number.isFinite(before.fechaCreacion) ? before.fechaCreacion : (Number.isFinite(before.createdAt) ? before.createdAt : now);
    const changed=hasRealItemChange(before,clean);
    clean.fechaCreacion=created;
    clean.fechaUltimaModificacion=changed ? now : (Number(before.fechaUltimaModificacion)||0);
    clean.createdAt=created;
    clean.updatedAt=changed ? now : (Number(before.updatedAt)||created);
    if(!changed) return;
    await update(ref(db,`inventario/${id}`), clean);
    await registrarMovimiento(
      { ...clean, idFirebase:id },
      "Edición",
      Math.abs(clean.tipo==="Consumible" ? (safeInt(clean.stockActual) ?? 0) - (safeInt(before.stockActual) ?? 0) : 0),
      clean.espacio
    );
    syncFirestoreAsset({...clean,idFirebase:id},id);
    addLifecycleEvent({...clean,idFirebase:id},"Edición","Cambio real de datos del activo");
    return;
  }

  const nuevo=push(inventarioRef);
  const now=Date.now();
  clean.fechaCreacion=now;
  clean.fechaUltimaModificacion=0;
  clean.createdAt=now;
  clean.updatedAt=now;
  await set(nuevo,clean);
  await registrarMovimiento({ ...clean, idFirebase:nuevo.key },"Registro",clean.tipo==="Consumible"?clean.stockActual:1,clean.espacio);
  syncFirestoreAsset({...clean,idFirebase:nuevo.key},nuevo.key);
  if(clean.tipo==="Activo") addLifecycleEvent({...clean,idFirebase:nuevo.key},"Registro de creación","Creación inicial del activo");
}
window.guardarItemFirebase = guardarItemFirebase;

async function eliminarItemFirebase(idFirebase) {
  const item=inventario.find(x=>x.idFirebase===idFirebase);
  if(!item) return;
  await remove(ref(db,`inventario/${idFirebase}`));
  await registrarMovimiento(item,"Eliminación",item.tipo==="Consumible"?item.stockActual:1);
}
window.eliminarItemFirebase=eliminarItemFirebase;

function openMovementModal(idFirebase, delta) {
  const id=String(idFirebase || "").trim();
  const item=inventario.find(entry=>entry.idFirebase===id);
  if(!item || item.tipo!=="Consumible") return;

  pendingMovement={id,delta};
  const isEntry=delta>0;
  $("movementTitle").textContent=isEntry ? "Registrar entrada" : "Registrar salida";
  $("saveMovementBtn").innerHTML=isEntry
    ? '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>Registrar entrada</span>'
    : '<i class="fa-solid fa-minus" aria-hidden="true"></i><span>Registrar salida</span>';
  $("movementItemName").textContent=item.nombre || "Artículo";
  $("movementItemCode").textContent=`Código: ${item.codigo || "—"}`;
  $("movementCurrentStock").textContent=`Stock actual: ${item.stockActual}`;
  $("movementQuantity").value="1";
  $("movementQuantity").max=isEntry ? "" : String(item.stockActual);
  $("movementDestination").value=item.espacio || "";
  $("movementModal").hidden=false;
  $("movementModal").setAttribute("aria-hidden","false");
  setTimeout(()=>$("movementQuantity").focus(),50);
}

function closeMovementModal(){
  pendingMovement=null;
  $("movementModal").hidden=true;
  $("movementModal").setAttribute("aria-hidden","true");
}

async function registrarMovimientoStock(idFirebase, delta, cantidad, destination) {
  const item=inventario.find(entry=>entry.idFirebase===idFirebase);
  if(!item || item.tipo!=="Consumible") throw new Error("El consumible ya no está disponible.");

  const id=idFirebase;
  const itemRef=ref(db,`inventario/${id}`);
  let committedSnapshot=null;
  const result=await runTransaction(itemRef,current=>{
    if(current===null) return;
    const currentStock=safeInt(current.stockActual);
    if(currentStock===null) return;
    const next=currentStock + (delta * cantidad);
    if(!Number.isSafeInteger(next) || next<0) return;
    return {
      ...current,
      stockActual:next,
      fechaUltimaModificacion:Date.now(),
      updatedAt:Date.now()
    };
  });

  if(!result.committed){
    const latest=safeInt(result.snapshot?.val()?.stockActual);
    if(delta<0 && latest!==null && latest<cantidad){
      throw new Error(`No hay suficiente stock para retirar ${cantidad}. Stock disponible: ${latest}.`);
    }
    throw new Error("No se pudo actualizar el stock. Intente nuevamente.");
  }

  committedSnapshot=result.snapshot.val();
  const finalStock=safeInt(committedSnapshot?.stockActual);
  if(finalStock===null) throw new Error("Firebase devolvió un stock no válido.");

  const movementSaved=await registrarMovimiento(
    { ...item, stockActual:finalStock },
    delta>0 ? "Entrada" : "Salida",
    cantidad,
    destination
  );
  syncFirestoreAsset({...item,stockActual:finalStock,idFirebase:id},id);
  addLifecycleEvent({...item,stockActual:finalStock,idFirebase:id},"Ajuste de stock",`${delta>0?"Entrada":"Salida"} de ${cantidad} unidad${cantidad===1?"":"es"}`);
  return { finalStock, movementSaved };
}

async function submitMovement(event){
  event.preventDefault();
  if(!pendingMovement) return;

  const quantity=safeInt($("movementQuantity").value);
  const destination=sanitizeText($("movementDestination").value,LIMITS.espacio);
  const {id,delta}=pendingMovement;
  const item=inventario.find(entry=>entry.idFirebase===id);

  if(quantity===null || quantity<1){showToast("La cantidad debe ser un número entero mayor que 0.",true);return;}
  if(!destination){showToast("Indique el espacio o lugar de destino.",true);return;}
  if(!item){showToast("El consumible ya no está disponible. Recargue la página.",true);closeMovementModal();return;}
  if(delta<0 && quantity>item.stockActual){showToast(`No hay suficiente stock. Disponible: ${item.stockActual}.`,true);return;}

  try{
    const result=await registrarMovimientoStock(id,delta,quantity,destination);
    closeMovementModal();
    const actionText=delta>0 ? `Entrada de ${quantity} unidad${quantity===1?"":"es"} registrada.` : `Salida de ${quantity} unidad${quantity===1?"":"es"} registrada.`;
    showToast(result.movementSaved ? actionText : `${actionText} La auditoría de movimientos no pudo sincronizarse.` , !result.movementSaved);
  }catch(error){
    console.error("Error al registrar movimiento:",error);
    showToast(error.message || "Firebase no permitió actualizar el stock. Revise las reglas de la base de datos.",true);
  }
}

function addCell(tr,text,cls="") { tr.appendChild(makeEl("td",text,cls)); }
function button(icon, text, cls, handler, title="") {
  const b=document.createElement("button");
  b.type="button";
  b.className="mini-btn "+cls;
  if(icon){
    const i=document.createElement("i");
    i.className=`fa-solid ${icon}`;
    i.setAttribute("aria-hidden","true");
    b.appendChild(i);
  }
  if(text){
    const span=document.createElement("span");
    span.textContent=text;
    b.appendChild(span);
  }
  b.title=title||text||"Acción";
  b.setAttribute("aria-label",title||text||"Acción");
  b.addEventListener("click",handler);
  return b;
}

function renderSummary() {
  const assets=inventario.filter(i=>i.tipo==="Activo");
  $("summaryTotal").textContent=String(assets.length);
  $("summaryAvailable").textContent=String(assets.filter(i=>i.estado==="Disponible").length);
  $("summaryAssigned").textContent=String(assets.filter(i=>i.estado==="Asignado").length);
  $("summaryMaintenance").textContent=String(assets.filter(i=>i.estado==="En mantenimiento").length);
}

async function ensureFirestoreMirror(items){
  try {
    const snap=await getDocs(collection(firestore,"inventario"));
    const existing=new Set(snap.docs.map(d=>d.id));
    const jobs=items.filter(item=>item.idFirebase && !existing.has(item.idFirebase)).map(item=>syncFirestoreAsset(item,item.idFirebase));
    await Promise.allSettled(jobs);
  } catch(error){ console.warn("No se pudo completar el espejo inicial de Firestore.",error); }
}

function renderizarInventario(items) {
  inventario=items.map(normalizeItem);
  ensureFirestoreMirror(inventario);
  setSync("Sincronizado en tiempo real","ok");
  renderSummary();
  renderInventoryTable(); renderGeneralInventoryTable(); renderFilters(); renderCriticals(); renderAnalytics();
}
window.renderizarInventario=renderizarInventario;

function displayLocation(item) {
  if(item.tipo === "Consumible" && item.stockActual <= 0) return "Sin stock";
  return item.espacio || "Sin ubicación";
}

function filteredInventory() {
  const q=sanitizeText($("generalSearch").value,120).toLowerCase();
  const type=$("filterType").value;
  const status=$("filterStatus").value;
  const cat=$("filterCategory").value;
  const space=$("filterSpace").value;
  return inventario.filter(i=>{
    const location=displayLocation(i);
    const hay=!q || [i.codigo,i.nombre,i.serial,i.marca,i.modelo,i.categoria,i.responsable,location].join(" ").toLowerCase().includes(q);
    return hay && (!type||i.tipo===type) && (!status||i.estado===status) && (!cat||i.categoria===cat) && (!space||location===space);
  });
}

function requestDeleteItem(item) {
  const current=inventario.find(x=>x.idFirebase===item.idFirebase);
  if(!current) return;
  pendingDeleteId=current.idFirebase;
  $("deleteConfirmMessage").textContent=`¿Está seguro de que desea eliminar el artículo ${current.nombre}?`;
  $("deleteConfirmModal").hidden=false;
  $("deleteConfirmModal").setAttribute("aria-hidden","false");
}

function closeDeleteConfirm() {
  pendingDeleteId=null;
  $("deleteConfirmModal").hidden=true;
  $("deleteConfirmModal").setAttribute("aria-hidden","true");
}

async function confirmDeleteItem() {
  if(!pendingDeleteId) return;
  const id=pendingDeleteId;
  const item=inventario.find(x=>x.idFirebase===id);
  if(!item){ closeDeleteConfirm(); showToast("El artículo ya no existe.",true); return; }
  try {
    await eliminarItemFirebase(id);
    selectedAlertIds.delete(id);
    orderQuantities.delete(id);
    closeDeleteConfirm();
    showToast("Artículo eliminado correctamente.");
  } catch(error) {
    console.error("Error al eliminar:",error);
    showToast("No se pudo eliminar el artículo.",true);
  }
}

function renderTableRow(item) {
  const tr=document.createElement("tr");
  addCell(tr,item.tipo); addCell(tr,item.codigo);
  const nameTd=document.createElement("td");
  nameTd.append(makeEl("div",item.nombre),movementBadge(item));
  tr.appendChild(nameTd);
  addCell(tr,item.categoria); addCell(tr,item.estado);
  addCell(tr,displayLocation(item)); addCell(tr,item.responsable);
  const stockTd=document.createElement("td");
  if(item.tipo==="Consumible") {
    const wrap=document.createElement("div"); wrap.className="stock-control";
    wrap.append(button("fa-minus","","minus",()=>openMovementModal(item.idFirebase,-1),"Registrar salida"));
    wrap.append(makeEl("strong",String(item.stockActual)));
    wrap.append(button("fa-plus","","plus",()=>openMovementModal(item.idFirebase,1),"Registrar entrada"));
    stockTd.appendChild(wrap);
  } else stockTd.textContent="—";
  tr.appendChild(stockTd);
  const act=document.createElement("td"); act.className="actions";
  act.append(button("fa-pen-to-square","Editar","edit",()=>editItem(item)));
  act.append(button("fa-copy","Copiar","copy",()=>duplicateItem(item),"Duplicar registro"));
  act.append(button("fa-qrcode","QR","qr",()=>openQrModal(item),"Generar código QR"));
  if(item.tipo==="Activo") act.append(button("fa-file-medical","Hoja de vida","lifecycle",()=>openLifecycleModal(item),"Abrir hoja de vida"));
  act.append(button("fa-location-arrow","Traslado","transfer",()=>openTransferModal(item),"Traslado Express"));
  act.append(button("fa-trash","Eliminar","delete",()=>requestDeleteItem(item)));
  tr.appendChild(act);
  return tr;
}

function renderInventoryTable() {
  const body=$("inventoryTableBody"); body.replaceChildren();
  const data=inventario.filter(i=>i.tipo==="Activo").sort(sortInventory);
  for(const item of data) body.appendChild(renderTableRow(item));
  $("inventoryCount").textContent=`${data.length} registros`;
}

function renderGeneralInventoryTable() {
  const body=$("generalInventoryTableBody"); body.replaceChildren();
  const data=filteredInventory().sort(sortInventory);
  for(const item of data) body.appendChild(renderTableRow(item));
  $("generalInventoryCount").textContent=`Mostrando ${data.length} de ${inventario.length} artículos`;
  if($("generalMatchCount")) $("generalMatchCount").textContent=`${data.length} coincidencias`;
}

function sortInventory(a,b){
  const typeOrder={Activo:0,Consumible:1};
  return (typeOrder[a.tipo]-typeOrder[b.tipo])
    || a.categoria.localeCompare(b.categoria,"es",{sensitivity:"base"})
    || a.nombre.localeCompare(b.nombre,"es",{sensitivity:"base"})
    || a.codigo.localeCompare(b.codigo,"es",{sensitivity:"base"});
}

function renderFilters() {
  const select=$("filterCategory"), spaceSelect=$("filterSpace");
  const current=select.value, currentSpace=spaceSelect.value;
  const cats=[...new Set(inventario.map(i=>i.categoria).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
  const spaces=[...new Set(inventario.map(displayLocation).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
  select.replaceChildren(new Option("Todas las categorías",""));
  spaceSelect.replaceChildren(new Option("Todos los espacios físicos",""));
  cats.forEach(c=>select.appendChild(new Option(c,c)));
  spaces.forEach(c=>spaceSelect.appendChild(new Option(c,c)));
  select.value=cats.includes(current)?current:"";
  spaceSelect.value=spaces.includes(currentSpace)?currentSpace:"";
}

function alertLevel(item) {
  if(item.tipo!=="Consumible") return "";
  const stock=safeInt(item.stockActual);
  const minimo=safeInt(item.stockMinimo);
  if(stock===null || minimo===null) return "";
  if(stock<=minimo) return "critical";
  const prioridad=item.prioridadAlerta === "Baja" ? "Baja" : "Alta";
  if(prioridad === "Alta" && minimo>=3 && (stock===minimo+2 || stock===minimo+3)) return "preventive";
  return "";
}

function filteredAlerts() {
  const alerts=inventario.filter(item=>alertLevel(item));
  if(alertFilter==="critical") return alerts.filter(item=>alertLevel(item)==="critical");
  if(alertFilter==="preventive") return alerts.filter(item=>alertLevel(item)==="preventive");
  return alerts;
}

function renderCriticals() {
  const allAlerts=inventario.filter(i=>alertLevel(i));
  const alertIds=new Set(allAlerts.map(i=>i.idFirebase));
  [...selectedAlertIds].forEach(id=>{ if(!alertIds.has(id)) selectedAlertIds.delete(id); });
  const critical=allAlerts.filter(i=>alertLevel(i)==="critical");
  const preventive=allAlerts.filter(i=>alertLevel(i)==="preventive");
  $("criticalBadge").textContent=String(critical.length);
  document.querySelectorAll(".alert-filter").forEach(btn=>btn.classList.toggle("active",btn.dataset.alertFilter===alertFilter));
  const box=$("criticalList"); box.replaceChildren();
  const visible=filteredAlerts().sort((a,b)=>{
    const levelOrder={critical:0,preventive:1};
    return (levelOrder[alertLevel(a)]-levelOrder[alertLevel(b)]) || sortInventory(a,b);
  });
  if(!visible.length){
    box.appendChild(makeEl("p",alertFilter==="critical"?"No hay consumibles en nivel crítico.":alertFilter==="preventive"?"No hay consumibles en nivel preventivo.":"No hay consumibles en alerta.","muted"));
    return;
  }
  visible.forEach(item=>{
    const level=alertLevel(item);
    const card=document.createElement("article");
    card.className=`critical-item ${level}`;
    const badge=makeEl("span",level==="critical"?"CRÍTICO":"PREVENTIVO","alert-status-badge");
    const head=document.createElement("div"); head.className="critical-card-head";
    const selection=document.createElement("label"); selection.className="alert-selection";
    const checkbox=document.createElement("input"); checkbox.type="checkbox"; checkbox.checked=selectedAlertIds.has(item.idFirebase); checkbox.setAttribute("aria-label",`Seleccionar ${item.nombre} para la Orden de Requerimiento`);
    checkbox.addEventListener("change",()=>{
      if(checkbox.checked) selectedAlertIds.add(item.idFirebase); else selectedAlertIds.delete(item.idFirebase);
      if(!$('orderModal').hidden) buildOrderDocument();
    });
    selection.append(checkbox,makeEl("span","Solicitar"));
    const title=makeEl("h3",item.nombre); head.append(title,badge,selection);
    card.append(head,makeEl("p",`Código: ${item.codigo}`),makeEl("p",`Stock actual: ${item.stockActual}`,"critical-number"),makeEl("p",`Stock mínimo: ${item.stockMinimo}`),makeEl("p",`Prioridad: ${item.prioridadAlerta || "Alta"}`));
    const action=document.createElement("div"); action.className="critical-card-actions";
    const entry=button("fa-plus","Entrada de Stock","plus",()=>openMovementModal(item.idFirebase,1),"Registrar entrada de stock");
    action.appendChild(entry); card.appendChild(action);
    box.appendChild(card);
  });
}

function activityTimestamp(item) {
  const creation=Number(item.fechaCreacion) || Number(item.createdAt) || 0;
  const modification=Number(item.fechaUltimaModificacion) || 0;
  return { creation, modification: modification > creation ? modification : 0 };
}

function formatElapsedActivity(prefix, ts) {
  if(!ts) return makeEl("span", "Sin fecha", "activity-badge none");
  const ageMs=Math.max(0,Date.now()-ts);
  const minutes=Math.floor(ageMs/60000);
  const hours=Math.floor(ageMs/3600000);
  const days=Math.floor(ageMs/86400000);
  if(minutes < 1) return makeEl("span", `${prefix} justo ahora`, "activity-badge today");
  if(minutes < 60) return makeEl("span", `${prefix} hace ${minutes} min`, "activity-badge recent");
  if(hours < 24) return makeEl("span", `${prefix} hace ${hours} ${hours===1?"hora":"horas"}`, "activity-badge recent");
  if(days === 1) return makeEl("span", `${prefix} ayer`, "activity-badge recent");
  return makeEl("span", `${prefix} hace ${days} ${days===1?"día":"días"}`, "activity-badge recent");
}

function formatActivityBadge(item) {
  const {creation,modification}=activityTimestamp(item);
  return formatElapsedActivity(modification ? "Modificado" : "Creado", modification || creation);
}

function movementBadge(item) {
  return formatActivityBadge(item);
}

function renderAnalytics() {
  const consumables=inventario.filter(i=>i.tipo==="Consumible");
  const exits=movimientos.filter(m=>m.tipo==="Consumible" && /^Salida/.test(String(m.tipoAccion||"")));
  const itemTotals=new Map(), spaceTotals=new Map(), pairTotals=new Map();
  const ninetyDaysAgo=Date.now()-90*86400000;
  const recentItemTotals=new Map();
  for(const m of exits){
    const qty=Math.max(0,Number(m.cantidad)||0); if(!qty) continue;
    const itemName=sanitizeText(m.nombre,140)||"Sin nombre";
    const space=sanitizeText(m.espacioDestino,120)||"Sin destino registrado";
    itemTotals.set(itemName,(itemTotals.get(itemName)||0)+qty);
    spaceTotals.set(space,(spaceTotals.get(space)||0)+qty);
    const pairKey=`${space}||${itemName}`;
    const pair=pairTotals.get(pairKey)||{space,item:itemName,qty:0}; pair.qty+=qty; pairTotals.set(pairKey,pair);
    if((Number(m.fechaHora)||0)>=ninetyDaysAgo) recentItemTotals.set(itemName,(recentItemTotals.get(itemName)||0)+qty);
  }
  const topItem=[...itemTotals.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"es"))[0];
  const topSpace=[...spaceTotals.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"es"))[0];
  const topPair=[...pairTotals.values()].sort((a,b)=>b.qty-a.qty||a.item.localeCompare(b.item,"es"))[0];
  $("analyticsTopItem").textContent=topItem?topItem[0]:"—";
  $("analyticsTopItemDetail").textContent=topItem?`${topItem[1]} unidades salidas`:"Sin salidas registradas";
  $("analyticsTopSpace").textContent=topSpace?topSpace[0]:"—";
  $("analyticsTopSpaceDetail").textContent=topSpace?`${topSpace[1]} unidades demandadas`:"Sin demanda registrada";
  $("analyticsTopPair").textContent=topPair?`${topPair.space} → ${topPair.item}`:"—";
  $("analyticsTopPairDetail").textContent=topPair?`${topPair.qty} unidades`:"Sin relación registrada";

  const rotation=[...consumables].map(item=>({item,total:recentItemTotals.get(item.nombre)||0})).sort((a,b)=>b.total-a.total||a.item.nombre.localeCompare(b.item.nombre,"es"));
  const high=rotation.filter(x=>x.total>=5).length, medium=rotation.filter(x=>x.total>=2&&x.total<5).length, low=rotation.filter(x=>x.total<2).length;
  $("analyticsRotationSummary").textContent=rotation.length?`${high} alta · ${medium} media · ${low} baja`:"—";
  $("analyticsRotationDetail").textContent="Clasificación según salidas acumuladas en los últimos 90 días (≥5 alta, 2–4 media, 0–1 baja).";

  const topSpaces=[...spaceTotals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
  const list=$("analyticsTopSpacesList"); list.replaceChildren();
  if(!topSpaces.length) list.appendChild(makeEl("li","Sin salidas registradas.","muted"));
  else topSpaces.forEach(([space,qty])=>{const li=document.createElement("li");li.append(makeEl("strong",space),makeEl("span",`${qty} unidades`));list.appendChild(li);});

  const rotList=$("analyticsRotationList"); rotList.replaceChildren();
  if(!rotation.length) rotList.appendChild(makeEl("span","Sin consumibles registrados.","muted"));
  rotation.slice(0,8).forEach(({item,total})=>{
    const level=total>=5?"Alta":total>=2?"Media":"Baja";
    const row=document.createElement("div"); row.className="rotation-row";
    row.append(makeEl("span",item.nombre),makeEl("strong",`${level} · ${total} salidas`)); rotList.appendChild(row);
  });
}

function movementActionCategory(m) {
  const action=String(m.tipoAccion||"");
  if(/^Entrada/.test(action)) return "Entrada";
  if(/^Salida/.test(action)) return "Salida";
  return action;
}

function filteredMovements() {
  const name=sanitizeText($("movementSearchName").value,120).toLowerCase();
  const sku=sanitizeText($("movementSearchSku").value,120).toLowerCase();
  const serial=sanitizeText($("movementSearchSerial").value,120).toLowerCase();
  const from=$("movementDateFrom").value;
  const to=$("movementDateTo").value;
  const type=$("movementType").value;
  const action=$("movementAction").value;
  const destination=sanitizeText($("movementSearchDestination").value,120).toLowerCase();
  const fromTs=from ? new Date(`${from}T00:00:00`).getTime() : null;
  const toTs=to ? new Date(`${to}T23:59:59.999`).getTime() : null;
  return movimientos.filter(m=>{
    const ts=Number(m.fechaHora)||0;
    const hayName=!name || String(m.nombre||"").toLowerCase().includes(name);
    const haySku=!sku || String(m.codigo||"").toLowerCase().includes(sku);
    const haySerial=!serial || String(m.serial||"").toLowerCase().includes(serial);
    const hayDate=(fromTs===null || ts>=fromTs) && (toTs===null || ts<=toTs);
    const hayType=!type || String(m.tipo||"")===type;
    const hayAction=!action || movementActionCategory(m)===action;
    const hayDestination=!destination || String(m.espacioDestino||"").toLowerCase().includes(destination);
    return hayName&&haySku&&haySerial&&hayDate&&hayType&&hayAction&&hayDestination;
  });
}

function renderMovements() {
  const body=$("movementTableBody");body.replaceChildren();
  const data=filteredMovements().sort((a,b)=>(b.fechaHora||0)-(a.fechaHora||0));
  data.forEach(m=>{const tr=document.createElement("tr");addCell(tr,fmtDateTime(m.fechaHora));addCell(tr,m.tipo||"—");addCell(tr,m.codigo);addCell(tr,m.serial||"—");addCell(tr,m.nombre);addCell(tr,m.tipoAccion);addCell(tr,String(m.cantidad));addCell(tr,m.espacioDestino||"—");body.appendChild(tr)});
  $("movementCount").textContent=`${data.length} movimientos`;
}

function normalizeDateInputValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;
  const numeric = Number(raw);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function setModalField(form, prefix, originalId, value) {
  const field = form.querySelector(`[id="${prefix}${originalId}"]`);
  if (!field) return;
  field.value = value ?? "";
}

function cloneFormForEdit(item) {
  const sourceId=item.tipo==="Consumible" ? "consumableForm" : "assetForm";
  const prefix="modal-";
  const source=$(sourceId);
  const form=source.cloneNode(true);
  form.id=`${prefix}${item.tipo==="Consumible" ? "consumable-form" : "asset-form"}`;
  form.dataset.editPrefix=prefix;
  form.dataset.editType=item.tipo;
  form.classList.add("edit-modal-form");
  form.removeAttribute("novalidate");

  // El modal es un formulario independiente: todos sus controles reciben IDs propios.
  form.querySelectorAll("[id]").forEach(el=>{el.id=prefix+el.id;});
  form.querySelectorAll("label[for]").forEach(label=>{label.htmlFor=prefix+label.htmlFor;});

  const set=(id,value)=>setModalField(form,prefix,id,value);
  const hiddenId=item.tipo==="Consumible" ? "cEditingId" : "editingId";
  set(hiddenId,item.idFirebase);

  if(item.tipo==="Consumible") {
    set("cCodigo",item.codigo);
    set("cNombre",item.nombre);
    set("cCategoria",item.categoria);
    set("cMarca",item.marca);
    set("cModelo",item.modelo);
    set("cSerial",item.serial);
    set("cUnidad",item.unidad);
    set("cFecha",normalizeDateInputValue(item.fechaIngreso));
    set("cEspacio",item.espacio);
    set("cStock",String(item.stockActual ?? 0));
    set("cMinimo",String(item.stockMinimo ?? 0));
    set("cPrioridadAlerta",item.prioridadAlerta || "Alta");

    const save=form.querySelector(`[id="${prefix}saveConsumableBtn"]`);
    if(save) save.textContent="Guardar cambios";
    const clear=form.querySelector(`[id="${prefix}clearConsumableBtn"]`);
    if(clear) clear.textContent="Cancelar";
    const scan=form.querySelector(`[id="${prefix}scanConsumableSerialBtn"]`);
    if(scan) scan.addEventListener("click",()=>startScanner(prefix+"cSerial",()=>validateSerialInputField(prefix+"cSerial",item.idFirebase)));
    form.addEventListener("submit",event=>submitEditModal(event,item,prefix));
    if(clear) clear.addEventListener("click",()=>closeEditModal(true));
    return {form,prefix};
  }

  set("codigo",item.codigo);
  set("nombre",item.nombre);
  set("categoria",item.categoria);
  set("marca",item.marca);
  set("modelo",item.modelo);
  set("serial",item.serial);
  set("fechaIngreso",normalizeDateInputValue(item.fechaIngreso));
  set("fechaAsignacion",normalizeDateInputValue(item.fechaAsignacion));
  set("estado",item.estado || "Disponible");
  set("espacio",item.espacio);
  set("responsable",item.responsable);

  // La visibilidad/required también se resuelve dentro del formulario clonado.
  const state=form.querySelector(`[id="${prefix}estado"]`);
  const responsibleField=form.querySelector(`[id="${prefix}responsableField"]`);
  const assignmentField=form.querySelector(`[id="${prefix}assignmentDateField"]`);
  const responsible=form.querySelector(`[id="${prefix}responsable"]`);
  const assignmentDate=form.querySelector(`[id="${prefix}fechaAsignacion"]`);
  const syncAssignmentFields=()=>{
    if(!state || !responsibleField || !assignmentField || !responsible || !assignmentDate) return;
    const assigned=state.value==="Asignado";
    responsibleField.classList.toggle("hidden",!assigned);
    assignmentField.classList.toggle("hidden",!assigned);
    responsible.required=assigned;
    assignmentDate.required=assigned;
    if(assigned && !assignmentDate.value) assignmentDate.value=new Date().toISOString().slice(0,10);
    if(!assigned) assignmentDate.value="";
  };
  syncAssignmentFields();

  const save=form.querySelector(`[id="${prefix}saveItemBtn"]`);
  if(save) save.innerHTML='<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>Guardar cambios</span>';
  const clear=form.querySelector(`[id="${prefix}cancelEditBtn"]`);
  if(clear) clear.innerHTML='<i class="fa-solid fa-xmark" aria-hidden="true"></i><span>Cancelar</span>';
  const scan=form.querySelector(`[id="${prefix}scanBtn"]`);
  if(scan) scan.addEventListener("click",()=>startScanner(prefix+"codigo"));
  if(state) state.addEventListener("change",syncAssignmentFields);
  form.addEventListener("submit",event=>submitEditModal(event,item,prefix));
  if(clear) clear.addEventListener("click",()=>closeEditModal(true));
  return {form,prefix};
}

function toggleLocationFieldsFor(prefix="") {
  const state=$(prefix+"estado");
  const responsibleField=$(prefix+"responsableField");
  const assignmentField=$(prefix+"assignmentDateField");
  const responsible=$(prefix+"responsable");
  const assignmentDate=$(prefix+"fechaAsignacion");
  if(!state || !responsibleField || !assignmentField || !responsible || !assignmentDate) return;
  const assigned=state.value==="Asignado";
  responsibleField.classList.toggle("hidden",!assigned);
  assignmentField.classList.toggle("hidden",!assigned);
  responsible.required=assigned;
  assignmentDate.required=assigned;
  if(assigned && !assignmentDate.value) assignmentDate.value=new Date().toISOString().slice(0,10);
  if(!assigned) assignmentDate.value="";
}

async function submitEditModal(event,item,prefix) {
  event.preventDefault();
  const form=event.currentTarget;
  if(isFormCompletelyBlank(form.id)){showToast("Todos los campos están vacíos",true);return;}
  if(!form.checkValidity()){form.reportValidity();return;}
  const id=item.idFirebase;
  try {
    const kind=item.tipo;
    const built=buildItemFromForm(kind,prefix);
    validateCurrentCode(built.codigo,id);
    const serialField=kind==="Consumible" ? prefix+"cSerial" : prefix+"serial";
    if(built.serial && !await validateSerialInputField(serialField,id)) throw new Error($(serialField).validationMessage);
    await guardarItemFirebase(built,id);
    finishEditModalAfterSave();
    showToast("Cambios guardados correctamente.");
  } catch(error) {
    showToast(error.message||"No se pudo guardar.",true);
  }
}

function openEditModal(item) {
  if(!item || !item.idFirebase) return;
  if(!$('editModal').hidden) closeEditModal(false);
  editModalContext={
    scrollY:window.scrollY,
    activeTab:document.querySelector('.panel.active')?.id || (item.tipo==='Consumible'?'consumibles':'activos')
  };
  const {form}=cloneFormForEdit(item);
  editModalFormKind=item.tipo;
  const body=$('editModalBody');
  body.replaceChildren(form);
  $('editModalTitle').textContent=`Editar ${item.tipo.toLowerCase()}`;
  $('editModal').hidden=false;
  $('editModal').setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>{
    const first=form.querySelector('input:not([type=hidden]), select, textarea');
    if(first) first.focus({preventScroll:true});
  });
}

function closeEditModal(restore=true) {
  if($('editModal').hidden) return;
  $('editModalBody').replaceChildren();
  $('editModal').hidden=true;
  $('editModal').setAttribute('aria-hidden','true');
  editModalFormKind='';
  if(restore && editModalContext){
    const y=editModalContext.scrollY;
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:y,left:0,behavior:'auto'})));
  }
  editModalContext=null;
}

function finishEditModalAfterSave() {
  if($('editModal').hidden) return;
  closeEditModal(true);
}

function editItem(item) {
  openEditModal(item);
}

function clearAssetForm(){
  $("assetForm").reset();
  $("editingId").value="";
  assetEditingId="";
  $("saveItemBtn").textContent="Guardar activo";
  toggleLocationFields();
}
function toggleLocationFields(){
  const assigned=$("estado").value==="Asignado";
  $("responsableField").classList.toggle("hidden",!assigned);
  $("assignmentDateField").classList.toggle("hidden",!assigned);
  $("responsable").required=assigned;
  $("fechaAsignacion").required=assigned;
  if(assigned && !$("fechaAsignacion").value) $("fechaAsignacion").value=new Date().toISOString().slice(0,10);
  if(!assigned) $("fechaAsignacion").value="";
}

let cloneItemContext=null;
let cloneValidationTimer=null;

async function firestoreInventorySnapshot() {
  try {
    const snap=await withTimeout(getDocs(collection(firestore,"inventario")),3000);
    return snap.docs.map(d=>({idFirebase:d.id,...(d.data()||{})}));
  } catch(error) {
    console.warn("Firestore no disponible para validación avanzada; se usará el estado local.", error);
    return [];
  }
}

async function nextAvailableSkuAsync(tipo,categoria) {
  const prefix=`${tipo==="Consumible"?"CON":"ACT"}-${categoryPrefix(categoria,"GEN")}`;
  const local=inventario.map(i=>i.codigo);
  const remote=(await firestoreInventorySnapshot()).map(i=>i.codigo);
  const used=new Set([...local,...remote].map(normalizedKey).filter(Boolean));
  let n=1;
  while(used.has(`${prefix}-${String(n).padStart(3,"0")}`)) n++;
  return `${prefix}-${String(n).padStart(3,"0")}`;
}

async function validateCloneUniqueness() {
  const code=sanitizeText($("cloneCodigo").value,LIMITS.codigo);
  const serial=sanitizeText($("cloneSerial").value,LIMITS.serial);
  const status=$("cloneSkuStatus"), serialStatus=$("cloneSerialStatus");
  let duplicateCode= !validateUniqueCode(code,"");
  let duplicateSerial= !!findDuplicateSerial(serial,"");
  const remote=await firestoreInventorySnapshot();
  if(code) duplicateCode ||= remote.some(i=>normalizedKey(i.codigo)===normalizedKey(code));
  if(serial) duplicateSerial ||= remote.some(i=>normalizedKey(i.serial)===normalizedKey(serial));
  $("cloneCodigo").setCustomValidity(duplicateCode?"El Código / SKU ya existe.":"");
  $("cloneSerial").setCustomValidity(duplicateSerial?"El número de serie ya existe.":"");
  status.textContent=code?(duplicateCode?"SKU duplicado":"SKU disponible"):"";
  status.className=`clone-validation ${duplicateCode?"invalid":"valid"}`;
  serialStatus.textContent=serial?(duplicateSerial?"Serial duplicado":"Serial disponible"):"";
  serialStatus.className=`clone-validation ${duplicateSerial?"invalid":"valid"}`;
  return !duplicateCode && !duplicateSerial;
}

async function openCloneModal(item) {
  cloneItemContext=item;
  const isConsumable=item.tipo==="Consumible";
  const localSuggestedSku=nextAvailableSku(item.tipo,item.categoria);
  $("cloneModalTitle").textContent=`Clonar ${item.tipo.toLowerCase()}`;
  $("cloneTipo").value=item.tipo;
  $("cloneCodigo").value=localSuggestedSku;
  $("cloneNombre").value=item.nombre||"";
  $("cloneCategoria").value=item.categoria||"";
  $("cloneMarca").value=item.marca||"";
  $("cloneModelo").value=item.modelo||"";
  $("cloneSerial").value="";
  $("cloneEspacio").value=item.espacio||"";
  $("cloneEspecificaciones").value=item.especificaciones||"";
  $("cloneMinimo").value=isConsumable?String(item.stockMinimo??0):"";
  $("cloneStock").value=isConsumable?"0":"";
  $("cloneUnidad").value=isConsumable?item.unidad||"":"";
  $("clonePrioridad").value=item.prioridadAlerta||"Alta";
  $("cloneEstado").value=isConsumable?"Disponible":"Disponible";
  $("cloneResponsible").value="";
  $("cloneFecha").value=normalizeDateInputValue(item.fechaIngreso)||new Date().toISOString().slice(0,10);
  $("cloneConsumableFields").classList.toggle("hidden",!isConsumable);
  $("cloneAssetFields").classList.toggle("hidden",isConsumable);
  $("cloneSkuStatus").textContent="SKU sugerido"; $("cloneSkuStatus").className="clone-validation valid";
  $("cloneSerialStatus").textContent="";
  $("cloneModal").hidden=false; $("cloneModal").setAttribute("aria-hidden","false");
  setTimeout(()=>$("cloneCodigo").focus(),50);
  // El modal abre inmediatamente. La consulta remota solo refina la sugerencia si el usuario aún no la cambió.
  const contextAtOpen=item;
  nextAvailableSkuAsync(item.tipo,item.categoria).then(remoteSku=>{
    if(cloneItemContext===contextAtOpen && $("cloneCodigo").value===localSuggestedSku){
      $("cloneCodigo").value=remoteSku;
      $("cloneSkuStatus").textContent="SKU sugerido";
    }
  }).catch(error=>console.warn("No se pudo consultar el correlativo remoto; se conserva la sugerencia local.",error));
}

function closeCloneModal(){
  cloneItemContext=null;
  $("cloneModal").hidden=true; $("cloneModal").setAttribute("aria-hidden","true");
}

async function submitClone(event){
  event.preventDefault();
  if(!cloneItemContext) return;
  const form=event.currentTarget;
  if(!form.checkValidity()){form.reportValidity();return;}
  try {
    if(!(await validateCloneUniqueness())) { showToast("El SKU o el número de serie ya existe. Corrija los datos antes de guardar.",true); return; }
    const isConsumable=cloneItemContext.tipo==="Consumible";
    const raw={
      tipo:cloneItemContext.tipo, codigo:sanitizeText($("cloneCodigo").value,LIMITS.codigo), nombre:sanitizeText($("cloneNombre").value,LIMITS.nombre),
      categoria:sanitizeText($("cloneCategoria").value,LIMITS.categoria), marca:sanitizeText($("cloneMarca").value,LIMITS.marca), modelo:sanitizeText($("cloneModelo").value,LIMITS.modelo),
      serial:"", fechaIngreso:normalizeDateInputValue($("cloneFecha").value), espacio:sanitizeText($("cloneEspacio").value,LIMITS.espacio),
      especificaciones:sanitizeText($("cloneEspecificaciones").value,LIMITS.especificaciones), unidad:isConsumable?sanitizeText($("cloneUnidad").value,LIMITS.unidad):"",
      stockActual:isConsumable?(safeInt($("cloneStock").value)??0):0, stockMinimo:isConsumable?(safeInt($("cloneMinimo").value)??0):0,
      prioridadAlerta:isConsumable&&$("clonePrioridad").value==="Baja"?"Baja":"Alta", estado:"Disponible", responsable:""
    };
    if(!raw.codigo || !raw.nombre || !raw.categoria || !raw.espacio) throw new Error("Complete los campos obligatorios de la clonación.");
    const clean=normalizeItem(raw);
    const newRef=push(inventarioRef); const now=Date.now(); clean.fechaCreacion=now; clean.fechaUltimaModificacion=0; clean.createdAt=now; clean.updatedAt=now;
    await set(newRef,toFirebasePayload(clean));
    await registrarMovimiento({...clean,idFirebase:newRef.key},"Registro",isConsumable?clean.stockActual:1,clean.espacio);
    syncFirestoreAsset(clean,newRef.key);
    if(clean.tipo==="Activo") addLifecycleEvent({...clean,idFirebase:newRef.key},"Registro de clonación","Creación mediante clonación");
    closeCloneModal(); showToast("Artículo clonado correctamente.");
  } catch(error){ console.error(error); showToast(error.message||"No se pudo clonar el artículo.",true); }
}

function duplicateItem(item) { openCloneModal(inventario.find(x=>x.idFirebase===item.idFirebase)||item); }

function nextAvailableSku(tipo, categoria){
  const typePrefix=tipo==="Consumible"?"CON":"ACT";
  const catPrefix=categoryPrefix(categoria,"GEN");
  const prefix=`${typePrefix}-${catPrefix}`;
  const used=new Set(inventario.map(i=>normalizedKey(i.codigo)).filter(Boolean));
  let n=1;
  while(used.has(`${prefix}-${String(n).padStart(3,"0")}`)) n++;
  return `${prefix}-${String(n).padStart(3,"0")}`;
}

function categoryPrefix(value,fallback="GEN"){
  const cat=sanitizeText(value, LIMITS.categoria).toUpperCase();
  const aliases={
    CCTV:"CCTV", REDES:"RED", RED:"RED", AUDIO:"AUD", AUDIOVISUAL:"AUD",
    COMPUTO:"COMP", CÓMPUTO:"COMP", CARGADORES:"CARG", CARGADOR:"CARG",
    JACKS:"JACK", JACK:"JACK", CABLES:"CAB", CABLE:"CAB", CONECTORES:"CON",
    ADAPTADORES:"ADAP", ADAPTADOR:"ADAP", ACCESORIOS:"ACC"
  };
  return aliases[cat] || cat.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^A-Z0-9]/g,"").slice(0,8) || fallback;
}

function generateSku(){
  const category=sanitizeText($("categoria").value,LIMITS.categoria);
  if(!category){showToast("Indique la categoría antes de generar el SKU.",true); $("categoria").focus(); return;}
  $("codigo").value=nextAvailableSku("Activo",category);
}

function generateConsumableSku(){
  const category=sanitizeText($("cCategoria").value,LIMITS.categoria);
  if(!category){showToast("Indique la categoría antes de generar el SKU.",true); $("cCategoria").focus(); return;}
  $("cCodigo").value=nextAvailableSku("Consumible",category);
}

function beep() {
  try {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.12);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.13);
    oscillator.addEventListener("ended", () => {
      audioContext.close().catch((error) => console.warn("No se pudo cerrar AudioContext:", error));
    }, { once: true });
  } catch (error) {
    console.warn("No fue posible reproducir el beep:", error);
  }
}

async function startScanner(targetId="codigo", afterScan=null){
  if(!window.isSecureContext){
    showToast("El escáner necesita HTTPS o localhost para usar la cámara.",true);
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia){
    showToast("Este navegador no permite acceso a la cámara.",true);
    return;
  }
  if(!globalThis.Html5Qrcode){
    showToast("No se cargó el módulo del escáner. Recargue la página e inténtelo de nuevo.",true);
    return;
  }

  await stopScanner();
  $("scannerTitle").textContent = targetId === "generalSearch" ? "Escanear para buscar" : "Escanear código";
  $("scannerModal").hidden=false;
  $("scannerModal").setAttribute("aria-hidden","false");
  await new Promise(r=>setTimeout(r,100));

  try {
    const cameras=await globalThis.Html5Qrcode.getCameras();
    if(!cameras?.length) throw new DOMException("No camera found","NotFoundError");

    scanner=new globalThis.Html5Qrcode("reader",{verbose:false});
    const rear=cameras.find(c=>/back|rear|environment|trasera|posterior/i.test(c.label));
    const cameraId=(rear || cameras[0]).id;
    const config={fps:10,qrbox:{width:260,height:180},aspectRatio:1.7778,rememberLastUsedCamera:true};

    const onScan=async text=>{
      if(!scannerRunning) return;
      const clean=sanitizeText(text,LIMITS.codigo);
      const target=$(targetId);
      if(target) target.value=clean;
      beep();
      if(typeof afterScan === "function") afterScan(clean);
      await stopScanner();
      showToast(targetId === "generalSearch" ? "Código detectado. Filtro actualizado." : "Código detectado.");
    };

    await scanner.start(cameraId,config,onScan,()=>{});
    scannerRunning=true;
  } catch(error){
    const name=error?.name || "";
    const message=String(error?.message || error || "");
    await stopScanner();
    let text="No se pudo abrir la cámara.";
    if(name==="NotAllowedError" || name==="PermissionDeniedError" || /permission|not allowed|denied/i.test(message)) text="Permiso de cámara bloqueado. En Chrome: candado del sitio → Cámara → Permitir y recargue la página.";
    else if(name==="NotFoundError") text="No se encontró una cámara disponible en este dispositivo.";
    else if(name==="NotReadableError") text="La cámara está ocupada por otra aplicación. Cierre otras apps que la estén usando e inténtelo nuevamente.";
    else if(name==="SecurityError") text="El navegador bloqueó la cámara por seguridad. Use HTTPS.";
    else if(name==="OverconstrainedError") text="La cámara seleccionada no admite la configuración solicitada. Intente nuevamente.";
    showToast(text,true);
    console.error("Error del escáner:",error);
  }
}

async function stopScanner() {
  try {
    if(scanner && scannerRunning) await scanner.stop();
  } catch(e) {
    console.warn("No se pudo detener el escáner:",e);
  } finally {
    scannerRunning=false;
    try { if(scanner) await scanner.clear(); } catch(e) { console.warn("No se pudo limpiar el escáner:",e); }
    scanner=null;
    $("scannerModal").hidden=true;
    $("scannerModal").setAttribute("aria-hidden","true");
  }
}

function openTransferModal(item){
  transferItem=item;
  $("transferItemName").textContent=item.nombre || "Artículo";
  $("transferItemLocation").textContent=`Ubicación actual: ${displayLocation(item)}`;
  $("transferDestination").value=item.espacio || "";
  $("transferModal").hidden=false;
  $("transferModal").setAttribute("aria-hidden","false");
  setTimeout(()=>$("transferDestination").focus(),50);
}

function closeTransferModal(){
  transferItem=null;
  $("transferModal").hidden=true;
  $("transferModal").setAttribute("aria-hidden","true");
}

async function submitTransfer(event){
  event.preventDefault();
  if(!transferItem) return;
  const destination=sanitizeText($("transferDestination").value,LIMITS.espacio);
  if(!destination){showToast("Indique el nuevo espacio o ubicación.",true);return;}
  const id=transferItem.idFirebase;
  try{
    const itemRef=ref(db,`inventario/${id}`);
    const now=Date.now();
    await update(itemRef,{espacio:destination,fechaUltimaModificacion:now,updatedAt:now});
    const updated={...transferItem,espacio:destination,fechaUltimaModificacion:now,updatedAt:now};
    await registrarMovimiento(updated,"Edición",0,destination);
    syncFirestoreAsset(updated,id);
    addLifecycleEvent(updated,"Traslado de ubicación",`De ${transferItem.espacio||"sin ubicación"} a ${destination}`);
    closeTransferModal();
    showToast(`Ubicación cambiada a ${destination}`);
  }catch(error){
    console.error("Error en Traslado Express:",error);
    showToast("No se pudo cambiar la ubicación. Revise las reglas de Firebase.",true);
  }
}

let lifecycleItem=null;

async function openLifecycleModal(item){
  lifecycleItem=item;
  $("lifecycleTitle").textContent=`Hoja de vida · ${item.nombre||"Activo"}`;
  $("lifecycleCode").textContent=`Código: ${item.codigo||"—"}`;
  $("lifecycleFicha").replaceChildren();
  const fields=[["Categoría",item.categoria],["Marca",item.marca],["Modelo",item.modelo],["Serial",item.serial||"—"],["Estado",item.estado],["Ubicación",item.espacio||"—"],["Responsable",item.responsable||"—"],["Fecha de ingreso",normalizeDateInputValue(item.fechaIngreso)||"—"],["Fecha de asignación",normalizeDateInputValue(item.fechaAsignacion)||"—"],["Especificaciones",item.especificaciones||"—"]];
  fields.forEach(([label,value])=>{const box=document.createElement("div");box.className="lifecycle-field";box.append(makeEl("span",label),makeEl("strong",value));$("lifecycleFicha").appendChild(box);});
  $("lifecycleNote").value="";
  $("lifecycleModal").hidden=false;$("lifecycleModal").setAttribute("aria-hidden","false");
  await loadLifecycleEvents(item);
}

async function loadLifecycleEvents(item){
  const list=$("lifecycleHistory"); list.replaceChildren();
  try {
    const snap=await getDocs(collection(firestore,"inventario",item.idFirebase,"hojaVida"));
    const events=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{const at=a.fechaHora?.toMillis?a.fechaHora.toMillis():Number(a.fechaHora)||0;const bt=b.fechaHora?.toMillis?b.fechaHora.toMillis():Number(b.fechaHora)||0;return bt-at;});
    if(!events.length){list.appendChild(makeEl("p","No hay eventos registrados en la hoja de vida.","muted"));return;}
    events.forEach(e=>{const row=document.createElement("div");row.className="lifecycle-event";const ts=e.fechaHora?.toMillis?e.fechaHora.toMillis():Number(e.fechaHora)||0;row.append(makeEl("strong",e.tipo||"Evento"),makeEl("span",ts?fmtDateTime(ts):"Fecha pendiente"),makeEl("p",e.detalle||""));list.appendChild(row);});
  } catch(error){ list.appendChild(makeEl("p","La hoja de vida histórica requiere que Firestore esté habilitado y sus reglas permitan lectura.","muted")); console.warn(error); }
}

async function saveLifecycleNote(){
  if(!lifecycleItem) return;
  const note=sanitizeText($("lifecycleNote").value,LIMITS.especificaciones);
  if(!note){showToast("Escriba una nota de mantenimiento o intervención.",true);return;}
  try { await addLifecycleEvent(lifecycleItem,"Nota de mantenimiento",note); $("lifecycleNote").value=""; await loadLifecycleEvents(lifecycleItem); showToast("Nota registrada en la hoja de vida."); }
  catch(error){showToast("No se pudo registrar la nota.",true);}
}

function closeLifecycleModal(){lifecycleItem=null;$("lifecycleModal").hidden=true;$("lifecycleModal").setAttribute("aria-hidden","true");}

async function printLifecycleSheet(){
  if(!lifecycleItem) return;
  const item=lifecycleItem;
  const wrap=document.createElement("div");wrap.style.cssText="background:#fff;color:#111;padding:20px;font-family:Arial,sans-serif;width:760px";
  wrap.append(makeEl("h2","FICHA TÉCNICA / HOJA DE VIDA DEL ACTIVO"),makeEl("p",`Código: ${item.codigo||"—"} · Fecha: ${new Date().toLocaleDateString("es-CO")}`));
  const table=document.createElement("table");table.style.cssText="width:100%;border-collapse:collapse;font-size:11px";
  [["Nombre",item.nombre],["Categoría",item.categoria],["Marca",item.marca],["Modelo",item.modelo],["Serial",item.serial||"—"],["Estado",item.estado],["Ubicación",item.espacio||"—"],["Responsable",item.responsable||"—"],["Fecha de ingreso",normalizeDateInputValue(item.fechaIngreso)||"—"],["Fecha de asignación",normalizeDateInputValue(item.fechaAsignacion)||"—"],["Especificaciones",item.especificaciones||"—"]].forEach(([a,b])=>{const tr=document.createElement("tr");[a,b].forEach((v,i)=>{const td=makeEl(i?"td":"th",v);td.style.cssText="border:1px solid #ccd3df;padding:6px;text-align:left";tr.appendChild(td)});table.appendChild(tr)});
  wrap.appendChild(table);
  html2pdf().set({margin:8,filename:`ficha_${(item.codigo||"activo").replace(/[^a-zA-Z0-9_-]/g,"_")}.pdf`,html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(wrap).save();
}

function getQrValue(item) {
  const sku=sanitizeText(item.codigo,LIMITS.codigo);
  const serial=sanitizeText(item.serial,LIMITS.serial);
  if(sku && serial) return `SKU: ${sku}\nSerial: ${serial}`;
  return sku || serial || "ARTICULO-SIN-CODIGO";
}

function openQrModal(item) {
  qrItem=item;
  const root=$("qrCanvas");
  root.replaceChildren();
  const value=getQrValue(item);
  $("qrItemName").textContent=item.nombre || "Artículo";
  $("qrItemCode").textContent=`${item.codigo ? `SKU: ${item.codigo}` : "SKU: —"}${item.serial ? ` · Serial: ${item.serial}` : ""}`;

  if(!globalThis.QRCode){
    showToast("No se cargó la librería de códigos QR. Recargue la página e inténtelo de nuevo.",true);
    qrItem=null;
    return;
  }

  new globalThis.QRCode(root,{
    text:value,
    width:240,
    height:240,
    correctLevel:globalThis.QRCode.CorrectLevel.M
  });
  $("qrModal").hidden=false;
  $("qrModal").setAttribute("aria-hidden","false");
}

function closeQrModal(){
  qrItem=null;
  $("qrCanvas").replaceChildren();
  $("qrModal").hidden=true;
  $("qrModal").setAttribute("aria-hidden","true");
}

async function downloadQrPng(){
  if(!qrItem) return;
  const root=$("qrCanvas");
  const canvas=root.querySelector("canvas");
  const image=root.querySelector("img");
  let dataUrl="";
  if(canvas) dataUrl=canvas.toDataURL("image/png");
  else if(image){
    if(!image.complete) await new Promise(resolve=>{image.onload=resolve;image.onerror=resolve;});
    const c=document.createElement("canvas");
    c.width=image.naturalWidth || 240;
    c.height=image.naturalHeight || 240;
    const ctx=c.getContext("2d");
    ctx.drawImage(image,0,0,c.width,c.height);
    dataUrl=c.toDataURL("image/png");
  }
  if(!dataUrl){showToast("No se pudo preparar el código QR para descargar.",true);return;}
  const safeName=(sanitizeText(qrItem.codigo || qrItem.serial || qrItem.nombre,"40") || "articulo").replace(/[^a-zA-Z0-9_-]+/g,"_");
  const link=document.createElement("a");
  link.href=dataUrl;
  link.download=`QR_${safeName}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function getOrderMeta(){
  return {
    solicitante:sanitizeText($("orderSolicitante").value,120),
    solicitadoA:sanitizeText($("orderSolicitadoA").value,120),
    area:sanitizeText($("orderArea").value,120),
    prioridad:sanitizeText($("orderPriority").value,40),
    justificacion:sanitizeText($("orderJustification").value,500)
  };
}

function suggestedOrderQuantity(item){
  return Math.max(1,item.stockMinimo-item.stockActual+1);
}

function getOrderItems(){
  const visible=filteredAlerts().sort((a,b)=>{
    const levelOrder={critical:0,preventive:1};
    return (levelOrder[alertLevel(a)]-levelOrder[alertLevel(b)]) || sortInventory(a,b);
  });
  const selectedVisible=visible.filter(item=>selectedAlertIds.has(item.idFirebase));
  return selectedVisible.length ? selectedVisible : visible;
}

function buildOrderDocument() {
  const items=getOrderItems();
  const meta=getOrderMeta();
  const root=$("orderDocument"); root.replaceChildren();
  if(!currentOrderFolio) currentOrderFolio=`REQ-${new Date().getFullYear()}-${String(orderCounter++).padStart(4,"0")}`;
  for(const item of items){ if(!orderQuantities.has(item.idFirebase)) orderQuantities.set(item.idFirebase,suggestedOrderQuantity(item)); }

  const header=document.createElement("div"); header.className="order-header";
  const left=document.createElement("div"); left.className="order-title";
  left.append(makeEl("h2","SISTEMA DE GESTIÓN DE INVENTARIO"),makeEl("p","Orden de Requerimiento de Consumibles"));
  const right=document.createElement("div"); right.className="order-meta";
  right.append(makeEl("p",`Folio: ${currentOrderFolio}`),makeEl("p",`Fecha: ${new Date().toLocaleDateString("es-CO")}`));
  header.append(left,right); root.appendChild(header);

  const data=document.createElement("div"); data.className="order-data";
  [["Solicitante",meta.solicitante||"—"],["Solicitado a",meta.solicitadoA||"—"],["Área / Departamento",meta.area||"—"],["Nivel de Prioridad",meta.prioridad||"—"]]
    .forEach(([a,b])=>{const x=document.createElement("div");x.className="order-box";x.append(makeEl("strong",a),document.createElement("br"),makeEl("span",b));data.appendChild(x)});
  root.appendChild(data);

  const table=document.createElement("table"); table.className="order-table";
  const thead=document.createElement("thead"), hr=document.createElement("tr");
  ["N°","Descripción / Material","Stock Actual","Stock Mínimo","Cantidad a Solicitar"].forEach(h=>hr.appendChild(makeEl("th",h)));
  thead.appendChild(hr); table.appendChild(thead);
  const tbody=document.createElement("tbody");
  items.forEach((item,n)=>{
    const tr=document.createElement("tr");
    addCell(tr,String(n+1)); addCell(tr,item.nombre); addCell(tr,String(item.stockActual),"danger-cell"); addCell(tr,String(item.stockMinimo));
    const qtyTd=document.createElement("td");
    const input=document.createElement("input"); input.type="number"; input.min="1"; input.step="1"; input.inputMode="numeric"; input.className="order-quantity"; input.value=String(orderQuantities.get(item.idFirebase)||suggestedOrderQuantity(item)); input.dataset.itemId=item.idFirebase; input.setAttribute("aria-label",`Cantidad a solicitar para ${item.nombre}`);
    input.addEventListener("input",()=>{const q=safeInt(input.value);if(q!==null&&q>=1)orderQuantities.set(item.idFirebase,q);});
    qtyTd.appendChild(input); tr.appendChild(qtyTd); tbody.appendChild(tr);
  });
  if(!items.length){const tr=document.createElement("tr");const td=makeEl("td","No hay ítems para el filtro de urgencia seleccionado.");td.colSpan=5;tr.appendChild(td);tbody.appendChild(tr);}
  table.appendChild(tbody); root.appendChild(table);

  const just=document.createElement("div"); just.className="justification";
  just.append(makeEl("strong","Justificación / Motivo del Pedido"),makeEl("p",meta.justificacion||"—")); root.appendChild(just);
  const signs=document.createElement("div"); signs.className="signatures";
  [meta.solicitante?`Solicitado Por: ${meta.solicitante}`:"Solicitado Por",meta.solicitadoA?`Solicitado A: ${meta.solicitadoA}`:"Aprobado Por"]
    .forEach(x=>signs.appendChild(makeEl("div",x,"signature")));
  root.appendChild(signs);
}

function openOrder(){
  currentOrderFolio="";
  orderQuantities=new Map();
  $("orderSolicitante").value="";
  $("orderSolicitadoA").value="";
  $("orderArea").value="";
  $("orderPriority").value=inventario.some(i=>alertLevel(i)==="critical")?"Alta":"Normal";
  $("orderJustification").value="";
  buildOrderDocument();
  $("orderModal").hidden=false;
  $("orderModal").setAttribute("aria-hidden","false");
}
function closeOrder(){$("orderModal").hidden=true;$("orderModal").setAttribute("aria-hidden","true");}

function exportRows(){
  return filteredInventory().sort(sortInventory).map(i=>({
    Tipo:i.tipo,
    Código:i.codigo,
    Nombre:i.nombre,
    Categoría:i.categoria,
    Marca:i.marca,
    Modelo:i.modelo,
    Serial:i.serial,
    Estado:i.estado,
    "Espacio Físico / Ubicación":displayLocation(i),
    Responsable:i.responsable,
    Unidad:i.unidad,
    Stock:i.tipo==="Consumible"?i.stockActual:"",
    "Stock Mínimo":i.tipo==="Consumible"?i.stockMinimo:"",
    "Prioridad de Alerta":i.tipo==="Consumible"?i.prioridadAlerta:"",
    "Fecha de Ingreso":i.fechaIngreso,
    "Fecha de Asignación":i.fechaAsignacion,
    Especificaciones:i.especificaciones
  }));
}

function exportExcel(){
  const rows=exportRows();
  const ws=XLSX.utils.json_to_sheet(rows);
  ws["!cols"]=[18,18,32,20,18,20,22,20,30,25,15,12,14,16,16].map(w=>({wch:w}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Inventario General");
  XLSX.writeFile(wb,"inventario_general.xlsx");
}

function exportPdf(){
  const rows=exportRows();
  const wrap=document.createElement("div");
  wrap.style.background="#ffffff"; wrap.style.padding="18px"; wrap.style.color="#111111"; wrap.style.fontFamily="Arial,Helvetica,sans-serif";
  const title=makeEl("h2","Inventario General"); title.style.margin="0 0 4px"; wrap.appendChild(title);
  const subtitle=makeEl("p",`Exportado: ${new Date().toLocaleString("es-CO")} · ${rows.length} registros`); subtitle.style.margin="0 0 14px"; subtitle.style.color="#555555"; wrap.appendChild(subtitle);

  const table=document.createElement("table"); table.style.width="100%"; table.style.borderCollapse="collapse"; table.style.fontSize="9px";
  const headers=["Tipo","Código","Nombre","Categoría","Marca","Modelo","Serial","Estado","Espacio / Ubicación","Responsable","Unidad","Stock","Stock Mínimo","Prioridad de Alerta","Fecha de Ingreso","Fecha de Asignación"];
  const thead=document.createElement("thead"),hr=document.createElement("tr");
  headers.forEach(h=>{const th=makeEl("th",h);th.style.border="1px solid #bfc7d4";th.style.padding="5px";th.style.background="#eef2f7";th.style.textAlign="left";hr.appendChild(th)}); thead.appendChild(hr); table.appendChild(thead);
  const tbody=document.createElement("tbody");
  rows.forEach(row=>{const tr=document.createElement("tr");headers.forEach(h=>{const td=makeEl("td",String(row[h]??""));td.style.border="1px solid #d6dbe3";td.style.padding="5px";td.style.verticalAlign="top";tr.appendChild(td)});tbody.appendChild(tr)});
  table.appendChild(tbody); wrap.appendChild(table);

  html2pdf().set({margin:6,filename:"inventario_general.pdf",html2canvas:{scale:2},jsPDF:{orientation:"landscape",unit:"mm",format:"a3"},pagebreak:{mode:["avoid-all","css","legacy"]}}).from(wrap).save();
}

async function exportOrderWord(){
  if(!window.docx){showToast("La librería DOCX no está disponible.",true);return;}
  const {Document,Packer,Paragraph,Table,TableRow,TableCell,TextRun,WidthType}=window.docx;
  const items=getOrderItems(); const meta=getOrderMeta();
  const rows=[new TableRow({children:["N°","Descripción / Material","Stock Actual","Stock Mínimo","Cantidad a Solicitar"].map(x=>new TableCell({children:[new Paragraph(x)]}))})];
  items.forEach((item,n)=>rows.push(new TableRow({children:[n+1,item.nombre,item.stockActual,item.stockMinimo,orderQuantities.get(item.idFirebase)||suggestedOrderQuantity(item)].map(x=>new TableCell({children:[new Paragraph(String(x))]}))})));
  const doc=new Document({sections:[{children:[
    new Paragraph({children:[new TextRun({text:"SISTEMA DE GESTIÓN DE INVENTARIO",bold:true,size:28})]}),
    new Paragraph("Orden de Requerimiento de Consumibles"),
    new Paragraph(`Folio: ${currentOrderFolio || "—"}`),
    new Paragraph(`Fecha: ${new Date().toLocaleDateString("es-CO")}`),
    new Paragraph(`Solicitante: ${meta.solicitante || "—"}`),
    new Paragraph(`Solicitado a: ${meta.solicitadoA || "—"}`),
    new Paragraph(`Área / Departamento: ${meta.area || "—"}`),
    new Paragraph(`Nivel de Prioridad: ${meta.prioridad || "—"}`),
    new Table({rows,width:{size:100,type:WidthType.PERCENTAGE}}),
    new Paragraph(`Justificación / Motivo del Pedido: ${meta.justificacion || "—"}`),
    new Paragraph(`\n\n__________________________                         __________________________\n${meta.solicitante?`Solicitado Por: ${meta.solicitante}`:"Solicitado Por"}                         ${meta.solicitadoA?`Solicitado A: ${meta.solicitadoA}`:"Aprobado Por"}`)
  ]}]});
  saveAs(await Packer.toBlob(doc),"orden_requerimiento.docx");
}

function normalizeImportHeader(value){
  return sanitizeText(value,120).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
}

function importValue(row, aliases){
  const normalized=new Map(Object.entries(row).map(([key,value])=>[normalizeImportHeader(key),value]));
  for(const alias of aliases){ const value=normalized.get(normalizeImportHeader(alias)); if(value!==undefined && String(value).trim()!=="") return value; }
  return "";
}

function parseBulkRow(row,index){
  const typeRaw=sanitizeText(importValue(row,["Tipo","Tipo de ítem","Tipo de item"]),30).toLowerCase();
  const tipo=typeRaw.includes("consum")?"Consumible":typeRaw.includes("activo")?"Activo":"";
  if(!tipo) throw new Error(`Fila ${index}: indique Tipo como Activo o Consumible.`);
  const raw={
    tipo,
    codigo:importValue(row,["Código","Codigo","SKU","Código / SKU","Código / SKU / Serial"]),
    nombre:importValue(row,["Nombre","Nombre / Descripción","Descripción","Descripcion"]),
    categoria:importValue(row,["Categoría","Categoria"]),
    marca:importValue(row,["Marca"]), modelo:importValue(row,["Modelo"]), serial:importValue(row,["Número de serie","Numero de serie","Serial"]),
    fechaIngreso:importValue(row,["Fecha de ingreso","Fecha ingreso"]), fechaAsignacion:importValue(row,["Fecha de asignación","Fecha asignacion"]),
    estado:importValue(row,["Estado"]), espacio:importValue(row,["Espacio Físico / Ubicación","Espacio / Ubicación","Ubicación","Ubicacion","Espacio"]),
    responsable:importValue(row,["Responsable","Persona Responsable / Custodio"]), unidad:importValue(row,["Unidad de medida","Unidad"]),
    stockActual:importValue(row,["Stock actual","Stock Actual","Stock"]), stockMinimo:importValue(row,["Stock mínimo","Stock minimo","Stock Mínimo"]), prioridadAlerta:importValue(row,["Prioridad de Alerta","Prioridad alerta","Prioridad"])
  };
  const item=normalizeItem(raw);
  if(!item.codigo || !item.nombre || !item.categoria || !item.espacio) throw new Error(`Fila ${index}: faltan Código/SKU, Nombre, Categoría o Espacio.`);
  if(tipo==="Activo"){
    if(!item.marca || !item.modelo || !["Disponible","Asignado","En mantenimiento","Baja"].includes(item.estado)) throw new Error(`Fila ${index}: un Activo requiere Marca, Modelo y Estado válido.`);
    if(item.estado==="Asignado" && (!item.responsable || !item.fechaAsignacion)) throw new Error(`Fila ${index}: un Activo asignado requiere Responsable y Fecha de asignación.`);
  }else{
    const stock=safeInt(raw.stockActual), minimo=safeInt(raw.stockMinimo);
    if(stock===null || minimo===null) throw new Error(`Fila ${index}: un Consumible requiere Stock actual y Stock mínimo enteros.`);
    item.stockActual=stock; item.stockMinimo=minimo; item.estado="Disponible"; item.prioridadAlerta=item.prioridadAlerta === "Baja" ? "Baja" : "Alta";
  }
  return item;
}

async function importBulkFile(file){
  if(!file) return;
  try{
    const buffer=await file.arrayBuffer();
    const workbook=XLSX.read(buffer,{type:"array",cellDates:false});
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    if(!sheet) throw new Error("El archivo no contiene una hoja válida.");
    const rows=XLSX.utils.sheet_to_json(sheet,{defval:""});
    if(!rows.length) throw new Error("El archivo no contiene registros.");
    const imported=[]; const usedCodes=new Set(inventario.map(i=>normalizedKey(i.codigo)).filter(Boolean)); const usedSerials=new Set(inventario.map(i=>normalizedKey(i.serial)).filter(Boolean));
    rows.forEach((row,idx)=>{
      const item=parseBulkRow(row,idx+2);
      const code=normalizedKey(item.codigo), serial=normalizedKey(item.serial);
      if(usedCodes.has(code)) throw new Error(`Fila ${idx+2}: el Código / SKU "${item.codigo}" ya existe.`);
      if(serial && usedSerials.has(serial)) throw new Error(`Fila ${idx+2}: el Número de serie "${item.serial}" ya existe.`);
      usedCodes.add(code); if(serial) usedSerials.add(serial); imported.push(item);
    });
    if(!confirm(`Se cargarán ${imported.length} registros a Firebase. ¿Continuar?`)) return;
    const updates={}; const now=Date.now();
    for(const item of imported){
      const itemRef=push(inventarioRef); const clean=toFirebasePayload({...item,fechaCreacion:now,fechaUltimaModificacion:0,createdAt:now,updatedAt:now}); updates[`inventario/${itemRef.key}`]=clean;
      const movementRef=push(movimientosRef); updates[`movimientos/${movementRef.key}`]={fechaHora:now,tipo:item.tipo,codigo:item.codigo,serial:item.serial,nombre:item.nombre,tipoAccion:"Registro",cantidad:item.tipo==="Consumible"?item.stockActual:1,espacioDestino:item.espacio};
    }
    await update(ref(db),updates);
    showToast(`${imported.length} registros cargados correctamente.`);
  }catch(error){ console.error("Carga masiva:",error); showToast(error.message||"No se pudo procesar el archivo.",true); }
  finally { $("bulkImportInput").value=""; }
}

function exportJson(){const data={inventario,movimientos,exportadoEn:Date.now()};const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});saveAs(blob,"backup_inventario.json")}
async function importJson(file){if(!file)return;try{const data=JSON.parse(await file.text());if(!Array.isArray(data.inventario))throw new Error();if(!confirm("Esto agregará los registros del respaldo a Firebase. ¿Continuar?"))return;for(const raw of data.inventario){const item=normalizeItem(raw);const now=Date.now();const created=Number(item.fechaCreacion)||Number(item.createdAt)||now;const modified=Number(item.fechaUltimaModificacion)||0;item.fechaCreacion=created;item.fechaUltimaModificacion=modified>created?modified:0;item.createdAt=created;item.updatedAt=item.fechaUltimaModificacion||created;delete item.idFirebase;await set(push(inventarioRef),item)}if(Array.isArray(data.movimientos)){for(const m of data.movimientos)await set(push(movimientosRef),{fechaHora:Number(m.fechaHora)||Date.now(),tipo:sanitizeText(m.tipo,20),codigo:sanitizeText(m.codigo,LIMITS.codigo),serial:sanitizeText(m.serial,LIMITS.serial),nombre:sanitizeText(m.nombre,LIMITS.nombre),tipoAccion:sanitizeText(m.tipoAccion,40),cantidad:Number.isInteger(m.cantidad)?m.cantidad:0,espacioDestino:sanitizeText(m.espacioDestino,120)})}showToast("Copia importada correctamente.");}catch{showToast("Archivo JSON inválido.",true)}}
function activateTab(id){document.querySelectorAll(".panel").forEach(x=>x.classList.toggle("active",x.id===id));document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===id))}

$("globalSearch").addEventListener("input",()=>{
  $("generalSearch").value=$("globalSearch").value;
  if($("globalSearch").value.trim()) activateTab("general");
  renderGeneralInventoryTable();
});

document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>activateTab(b.dataset.tab)));
["generalSearch","filterType","filterStatus","filterCategory","filterSpace"].forEach(id=>$(id).addEventListener("input",renderGeneralInventoryTable));
["movementSearchName","movementSearchSku","movementSearchSerial","movementDateFrom","movementDateTo","movementType","movementAction","movementSearchDestination"].forEach(id=>$(id).addEventListener("input",renderMovements));
$("clearFiltersBtn").addEventListener("click",()=>{$("generalSearch").value="";$("filterType").value="";$("filterStatus").value="";$("filterCategory").value="";$("filterSpace").value="";renderGeneralInventoryTable()});
$("clearMovementFiltersBtn").addEventListener("click",()=>{["movementSearchName","movementSearchSku","movementSearchSerial","movementDateFrom","movementDateTo","movementType","movementAction","movementSearchDestination"].forEach(id=>$(id).value="");renderMovements()});
$("estado").addEventListener("change",toggleLocationFields);$("generateSkuBtn").addEventListener("click",generateSku);$("generateConsumableSkuBtn").addEventListener("click",generateConsumableSku);$("scanBtn").addEventListener("click",()=>startScanner("codigo"));$("generalScanBtn").addEventListener("click",()=>startScanner("generalSearch",()=>renderGeneralInventoryTable()));$("closeScannerBtn").addEventListener("click",stopScanner);
$("scannerModal").addEventListener("click",e=>{if(e.target===$("scannerModal"))stopScanner()});$("qrModal").addEventListener("click",e=>{if(e.target===$("qrModal"))closeQrModal()});$("closeQrBtn").addEventListener("click",closeQrModal);$("cancelQrBtn").addEventListener("click",closeQrModal);$("downloadQrBtn").addEventListener("click",downloadQrPng);$("orderModal").addEventListener("click",e=>{if(e.target===$("orderModal"))closeOrder()});$("closeOrderModal").addEventListener("click",closeOrder);
$("movementModal").addEventListener("click",e=>{if(e.target===$("movementModal"))closeMovementModal()});$("closeMovementModal").addEventListener("click",closeMovementModal);$("cancelMovementBtn").addEventListener("click",closeMovementModal);$("movementForm").addEventListener("submit",submitMovement);
["orderSolicitante","orderSolicitadoA","orderArea","orderJustification"].forEach(id=>$(id).addEventListener("input",buildOrderDocument));["orderPriority"].forEach(id=>$(id).addEventListener("change",buildOrderDocument));
document.querySelectorAll(".alert-filter").forEach(btn=>btn.addEventListener("click",()=>{alertFilter=btn.dataset.alertFilter||"all";renderCriticals();if(!$("orderModal").hidden)buildOrderDocument();}));
$("serial").addEventListener("input",()=>{clearTimeout(serialValidationTimer);serialValidationTimer=setTimeout(()=>validateSerialField(assetEditingId || $("editingId").value || ""),250);});
$("serial").addEventListener("blur",()=>validateSerialField(assetEditingId || $("editingId").value || ""));
$("cSerial").addEventListener("input",()=>{clearTimeout(consumableSerialValidationTimer);consumableSerialValidationTimer=setTimeout(()=>validateConsumableSerialField(consumableEditingId || $("cEditingId").value || ""),250);});
$("cSerial").addEventListener("blur",()=>validateConsumableSerialField(consumableEditingId || $("cEditingId").value || ""));
$("scanSerialBtn").addEventListener("click",()=>startScanner("serial",()=>validateSerialField(assetEditingId || $("editingId").value || "")));
$("scanConsumableSerialBtn").addEventListener("click",()=>startScanner("cSerial",()=>validateConsumableSerialField(consumableEditingId || $("cEditingId").value || "")));
$("transferModal").addEventListener("click",e=>{if(e.target===$("transferModal"))closeTransferModal()});$("closeTransferBtn").addEventListener("click",closeTransferModal);$("cancelTransferBtn").addEventListener("click",closeTransferModal);$("transferForm").addEventListener("submit",submitTransfer);
$("deleteConfirmModal").addEventListener("click",e=>{if(e.target===$("deleteConfirmModal"))closeDeleteConfirm()});$("closeDeleteConfirmBtn").addEventListener("click",closeDeleteConfirm);$("cancelDeleteConfirmBtn").addEventListener("click",closeDeleteConfirm);$("confirmDeleteBtn").addEventListener("click",confirmDeleteItem);
$("editModal").addEventListener("click",e=>{if(e.target===$("editModal"))closeEditModal(true)});$("closeEditModalBtn").addEventListener("click",()=>closeEditModal(true));
$("bulkImportInput").addEventListener("change",e=>importBulkFile(e.target.files[0]));
$("cloneModal").addEventListener("click",e=>{if(e.target===$("cloneModal"))closeCloneModal()});
$("closeCloneBtn").addEventListener("click",closeCloneModal);$("cancelCloneBtn").addEventListener("click",closeCloneModal);$("cloneForm").addEventListener("submit",submitClone);
$("cloneCodigo").addEventListener("input",()=>{clearTimeout(cloneValidationTimer);cloneValidationTimer=setTimeout(validateCloneUniqueness,300)});
$("cloneSerial").addEventListener("input",()=>{clearTimeout(cloneValidationTimer);cloneValidationTimer=setTimeout(validateCloneUniqueness,300)});
$("lifecycleModal").addEventListener("click",e=>{if(e.target===$("lifecycleModal"))closeLifecycleModal()});$("closeLifecycleBtn").addEventListener("click",closeLifecycleModal);$("saveLifecycleNoteBtn").addEventListener("click",saveLifecycleNote);$("printLifecycleBtn").addEventListener("click",printLifecycleSheet);

document.addEventListener("keydown",e=>{if(e.key==="Enter" && !e.shiftKey){const target=e.target;if(target.closest(".modal") && target.tagName!=="TEXTAREA"){const form=target.closest("form");if(form){e.preventDefault();if(typeof form.requestSubmit==="function") form.requestSubmit();}}} if(e.key==="Escape"){if(!$("scannerModal").hidden)stopScanner();if(!$("qrModal").hidden)closeQrModal();if(!$("orderModal").hidden)closeOrder();if(!$("movementModal").hidden)closeMovementModal();if(!$("transferModal").hidden)closeTransferModal();if(!$("deleteConfirmModal").hidden)closeDeleteConfirm();if(!$("editModal").hidden)closeEditModal(true)}});
$("assetForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(isFormCompletelyBlank("assetForm")){showToast("Todos los campos están vacíos",true);return;}
  if(!e.currentTarget.checkValidity()){e.currentTarget.reportValidity();return;}
  try {
    const item=buildItemFromForm("Activo");
    const id=String(assetEditingId || $("editingId").value || "").trim();
    validateCurrentCode(item.codigo,id);
    if(item.serial && !await validateSerialField(id)) throw new Error($("serial").validationMessage);
    if(id){
      const previous=inventario.find(x=>x.idFirebase===id);
      if(!previous) throw new Error("El registro que intenta editar ya no está disponible. Recargue la página.");
      item.createdAt=previous.createdAt;
    }
    await guardarItemFirebase(item,id);
    clearAssetForm();
    if(id) finishEditModalAfterSave();
    showToast(id?"Cambios guardados correctamente.":"Activo registrado.");
  } catch(err) {
    showToast(err.message||"No se pudo guardar.",true);
  }
});
$("consumableForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(isFormCompletelyBlank("consumableForm")){showToast("Todos los campos están vacíos",true);return;}
  if(!e.currentTarget.checkValidity()){e.currentTarget.reportValidity();return;}
  try {
    const item=buildItemFromForm("Consumible");
    const id=String(consumableEditingId || $("cEditingId").value || "").trim();
    validateCurrentCode(item.codigo,id);
    const duplicateSerial=findDuplicateSerial(item.serial,id);
    if(duplicateSerial) throw new Error(`El número de serie ya existe en "${duplicateSerial.nombre || "otro registro"}".`);
    if(id){
      const previous=inventario.find(x=>x.idFirebase===id);
      if(!previous) throw new Error("El consumible que intenta editar ya no está disponible. Recargue la página.");
      item.createdAt=previous.createdAt;
    }
    await guardarItemFirebase(item,id);
    $("consumableForm").reset();
    $("cEditingId").value="";
    consumableEditingId="";
    if(id) finishEditModalAfterSave();
    showToast(id?"Cambios guardados correctamente.":"Consumible registrado.");
  } catch(err) {
    showToast(err.message||"No se pudo guardar.",true);
  }
});
$("cancelEditBtn").addEventListener("click",clearAssetForm);$("clearConsumableBtn").addEventListener("click",()=>{$("consumableForm").reset();$("cEditingId").value="";consumableEditingId="";});
$("generateOrderBtn").addEventListener("click",openOrder);$("downloadOrderPdfBtn").addEventListener("click",()=>html2pdf().set({margin:8,filename:"orden_requerimiento.pdf",html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4"}}).from($("orderDocument")).save());$("downloadOrderWordBtn").addEventListener("click",exportOrderWord);
$("exportExcelBtn").addEventListener("click",exportExcel);$("exportPdfBtn").addEventListener("click",exportPdf);$("exportJsonBtn").addEventListener("click",exportJson);$("importJsonInput").addEventListener("change",e=>importJson(e.target.files[0]));
window.addEventListener("beforeunload",()=>{if(scannerRunning&&scanner)scanner.stop().catch(()=>{})});

onValue(inventarioRef,snapshot=>{const data=snapshot.val()||{};renderizarInventario(Object.entries(data).map(([id,v])=>({...(v||{}),idFirebase:id})));},err=>{setSync("Error de conexión","error");showToast("Firebase rechazó la lectura. Revise las reglas.",true)});
onValue(movimientosRef,snapshot=>{
  const data=snapshot.val()||{};
  const rtdbMovements=Object.entries(data).map(([key,m])=>({idEvento:sanitizeText((m&&m.idEvento)||key,80),fechaHora:Number(m.fechaHora)||0,tipo:sanitizeText(m.tipo,20),codigo:sanitizeText(m.codigo,LIMITS.codigo),serial:sanitizeText(m.serial,LIMITS.serial),nombre:sanitizeText(m.nombre,LIMITS.nombre),tipoAccion:sanitizeText(m.tipoAccion,40),cantidad:safeInt(m.cantidad)??0,espacioDestino:sanitizeText(m.espacioDestino,120)}));
  const firestoreMovements=movimientos.filter(m=>m.__firestore===true);
  movimientos=[...rtdbMovements,...firestoreMovements].filter((m,index,arr)=>!m.idEvento || arr.findIndex(x=>x.idEvento===m.idEvento)===index);
  renderMovements();renderInventoryTable();renderGeneralInventoryTable();renderAnalytics();
},()=>setSync("Error de movimientos","error"));

try {
  onSnapshot(collection(firestore,"movimientos"),snapshot=>{
    const remote=snapshot.docs.map(d=>{const m=d.data()||{}; const rawTs=m.fechaHora; const ts=typeof rawTs==="number"?rawTs:(rawTs?.toMillis?rawTs.toMillis():Date.now()); return {__firestore:true,idEvento:sanitizeText(m.idEvento||d.id,80),fechaHora:ts,tipo:sanitizeText(m.tipo,20),codigo:sanitizeText(m.codigo,LIMITS.codigo),serial:sanitizeText(m.serial,LIMITS.serial),nombre:sanitizeText(m.nombre,LIMITS.nombre),tipoAccion:sanitizeText(m.tipoAccion,40),cantidad:safeInt(m.cantidad)??0,espacioDestino:sanitizeText(m.espacioDestino,120)};});
    const rtdb=movimientos.filter(m=>!m.__firestore);
    movimientos=[...rtdb,...remote].filter((m,index,arr)=>!m.idEvento || arr.findIndex(x=>x.idEvento===m.idEvento)===index);
    renderMovements();renderInventoryTable();renderGeneralInventoryTable();renderAnalytics();
  },error=>console.warn("No se pudo escuchar movimientos en Firestore.",error));
} catch(error) { console.warn("No se pudo inicializar el listener de movimientos de Firestore.",error); }
toggleLocationFields();
setInterval(()=>{renderInventoryTable();renderGeneralInventoryTable();renderCriticals();},60000);
