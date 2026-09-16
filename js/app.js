import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue, remove, update, runTransaction } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js";

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

const LIMITS = { codigo:80, nombre:140, categoria:80, marca:80, modelo:100, serial:100, espacio:120, responsable:120, unidad:40 };

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
    fechaEgreso: sanitizeText(raw.fechaEgreso, 20),
    estado: ["Disponible","Asignado","En mantenimiento","Baja"].includes(raw.estado) ? raw.estado : "Disponible",
    espacio: sanitizeText(raw.espacio, LIMITS.espacio),
    responsable: sanitizeText(raw.responsable, LIMITS.responsable),
    unidad: sanitizeText(raw.unidad, LIMITS.unidad),
    espacio: sanitizeText(raw.espacio, LIMITS.espacio),
    stockActual: Number.isSafeInteger(raw.stockActual) && raw.stockActual >= 0 ? raw.stockActual : 0,
    stockMinimo: Number.isSafeInteger(raw.stockMinimo) && raw.stockMinimo >= 0 ? raw.stockMinimo : 0,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now()
  };
  return item;
}

function buildItemFromForm(formKind) {
  if(formKind==="Consumible") {
    const stock=safeInt($("cStock").value), minimo=safeInt($("cMinimo").value);
    if(stock===null || minimo===null) throw new Error("Stock actual y stock mínimo deben ser números enteros no negativos.");
    const codigo=sanitizeText($("cCodigo").value,LIMITS.codigo), nombre=sanitizeText($("cNombre").value,LIMITS.nombre);
    if(!codigo || !nombre) throw new Error("Código y nombre son obligatorios.");
    return normalizeItem({tipo:"Consumible",codigo,nombre,categoria:sanitizeText($("cCategoria").value,LIMITS.categoria),unidad:sanitizeText($("cUnidad").value,LIMITS.unidad),fechaIngreso:$("cFecha").value,espacio:$("cEspacio").value,stockActual:stock,stockMinimo:minimo,estado:"Disponible",createdAt:Date.now(),updatedAt:Date.now()});
  }
  const codigo=sanitizeText($("codigo").value,LIMITS.codigo), nombre=sanitizeText($("nombre").value,LIMITS.nombre);
  if(!codigo || !nombre) throw new Error("Código / SKU y nombre son obligatorios.");
  const estado=["Disponible","Asignado","En mantenimiento","Baja"].includes($("estado").value)?$("estado").value:"Disponible";
  return normalizeItem({
    tipo:"Activo",codigo,nombre,categoria:sanitizeText($("categoria").value,LIMITS.categoria),marca:sanitizeText($("marca").value,LIMITS.marca),modelo:sanitizeText($("modelo").value,LIMITS.modelo),serial:sanitizeText($("serial").value,LIMITS.serial),
    fechaIngreso:$("fechaIngreso").value,fechaEgreso:$("fechaEgreso").value,estado,
    espacio:sanitizeText($("espacio").value,LIMITS.espacio),
    responsable:estado==="Asignado"?sanitizeText($("responsable").value,LIMITS.responsable):"",
    stockActual:0,stockMinimo:0,createdAt:Date.now(),updatedAt:Date.now()
  });
}

async function registrarMovimiento(item, tipoAccion, cantidad=0, espacioDestino="") {
  const movimiento={
    fechaHora:Date.now(),codigo:sanitizeText(item.codigo,LIMITS.codigo),nombre:sanitizeText(item.nombre,LIMITS.nombre),
    tipoAccion:sanitizeText(tipoAccion,40),cantidad:Number.isSafeInteger(cantidad)?Math.max(0,cantidad):0,
    espacioDestino:sanitizeText(espacioDestino,LIMITS.espacio)
  };
  await set(push(movimientosRef), movimiento);
}

function toFirebasePayload(item) {
  const clean = normalizeItem(item);
  delete clean.idFirebase;
  return clean;
}

async function guardarItemFirebase(item, existingId="") {
  const clean=toFirebasePayload(item);
  const id=String(existingId || "").trim();

  if(id) {
    const before=inventario.find(x=>x.idFirebase===id);
    if(!before) throw new Error("No se encontró el registro original para editarlo. Vuelva a cargar la página e inténtelo de nuevo.");

    clean.createdAt=Number.isFinite(before.createdAt) ? before.createdAt : Date.now();
    clean.updatedAt=Date.now();
    await update(ref(db,`inventario/${id}`), clean);
    await registrarMovimiento(
      { ...clean, idFirebase:id },
      "Edición",
      Math.abs(clean.tipo==="Consumible" ? (safeInt(clean.stockActual) ?? 0) - (safeInt(before.stockActual) ?? 0) : 0),
      clean.espacio
    );
    return;
  }

  const nuevo=push(inventarioRef);
  clean.createdAt=Date.now();
  clean.updatedAt=Date.now();
  await set(nuevo,clean);
  await registrarMovimiento({ ...clean, idFirebase:nuevo.key },"Registro",clean.tipo==="Consumible"?clean.stockActual:1,clean.espacio);
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
  $("saveMovementBtn").textContent=isEntry ? "Registrar entrada" : "Registrar salida";
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

  const itemRef=ref(db,`inventario/${idFirebase}`);
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
      espacio:destination,
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

  await registrarMovimiento(
    { ...item, stockActual:finalStock, espacio:destination },
    delta>0 ? "Entrada" : "Salida",
    cantidad,
    destination
  );
  return finalStock;
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
    await registrarMovimientoStock(id,delta,quantity,destination);
    closeMovementModal();
    showToast(delta>0 ? `Entrada de ${quantity} unidad${quantity===1?"":"es"} registrada.` : `Salida de ${quantity} unidad${quantity===1?"":"es"} registrada.`);
  }catch(error){
    console.error("Error al registrar movimiento:",error);
    showToast(error.message || "Firebase no permitió actualizar el stock. Revise las reglas de la base de datos.",true);
  }
}

function addCell(tr,text,cls="") { tr.appendChild(makeEl("td",text,cls)); }
function button(text,cls,handler,title="") { const b=document.createElement("button"); b.type="button"; b.className="mini-btn "+cls; b.textContent=text; b.title=title||text; b.addEventListener("click",handler); return b; }

function renderSummary() {
  const assets=inventario.filter(i=>i.tipo==="Activo");
  $("summaryTotal").textContent=String(assets.length);
  $("summaryAvailable").textContent=String(assets.filter(i=>i.estado==="Disponible").length);
  $("summaryAssigned").textContent=String(assets.filter(i=>i.estado==="Asignado").length);
  $("summaryMaintenance").textContent=String(assets.filter(i=>i.estado==="En mantenimiento").length);
}

function renderizarInventario(items) {
  inventario=items.map(normalizeItem);
  setSync("Sincronizado en tiempo real","ok");
  renderSummary();
  renderInventoryTable(); renderGeneralInventoryTable(); renderFilters(); renderCriticals();
}
window.renderizarInventario=renderizarInventario;

function filteredInventory() {
  const q=sanitizeText($("generalSearch").value,120).toLowerCase();
  const type=$("filterType").value;
  const status=$("filterStatus").value;
  const cat=$("filterCategory").value;
  const space=$("filterSpace").value;
  return inventario.filter(i=>{
    const hay=!q || [i.codigo,i.nombre,i.serial,i.marca,i.modelo,i.categoria,i.responsable,i.espacio].join(" ").toLowerCase().includes(q);
    return hay && (!type||i.tipo===type) && (!status||i.estado===status) && (!cat||i.categoria===cat) && (!space||i.espacio===space);
  });
}

function renderTableRow(item) {
  const tr=document.createElement("tr");
  addCell(tr,item.tipo); addCell(tr,item.codigo); addCell(tr,item.nombre); addCell(tr,item.categoria); addCell(tr,item.estado);
  addCell(tr,item.espacio); addCell(tr,item.responsable);
  const stockTd=document.createElement("td");
  if(item.tipo==="Consumible") {
    const wrap=document.createElement("div"); wrap.className="stock-control";
    wrap.append(button("−","minus",()=>openMovementModal(item.idFirebase,-1),"Registrar salida"));
    wrap.append(makeEl("strong",String(item.stockActual)));
    wrap.append(button("+","plus",()=>openMovementModal(item.idFirebase,1),"Registrar entrada"));
    stockTd.appendChild(wrap);
  } else stockTd.textContent="—";
  tr.appendChild(stockTd);
  const act=document.createElement("td"); act.className="actions";
  act.append(button("Editar","edit",()=>editItem(item)));
  act.append(button("Copiar","copy",()=>duplicateItem(item),"Duplicar registro"));
  act.append(button("Eliminar","delete",async()=>{
    if(confirm(`¿Eliminar "${item.nombre}"?`)){
      try{await eliminarItemFirebase(item.idFirebase)}catch(e){showToast("No se pudo eliminar.",true)}
    }
  }));
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
  $("generalInventoryCount").textContent=`${data.length} registros`;
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
  const spaces=[...new Set(inventario.map(i=>i.espacio).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
  select.replaceChildren(new Option("Todas las categorías",""));
  spaceSelect.replaceChildren(new Option("Todos los espacios físicos",""));
  cats.forEach(c=>select.appendChild(new Option(c,c)));
  spaces.forEach(c=>spaceSelect.appendChild(new Option(c,c)));
  select.value=cats.includes(current)?current:"";
  spaceSelect.value=spaces.includes(currentSpace)?currentSpace:"";
}

function renderCriticals() {
  const critical=inventario.filter(i=>i.tipo==="Consumible" && i.stockActual<=i.stockMinimo);
  $("criticalBadge").textContent=String(critical.length);
  const box=$("criticalList"); box.replaceChildren();
  if(!critical.length){box.appendChild(makeEl("p","No hay consumibles en nivel crítico.","muted"));return}
  critical.forEach(i=>{const card=document.createElement("article");card.className="critical-item";card.append(makeEl("h3",i.nombre),makeEl("p",`Código: ${i.codigo}`),makeEl("p",`Stock actual: ${i.stockActual}`,"critical-number"),makeEl("p",`Stock mínimo: ${i.stockMinimo}`));box.appendChild(card)});
}
function renderMovements() {
  const body=$("movementTableBody");body.replaceChildren();
  movimientos.slice().sort((a,b)=>(b.fechaHora||0)-(a.fechaHora||0)).forEach(m=>{const tr=document.createElement("tr");addCell(tr,fmtDateTime(m.fechaHora));addCell(tr,m.codigo);addCell(tr,m.nombre);addCell(tr,m.tipoAccion);addCell(tr,String(m.cantidad));addCell(tr,m.espacioDestino);body.appendChild(tr)});
}

function editItem(item) {
  if(item.tipo==="Consumible") {
    assetEditingId="";
    $("editingId").value="";
    consumableEditingId=item.idFirebase;
  } else {
    consumableEditingId="";
    $("cEditingId").value="";
    assetEditingId=item.idFirebase;
  }
  activateTab(item.tipo==="Consumible"?"consumibles":"activos");

  if(item.tipo==="Consumible"){
    $("cEditingId").value=item.idFirebase;
    $("cCodigo").value=item.codigo;
    $("cNombre").value=item.nombre;
    $("cCategoria").value=item.categoria;
    $("cUnidad").value=item.unidad;
    $("cFecha").value=item.fechaIngreso;
    $("cEspacio").value=item.espacio;
    $("cStock").value=item.stockActual;
    $("cMinimo").value=item.stockMinimo;
    showToast("Editando consumible.");
    return;
  }

  $("editingId").value=item.idFirebase;
  $("codigo").value=item.codigo;
  $("nombre").value=item.nombre;
  $("categoria").value=item.categoria;
  $("marca").value=item.marca;
  $("modelo").value=item.modelo;
  $("serial").value=item.serial;
  $("fechaIngreso").value=item.fechaIngreso;
  $("fechaEgreso").value=item.fechaEgreso;
  $("estado").value=item.estado;
  $("espacio").value=item.espacio;
  $("responsable").value=item.responsable;
  toggleLocationFields();
  $("saveItemBtn").textContent="Guardar cambios";
  showToast("Editando activo.");
}
function clearAssetForm(){
  $("assetForm").reset();
  $("editingId").value="";
  assetEditingId="";
  $("saveItemBtn").textContent="Guardar activo";
  toggleLocationFields();
}
function toggleLocationFields(){const assigned=$("estado").value==="Asignado";$("responsableField").classList.toggle("hidden",!assigned)}

function duplicateItem(item) {
  assetEditingId="";
  consumableEditingId="";
  if (item.tipo === "Consumible") {
    activateTab("consumibles");
    $("cEditingId").value="";
    $("cCodigo").value="";
    $("cNombre").value=item.nombre;
    $("cCategoria").value=item.categoria;
    $("cUnidad").value=item.unidad;
    $("cFecha").value=item.fechaIngreso;
    $("cEspacio").value=item.espacio;
    $("cStock").value="0";
    $("cMinimo").value=String(item.stockMinimo);
    showToast("Copia preparada. Escriba un nuevo código.");
    return;
  }

  activateTab("activos");
  $("editingId").value="";
  $("codigo").value="";
  $("nombre").value=item.nombre;
  $("categoria").value=item.categoria;
  $("marca").value=item.marca;
  $("modelo").value=item.modelo;
  $("serial").value="";
  $("fechaIngreso").value="";
  $("fechaEgreso").value="";
  $("estado").value="Disponible";
  $("espacio").value=item.espacio;
  $("responsable").value="";
  $("saveItemBtn").textContent="Guardar activo";
  toggleLocationFields();
  showToast("Registro copiado. Código y serial quedaron vacíos.");
}

function nextAvailableSku(prefix){
  const used=new Set(inventario.map(i=>String(i.codigo||"").trim().toUpperCase()).filter(Boolean));
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
  return aliases[cat] || cat.replace(/[^A-Z0-9]/g,"").slice(0,4) || fallback;
}

function generateSku(){
  const prefix=categoryPrefix($("categoria").value,"ACT");
  $("codigo").value=nextAvailableSku(prefix);
}

function generateConsumableSku(){
  const prefix=categoryPrefix($("cCategoria").value,"CON");
  $("cCodigo").value=nextAvailableSku(prefix);
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

async function startScanner(){
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
  $("scannerModal").hidden=false;
  $("scannerModal").setAttribute("aria-hidden","false");
  await new Promise(r=>setTimeout(r,100));

  try {
    // Obtener la lista de cámaras primero es el flujo recomendado por html5-qrcode
    // y además fuerza la solicitud de permiso de cámara cuando todavía no existe.
    const cameras=await globalThis.Html5Qrcode.getCameras();
    if(!cameras?.length) throw new DOMException("No camera found","NotFoundError");

    scanner=new globalThis.Html5Qrcode("reader",{verbose:false});
    const rear=cameras.find(c=>/back|rear|environment|trasera|posterior/i.test(c.label));
    const cameraId=(rear || cameras[0]).id;
    const config={
      fps:10,
      qrbox:{width:260,height:180},
      aspectRatio:1.7778,
      rememberLastUsedCamera:true
    };

    const onScan=async text=>{
      if(!scannerRunning) return;
      $("codigo").value=sanitizeText(text,LIMITS.codigo);
      beep();
      await stopScanner();
      showToast("Código detectado.");
    };

    await scanner.start(cameraId,config,onScan,()=>{});
    scannerRunning=true;
  } catch(error){
    const name=error?.name || "";
    const message=String(error?.message || error || "");
    await stopScanner();
    let text="No se pudo abrir la cámara.";
    if(name==="NotAllowedError" || name==="PermissionDeniedError" || /permission|not allowed|denied/i.test(message)){
      text="Permiso de cámara bloqueado. En Chrome: candado del sitio → Cámara → Permitir y recargue la página.";
    } else if(name==="NotFoundError"){
      text="No se encontró una cámara disponible en este dispositivo.";
    } else if(name==="NotReadableError"){
      text="La cámara está ocupada por otra aplicación. Cierre otras apps que la estén usando e inténtelo nuevamente.";
    } else if(name==="SecurityError"){
      text="El navegador bloqueó la cámara por seguridad. Use HTTPS.";
    } else if(name==="OverconstrainedError"){
      text="La cámara seleccionada no admite la configuración solicitada. Intente nuevamente.";
    }
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

function getOrderMeta(){
  return {
    solicitante:sanitizeText($("orderSolicitante").value,120),
    solicitadoA:sanitizeText($("orderSolicitadoA").value,120),
    area:sanitizeText($("orderArea").value,120),
    prioridad:sanitizeText($("orderPriority").value,40),
    estado:sanitizeText($("orderStatus").value,40)
  };
}

function buildOrderDocument() {
  const critical=inventario.filter(i=>i.tipo==="Consumible"&&i.stockActual<=i.stockMinimo)
    .sort(sortInventory);
  const meta=getOrderMeta();
  const root=$("orderDocument"); root.replaceChildren();
  if(!currentOrderFolio) currentOrderFolio=`REQ-${new Date().getFullYear()}-${String(orderCounter++).padStart(4,"0")}`;

  const header=document.createElement("div"); header.className="order-header";
  const left=document.createElement("div"); left.className="order-title";
  left.append(makeEl("h2","SISTEMA DE GESTIÓN DE INVENTARIO"),makeEl("p","Orden de Requerimiento de Consumibles"));
  const right=document.createElement("div"); right.className="order-meta";
  right.append(makeEl("p",`Folio: ${currentOrderFolio}`),makeEl("p",`Fecha: ${new Date().toLocaleDateString("es-CO")}`));
  header.append(left,right); root.appendChild(header);

  const data=document.createElement("div"); data.className="order-data";
  [["Solicitante",meta.solicitante||"—"],["Solicitado a",meta.solicitadoA||"—"],["Área / Departamento",meta.area||"—"],["Nivel de Prioridad",meta.prioridad||"—"],["Estado",meta.estado||"—"]]
    .forEach(([a,b])=>{const x=document.createElement("div");x.className="order-box";x.append(makeEl("strong",a),document.createElement("br"),makeEl("span",b));data.appendChild(x)});
  root.appendChild(data);

  const table=document.createElement("table"); table.className="order-table";
  const thead=document.createElement("thead"), hr=document.createElement("tr");
  ["N°","Descripción / Material","Stock Actual","Stock Mínimo","Cantidad a Solicitar"].forEach(h=>hr.appendChild(makeEl("th",h)));
  thead.appendChild(hr); table.appendChild(thead);
  const tbody=document.createElement("tbody");
  critical.forEach((i,n)=>{
    const tr=document.createElement("tr");
    [String(n+1),i.nombre,String(i.stockActual),String(i.stockMinimo),String(Math.max(1,i.stockMinimo-i.stockActual+1))]
      .forEach((v,k)=>addCell(tr,v,k===2?"danger-cell":""));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); root.appendChild(table);

  const just=document.createElement("div"); just.className="justification";
  just.append(makeEl("strong","Justificación"),makeEl("p",critical.length?"Reposición de consumibles que se encuentran en nivel crítico o por debajo del mínimo establecido.":"No existen consumibles críticos."));
  root.appendChild(just);
  const signs=document.createElement("div"); signs.className="signatures";
  [meta.solicitante?`Solicitado Por: ${meta.solicitante}`:"Solicitado Por",meta.solicitadoA?`Solicitado A: ${meta.solicitadoA}`:"Aprobado Por"]
    .forEach(s=>signs.appendChild(makeEl("div",s,"signature")));
  root.appendChild(signs);
}

function openOrder(){
  currentOrderFolio="";
  $("orderSolicitante").value="";
  $("orderSolicitadoA").value="";
  $("orderArea").value="";
  $("orderPriority").value=inventario.some(i=>i.tipo==="Consumible"&&i.stockActual<=i.stockMinimo)?"Alta":"Normal";
  $("orderStatus").value="Pendiente";
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
    "Espacio Físico / Ubicación":i.espacio,
    Responsable:i.responsable,
    Unidad:i.unidad,
    Stock:i.tipo==="Consumible"?i.stockActual:"",
    "Stock Mínimo":i.tipo==="Consumible"?i.stockMinimo:"",
    "Fecha de Ingreso":i.fechaIngreso,
    "Fecha de Egreso":i.fechaEgreso
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
  const headers=["Tipo","Código","Nombre","Categoría","Marca","Modelo","Serial","Estado","Espacio / Ubicación","Responsable","Unidad","Stock","Stock Mínimo","Fecha de Ingreso","Fecha de Egreso"];
  const thead=document.createElement("thead"),hr=document.createElement("tr");
  headers.forEach(h=>{const th=makeEl("th",h);th.style.border="1px solid #bfc7d4";th.style.padding="5px";th.style.background="#eef2f7";th.style.textAlign="left";hr.appendChild(th)}); thead.appendChild(hr); table.appendChild(thead);
  const tbody=document.createElement("tbody");
  rows.forEach(row=>{const tr=document.createElement("tr");headers.forEach(h=>{const td=makeEl("td",String(row[h]??""));td.style.border="1px solid #d6dbe3";td.style.padding="5px";td.style.verticalAlign="top";tr.appendChild(td)});tbody.appendChild(tr)});
  table.appendChild(tbody); wrap.appendChild(table);

  html2pdf().set({margin:6,filename:"inventario_general.pdf",html2canvas:{scale:2},jsPDF:{orientation:"landscape",unit:"mm",format:"a3"},pagebreak:{mode:["avoid-all","css","legacy"]}}).from(wrap).save();
}

async function exportOrderWord(){
  if(!window.docx){showToast("La librería DOCX no está disponible.",true);return}
  const {Document,Packer,Paragraph,Table,TableRow,TableCell,TextRun,WidthType}=window.docx;
  const critical=inventario.filter(i=>i.tipo==="Consumible"&&i.stockActual<=i.stockMinimo).sort(sortInventory);
  const meta=getOrderMeta();
  const rows=[new TableRow({children:["N°","Descripción / Material","Stock Actual","Stock Mínimo","Cantidad a Solicitar"].map(x=>new TableCell({children:[new Paragraph(x)]}))})];
  critical.forEach((i,n)=>rows.push(new TableRow({children:[n+1,i.nombre,i.stockActual,i.stockMinimo,Math.max(1,i.stockMinimo-i.stockActual+1)].map(x=>new TableCell({children:[new Paragraph(String(x))]}))})));
  const doc=new Document({sections:[{children:[
    new Paragraph({children:[new TextRun({text:"SISTEMA DE GESTIÓN DE INVENTARIO",bold:true,size:28})]}),
    new Paragraph("Orden de Requerimiento de Consumibles"),
    new Paragraph(`Folio: ${currentOrderFolio || "—"}`),
    new Paragraph(`Fecha: ${new Date().toLocaleDateString("es-CO")}`),
    new Paragraph(`Solicitante: ${meta.solicitante || "—"}`),
    new Paragraph(`Solicitado a: ${meta.solicitadoA || "—"}`),
    new Paragraph(`Área / Departamento: ${meta.area || "—"}`),
    new Paragraph(`Nivel de Prioridad: ${meta.prioridad || "—"}`),
    new Paragraph(`Estado: ${meta.estado || "—"}`),
    new Table({rows,width:{size:100,type:WidthType.PERCENTAGE}}),
    new Paragraph("Justificación: Reposición de consumibles en nivel crítico."),
    new Paragraph(`\n\n__________________________                         __________________________\n${meta.solicitante?`Solicitado Por: ${meta.solicitante}`:"Solicitado Por"}                         ${meta.solicitadoA?`Solicitado A: ${meta.solicitadoA}`:"Aprobado Por"}`)
  ]}]});
  saveAs(await Packer.toBlob(doc),"orden_requerimiento.docx");
}

function exportJson(){const data={inventario,movimientos,exportadoEn:Date.now()};const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});saveAs(blob,"backup_inventario.json")}
async function importJson(file){if(!file)return;try{const data=JSON.parse(await file.text());if(!Array.isArray(data.inventario))throw new Error();if(!confirm("Esto agregará los registros del respaldo a Firebase. ¿Continuar?"))return;for(const raw of data.inventario){const item=normalizeItem(raw);delete item.idFirebase;await set(push(inventarioRef),item)}if(Array.isArray(data.movimientos)){for(const m of data.movimientos)await set(push(movimientosRef),{fechaHora:Number(m.fechaHora)||Date.now(),codigo:sanitizeText(m.codigo,LIMITS.codigo),nombre:sanitizeText(m.nombre,LIMITS.nombre),tipoAccion:sanitizeText(m.tipoAccion,40),cantidad:Number.isInteger(m.cantidad)?m.cantidad:0,espacioDestino:sanitizeText(m.espacioDestino,120)})}showToast("Copia importada correctamente.");}catch{showToast("Archivo JSON inválido.",true)}}
function activateTab(id){document.querySelectorAll(".panel").forEach(x=>x.classList.toggle("active",x.id===id));document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===id))}

$("globalSearch").addEventListener("input",()=>{
  $("generalSearch").value=$("globalSearch").value;
  if($("globalSearch").value.trim()) activateTab("general");
  renderGeneralInventoryTable();
});

document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>activateTab(b.dataset.tab)));
["generalSearch","filterType","filterStatus","filterCategory","filterSpace"].forEach(id=>$(id).addEventListener("input",renderGeneralInventoryTable));
$("clearFiltersBtn").addEventListener("click",()=>{$("generalSearch").value="";$("filterType").value="";$("filterStatus").value="";$("filterCategory").value="";$("filterSpace").value="";renderGeneralInventoryTable()});
$("estado").addEventListener("change",toggleLocationFields);$("generateSkuBtn").addEventListener("click",generateSku);$("generateConsumableSkuBtn").addEventListener("click",generateConsumableSku);$("scanBtn").addEventListener("click",startScanner);$("closeScannerBtn").addEventListener("click",stopScanner);
$("scannerModal").addEventListener("click",e=>{if(e.target===$("scannerModal"))stopScanner()});$("orderModal").addEventListener("click",e=>{if(e.target===$("orderModal"))closeOrder()});$("closeOrderModal").addEventListener("click",closeOrder);
$("movementModal").addEventListener("click",e=>{if(e.target===$("movementModal"))closeMovementModal()});$("closeMovementModal").addEventListener("click",closeMovementModal);$("cancelMovementBtn").addEventListener("click",closeMovementModal);$("movementForm").addEventListener("submit",submitMovement);
["orderSolicitante","orderSolicitadoA","orderArea"].forEach(id=>$(id).addEventListener("input",buildOrderDocument));["orderPriority","orderStatus"].forEach(id=>$(id).addEventListener("change",buildOrderDocument));
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!$("scannerModal").hidden)stopScanner();if(!$("orderModal").hidden)closeOrder();if(!$("movementModal").hidden)closeMovementModal()}});
$("assetForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try {
    const item=buildItemFromForm("Activo");
    const id=String(assetEditingId || $("editingId").value || "").trim();
    if(id){
      const previous=inventario.find(x=>x.idFirebase===id);
      if(!previous) throw new Error("El registro que intenta editar ya no está disponible. Recargue la página.");
      item.createdAt=previous.createdAt;
    }
    await guardarItemFirebase(item,id);
    clearAssetForm();
    showToast(id?"Cambios guardados correctamente.":"Activo registrado.");
  } catch(err) {
    showToast(err.message||"No se pudo guardar.",true);
  }
});
$("consumableForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try {
    const item=buildItemFromForm("Consumible");
    const id=String(consumableEditingId || $("cEditingId").value || "").trim();
    if(id){
      const previous=inventario.find(x=>x.idFirebase===id);
      if(!previous) throw new Error("El consumible que intenta editar ya no está disponible. Recargue la página.");
      item.createdAt=previous.createdAt;
    }
    await guardarItemFirebase(item,id);
    $("consumableForm").reset();
    $("cEditingId").value="";
    consumableEditingId="";
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
onValue(movimientosRef,snapshot=>{const data=snapshot.val()||{};movimientos=Object.values(data).map(m=>({fechaHora:Number(m.fechaHora)||0,codigo:sanitizeText(m.codigo,LIMITS.codigo),nombre:sanitizeText(m.nombre,LIMITS.nombre),tipoAccion:sanitizeText(m.tipoAccion,40),cantidad:Number.isInteger(m.cantidad)?m.cantidad:0,espacioDestino:sanitizeText(m.espacioDestino,120)}));renderMovements();},()=>setSync("Error de movimientos","error"));
toggleLocationFields();
