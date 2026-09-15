/**
 * Lógica de Negocio, Seguridad, Cámara y Control del Sistema
 */

let listaInventarioGlobal = [];
let html5QrCode = null;

document.addEventListener("DOMContentLoaded", () => {
  inicializarEventosUI();
  actualizarFechaFolioOrden();
});

// Sanitización XSS Estricta
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m];
  });
}

// Generador de Beep Nativo (Web Audio API)
function emitirBeepConfirmacion() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // Tono A5
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    console.warn("Audio Context no soportado o deshabilitado.", e);
  }
}

function inicializarEventosUI() {
  // Manejo de formulario de registro/edición
  const form = document.getElementById("formInventario");
  form.addEventListener("submit", manejarGuardado);

  document.getElementById("btnCancelarEdicion").addEventListener("click", resetearFormulario);

  // Generación Automática de SKU
  document.getElementById("btnGenerarSKU").addEventListener("click", generarSKUAutomatico);
  document.getElementById("categoria").addEventListener("change", () => {
    if (!document.getElementById("itemIdFirebase").value) {
      generarSKUAutomatico();
    }
  });

  // Visibilidad de Campos Dinámicos
  document.getElementById("estadoActivo").addEventListener("change", (e) => {
    toggleCamposUbicacion(e.target.value);
  });

  // Búsqueda Sanitizada en Tiempo Real
  document.getElementById("inputBuscar").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    const filtrados = listaInventarioGlobal.filter(item =>
      (item.codigo && item.codigo.toLowerCase().includes(query)) ||
      (item.nombre && item.nombre.toLowerCase().includes(query)) ||
      (item.ubicacionBodega && item.ubicacionBodega.toLowerCase().includes(query)) ||
      (item.lugarAsignacion && item.lugarAsignacion.toLowerCase().includes(query)) ||
      (item.responsable && item.responsable.toLowerCase().includes(query))
    );
    renderizarTabla(filtrados);
  });

  // Modal del Escáner de Cámara
  const modalEscaner = document.getElementById('modalEscaner');
  modalEscaner.addEventListener('shown.bs.modal', iniciarCamaraEscaner);
  modalEscaner.addEventListener('hidden.bs.modal', detenerCamaraEscaner);

  // Exportaciones
  document.getElementById("btnExportarExcel").addEventListener("click", exportarExcel);
  document.getElementById("btnExportarWord").addEventListener("click", exportarWord);
  document.getElementById("btnExportarPDF").addEventListener("click", exportarPDF);
}

function toggleCamposUbicacion(estado) {
  const gBodega = document.getElementById("grupoUbicacionBodega");
  const gAsignado = document.getElementById("grupoUbicacionAsignado");
  const gResp = document.getElementById("grupoResponsable");

  if (estado === "En Bodega") {
    gBodega.classList.remove("d-none");
    gAsignado.classList.add("d-none");
    gResp.classList.add("d-none");
  } else {
    gBodega.classList.add("d-none");
    gAsignado.classList.remove("d-none");
    gResp.classList.remove("d-none");
  }
}

function generarSKUAutomatico() {
  const catSelect = document.getElementById("categoria").value || "GEN";
  const prefijo = catSelect.toUpperCase();
  const conteo = listaInventarioGlobal.filter(i => (i.categoria || '').toUpperCase() === prefijo).length + 1;
  const correlativo = String(conteo).padStart(3, '0');
  
  document.getElementById("codigo").value = `${prefijo}-${correlativo}`;
}

// Invocado por Firebase al cambiar el estado del inventario
window.renderizarInventario = function(data) {
  listaInventarioGlobal = data;
  renderizarTabla(listaInventarioGlobal);
  actualizarAlertas(listaInventarioGlobal);
  renderizarOrdenRequerimiento(listaInventarioGlobal);
};

// Renderizar Tabla con Inserción Segura en el DOM
function renderizarTabla(items) {
  const tbody = document.getElementById("tbodyInventario");
  tbody.innerHTML = "";

  if (items.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="text-center text-muted py-3">No hay productos registrados en el inventario.</td>`;
    tbody.appendChild(tr);
    return;
  }

  items.forEach((item) => {
    const tr = document.createElement("tr");
    const esBajo = parseInt(item.cantidad) <= parseInt(item.stockMinimo);
    const esBodega = (item.estadoActivo || 'En Bodega') === 'En Bodega';
    
    const textoUbicacion = esBodega 
      ? sanitizeText(item.ubicacionBodega || 'Bodega General')
      : `${sanitizeText(item.lugarAsignacion || 'Asignado')} (${sanitizeText(item.responsable || 'Sin custodio')})`;

    tr.innerHTML = `
      <td><strong class="font-mono">${sanitizeText(item.codigo)}</strong></td>
      <td>${sanitizeText(item.nombre)}</td>
      <td>
        <span class="badge ${esBodega ? 'bg-secondary' : 'bg-info text-dark'}">
          ${sanitizeText(item.estadoActivo || 'En Bodega')}
        </span>
      </td>
      <td><small>${textoUbicacion}</small></td>
      <td class="text-center">
        <div class="btn-group btn-group-sm" role="group">
          <button class="btn btn-outline-danger px-2" onclick="modificarStockRápido('${item.idFirebase}', -1)" title="-1 unidad">-</button>
          <span class="btn btn-light fw-bold disabled px-3 ${esBajo ? 'text-danger' : 'text-dark'}">${parseInt(item.cantidad)}</span>
          <button class="btn btn-outline-success px-2" onclick="modificarStockRápido('${item.idFirebase}', 1)" title="+1 unidad">+</button>
        </div>
      </td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-warning me-1" onclick="prepararEdicion('${item.idFirebase}')" title="Editar">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="confirmarEliminacion('${item.idFirebase}')" title="Eliminar">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Invocado por Firebase al cambiar el estado del Kárdex
window.renderizarMovimientos = function(data) {
  const tbody = document.getElementById("tbodyMovimientos");
  tbody.innerHTML = "";

  // Ordenar del evento más reciente al más antiguo
  data.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay registro de movimientos.</td></tr>`;
    return;
  }

  data.forEach((mov) => {
    const tr = document.createElement("tr");
    const fechaFormatted = new Date(mov.fecha).toLocaleString("es-CO");
    
    let badgeClass = "bg-secondary";
    if (mov.tipo === "Registro") badgeClass = "bg-success";
    if (mov.tipo === "Entrada (+1)") badgeClass = "bg-primary";
    if (mov.tipo === "Salida (-1)") badgeClass = "bg-warning text-dark";
    if (mov.tipo === "Eliminación") badgeClass = "bg-danger";

    tr.innerHTML = `
      <td><small class="text-muted">${sanitizeText(fechaFormatted)}</small></td>
      <td><strong class="font-mono">${sanitizeText(mov.codigo)}</strong></td>
      <td>${sanitizeText(mov.nombre)}</td>
      <td><span class="badge ${badgeClass}">${sanitizeText(mov.tipo)}</span></td>
      <td class="fw-bold">${parseInt(mov.cantidad)}</td>
    `;
    tbody.appendChild(tr);
  });
};

// Manejo del Formulario (Guardado / Edición)
function manejarGuardado(e) {
  e.preventDefault();

  const idFirebase = document.getElementById("itemIdFirebase").value;
  const cantidadVal = parseInt(document.getElementById("cantidad").value);
  const stockMinVal = parseInt(document.getElementById("stockMinimo").value);

  // Validación de seguridad de enteros positivos
  if (isNaN(cantidadVal) || cantidadVal < 0 || isNaN(stockMinVal) || stockMinVal < 0) {
    alert("Las cantidades deben ser números enteros no negativos.");
    return;
  }

  const itemData = {
    categoria: sanitizeText(document.getElementById("categoria").value),
    codigo: sanitizeText(document.getElementById("codigo").value.trim()),
    nombre: sanitizeText(document.getElementById("nombre").value.trim()),
    estadoActivo: sanitizeText(document.getElementById("estadoActivo").value),
    ubicacionBodega: sanitizeText(document.getElementById("ubicacionBodega").value.trim()),
    lugarAsignacion: sanitizeText(document.getElementById("lugarAsignacion").value.trim()),
    responsable: sanitizeText(document.getElementById("responsable").value.trim()),
    cantidad: cantidadVal,
    stockMinimo: stockMinVal,
    ultimaActualizacion: new Date().toISOString()
  };

  const esEdicion = !!idFirebase;

  if (window.guardarItemFirebase) {
    window.guardarItemFirebase(itemData, idFirebase ? idFirebase : null)
      .then(() => {
        if (window.registrarMovimientoFirebase) {
          window.registrarMovimientoFirebase({
            codigo: itemData.codigo,
            nombre: itemData.nombre,
            tipo: esEdicion ? "Edición" : "Registro",
            cantidad: itemData.cantidad
          });
        }
        resetearFormulario();
      })
      .catch((err) => {
        console.error("Error al guardar en Firebase: ", err);
        alert("Error de conexión al guardar el registro.");
      });
  }
}

// Incremento / Decremento Concurrente
window.modificarStockRápido = function(idFirebase, delta) {
  const item = listaInventarioGlobal.find(i => i.idFirebase === idFirebase);
  if (!item) return;

  if (window.modificarStockAtomico) {
    window.modificarStockAtomico(idFirebase, delta)
      .then(() => {
        if (window.registrarMovimientoFirebase) {
          window.registrarMovimientoFirebase({
            codigo: item.codigo,
            nombre: item.nombre,
            tipo: delta > 0 ? "Entrada (+1)" : "Salida (-1)",
            cantidad: 1
          });
        }
      })
      .catch(err => console.error("Error en transacción atómica: ", err));
  }
};

window.prepararEdicion = function(idFirebase) {
  const item = listaInventarioGlobal.find(i => i.idFirebase === idFirebase);
  if (!item) return;

  document.getElementById("itemIdFirebase").value = item.idFirebase;
  document.getElementById("categoria").value = item.categoria || '';
  document.getElementById("codigo").value = item.codigo;
  document.getElementById("nombre").value = item.nombre;
  document.getElementById("estadoActivo").value = item.estadoActivo || 'En Bodega';
  
  toggleCamposUbicacion(item.estadoActivo || 'En Bodega');

  document.getElementById("ubicacionBodega").value = item.ubicacionBodega || '';
  document.getElementById("lugarAsignacion").value = item.lugarAsignacion || '';
  document.getElementById("responsable").value = item.responsable || '';
  document.getElementById("cantidad").value = item.cantidad;
  document.getElementById("stockMinimo").value = item.stockMinimo;

  document.getElementById("btnGuardar").innerHTML = `<i class="fa-solid fa-pen-to-square me-1"></i> Actualizar Registro`;
  document.getElementById("btnCancelarEdicion").classList.remove("d-none");
};

function resetearFormulario() {
  document.getElementById("formInventario").reset();
  document.getElementById("itemIdFirebase").value = "";
  toggleCamposUbicacion("En Bodega");
  document.getElementById("btnGuardar").innerHTML = `<i class="fa-solid fa-floppy-disk me-1"></i> Guardar Registro`;
  document.getElementById("btnCancelarEdicion").classList.add("d-none");
}

window.confirmarEliminacion = function(idFirebase) {
  const item = listaInventarioGlobal.find(i => i.idFirebase === idFirebase);
  if (!item) return;

  if (confirm(`¿Confirma eliminar el registro (${item.codigo}) ${item.nombre}?`)) {
    if (window.eliminarItemFirebase) {
      window.eliminarItemFirebase(idFirebase)
        .then(() => {
          if (window.registrarMovimientoFirebase) {
            window.registrarMovimientoFirebase({
              codigo: item.codigo,
              nombre: item.nombre,
              tipo: "Eliminación",
              cantidad: item.cantidad
            });
          }
        })
        .catch(err => console.error("Error al eliminar registro: ", err));
    }
  }
};

// Control de Lector de Cámara
function iniciarCamaraEscaner() {
  html5QrCode = new Html5Qrcode("reader");
  const config = { fps: 10, qrbox: { width: 250, height: 150 } };

  html5QrCode.start(
    { facingMode: "environment" },
    config,
    (decodedText) => {
      document.getElementById("codigo").value = sanitizeText(decodedText);
      emitirBeepConfirmacion();
      
      const modal = bootstrap.Modal.getInstance(document.getElementById('modalEscaner'));
      if (modal) modal.hide();
    },
    () => {}
  ).catch(err => {
    console.error("Error al iniciar la cámara: ", err);
    alert("No se pudo iniciar la cámara. Verifique los permisos en el navegador.");
  });
}

function detenerCamaraEscaner() {
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
    }).catch(err => console.error("Error deteniendo el visor de cámara: ", err));
  }
}

// Alertas Stock Mínimo
function actualizarAlertas(items) {
  const tbodyAlertas = document.getElementById("tbodyAlertas");
  const badge = document.getElementById("badgeAlertas");
  tbodyAlertas.innerHTML = "";

  const criticos = items.filter(i => parseInt(i.cantidad) <= parseInt(i.stockMinimo));

  if (criticos.length > 0) {
    badge.textContent = criticos.length;
    badge.classList.remove("d-none");
  } else {
    badge.classList.add("d-none");
  }

  if (criticos.length === 0) {
    tbodyAlertas.innerHTML = `<tr><td colspan="5" class="text-center text-success py-3"><i class="fa-solid fa-circle-check me-1"></i> No existen productos bajo el stock mínimo.</td></tr>`;
    return;
  }

  criticos.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong class="font-mono">${sanitizeText(item.codigo)}</strong></td>
      <td>${sanitizeText(item.nombre)}</td>
      <td><span class="badge bg-danger">${parseInt(item.cantidad)}</span></td>
      <td>${parseInt(item.stockMinimo)}</td>
      <td><span class="text-danger fw-bold"><i class="fa-solid fa-circle-exclamation me-1"></i> Reabastecer</span></td>
    `;
    tbodyAlertas.appendChild(tr);
  });
}

// Orden de Requerimiento (Sin logo)
function renderizarOrdenRequerimiento(items) {
  const tbodyReq = document.getElementById("tbodyOrdenRequerimiento");
  tbodyReq.innerHTML = "";

  const reponer = items.filter(i => parseInt(i.cantidad) <= parseInt(i.stockMinimo));

  if (reponer.length === 0) {
    tbodyReq.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">Todos los productos tienen existencias suficientes.</td></tr>`;
    return;
  }

  reponer.forEach(item => {
    const sugerido = (parseInt(item.stockMinimo) * 2) - parseInt(item.cantidad);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-mono">${sanitizeText(item.codigo)}</td>
      <td>${sanitizeText(item.nombre)}</td>
      <td class="text-center">${parseInt(item.cantidad)}</td>
      <td class="text-center">${parseInt(item.stockMinimo)}</td>
      <td class="text-center fw-bold text-primary">${sugerido > 0 ? sugerido : parseInt(item.stockMinimo)}</td>
    `;
    tbodyReq.appendChild(tr);
  });
}

function actualizarFechaFolioOrden() {
  const hoy = new Date();
  document.getElementById("reqFecha").textContent = hoy.toLocaleDateString("es-CO");
  document.getElementById("reqFolio").textContent = `#REQ-${hoy.getFullYear()}${(hoy.getMonth()+1).toString().padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// Exportaciones
function exportarExcel() {
  const dataExport = listaInventarioGlobal.map(item => ({
    "Código": item.codigo,
    "Nombre": item.nombre,
    "Categoría": item.categoria || 'N/A',
    "Estado": item.estadoActivo || 'En Bodega',
    "Ubicación Bodega": item.ubicacionBodega || 'N/A',
    "Lugar Asignación": item.lugarAsignacion || 'N/A',
    "Responsable": item.responsable || 'N/A',
    "Cantidad": item.cantidad,
    "Stock Mínimo": item.stockMinimo
  }));

  const worksheet = XLSX.utils.json_to_sheet(dataExport);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
  XLSX.writeFile(workbook, "Inventario_General.xlsx");
}

function exportarWord() {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType } = window.docx;

  const tableRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Código", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Producto", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Estado", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Cantidad", bold: true })] })] }),
      ],
    }),
  ];

  listaInventarioGlobal.forEach(item => {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(item.codigo || '')] }),
          new TableCell({ children: [new Paragraph(item.nombre || '')] }),
          new TableCell({ children: [new Paragraph(item.estadoActivo || 'En Bodega')] }),
          new TableCell({ children: [new Paragraph(String(item.cantidad || 0))] }),
        ],
      })
    );
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          children: [new TextRun({ text: "Reporte de Inventario de Activos", bold: true, size: 30 })],
          space: { after: 300 }
        }),
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE }
        })
      ]
    }]
  });

  Packer.toBlob(doc).then(blob => {
    saveAs(blob, "Reporte_Inventario.docx");
  });
}

function exportarPDF() {
  const elemento = document.getElementById("ordenDocumento");
  const opt = {
    margin:       0.5,
    filename:     'Orden_Requerimiento.pdf',
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(elemento).save();
}
