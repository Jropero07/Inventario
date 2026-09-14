/* =========================================================
   SISTEMA DE CONTROL E INVENTARIO
   app.js - lógica completa sin backend
   ========================================================= */

(() => {
  "use strict";

  const STORAGE_KEY = "inventarioTI_v1";
  const todayISO = () => new Date().toISOString().slice(0,10);

  const defaultDB = {
    assets: [],
    consumables: [],
    meta: { nextOrderNumber: 1 }
  };

  let db = loadDB();
  let currentTab = "assets";
  let editingAssetId = null;
  let editingConsumableId = null;

  const $ = id => document.getElementById(id);
  const normalize = value => String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  function loadDB() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultDB);
      const parsed = JSON.parse(raw);
      return {
        assets: Array.isArray(parsed.assets) ? parsed.assets : [],
        consumables: Array.isArray(parsed.consumables) ? parsed.consumables : [],
        meta: { ...defaultDB.meta, ...(parsed.meta || {}) }
      };
    } catch {
      return structuredClone(defaultDB);
    }
  }

  function saveDB() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  }

  function formatDate(date) {
    if (!date) return "—";
    const [y,m,d] = date.split("-");
    return y && m && d ? `${d}/${m}/${y}` : date;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  function showToast(message, type="") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    $("toastContainer").appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function statusClass(status) {
    return {
      "Disponible":"available",
      "Asignado":"assigned",
      "Mantenimiento":"maintenance",
      "Baja":"retired"
    }[status] || "";
  }

  function isCritical(item) {
    return Number(item.stock) <= Number(item.minStock);
  }

  function getCritical() {
    return db.consumables.filter(isCritical);
  }

  function activeFilters() {
    return {
      search: normalize($("globalSearch").value),
      type: $("typeFilter").value,
      status: $("statusFilter").value,
      category: $("categoryFilter").value
    };
  }

  function matchesCommon(item, type, filters) {
    if (filters.type && filters.type !== type) return false;
    if (type === "Activo Fijo" && filters.status && item.status !== filters.status) return false;
    if (type === "Consumible" && filters.category && item.category !== filters.category) return false;
    if (!filters.search) return true;
    return normalize(Object.values(item).join(" ")).includes(filters.search);
  }

  function getFilteredAssets() {
    const f = activeFilters();
    return db.assets.filter(a => matchesCommon(a, "Activo Fijo", f));
  }

  function getFilteredConsumables() {
    const f = activeFilters();
    return db.consumables.filter(c => matchesCommon(c, "Consumible", f));
  }

  function updateCategoryFilter() {
    const select = $("categoryFilter");
    const current = select.value;
    const categories = [...new Set(db.consumables.map(c => c.category).filter(Boolean))].sort((a,b) => a.localeCompare(b,"es"));
    select.innerHTML = '<option value="">Todas las categorías</option>' +
      categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
    if (categories.includes(current)) select.value = current;
  }

  function renderStats() {
    const assets = db.assets;
    $("statAssets").textContent = assets.length;
    $("statAvailable").textContent = assets.filter(a => a.status === "Disponible").length;
    $("statAssigned").textContent = assets.filter(a => a.status === "Asignado").length;
    $("statMaintenance").textContent = assets.filter(a => a.status === "Mantenimiento").length;

    $("statConsumables").textContent = db.consumables.length;
    $("statCritical").textContent = getCritical().length;
    $("statCategories").textContent = new Set(db.consumables.map(c => c.category)).size;
    $("criticalCount").textContent = `${getCritical().length} críticos`;
  }

  function renderAssets() {
    const rows = getFilteredAssets();
    $("assetCount").textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"}`;
    $("assetEmpty").style.display = rows.length ? "none" : "block";
    $("assetTableBody").innerHTML = rows.map(a => `
      <tr>
        <td>${escapeHTML(a.brand)}</td>
        <td>${escapeHTML(a.model)}</td>
        <td><strong>${escapeHTML(a.serial)}</strong></td>
        <td>${formatDate(a.entryDate)}</td>
        <td>${formatDate(a.exitDate)}</td>
        <td><span class="badge ${statusClass(a.status)}">${escapeHTML(a.status)}</span></td>
        <td>${escapeHTML(a.responsible || "—")}</td>
        <td><div class="action-group">
          <button class="action-btn" data-action="edit-asset" data-id="${a.id}">Editar</button>
          <button class="action-btn danger" data-action="delete-asset" data-id="${a.id}">Eliminar</button>
        </div></td>
      </tr>`).join("");
  }

  function renderConsumables() {
    const rows = getFilteredConsumables();
    $("consumableCount").textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"}`;
    $("consumableEmpty").style.display = rows.length ? "none" : "block";
    $("consumableTableBody").innerHTML = rows.map(c => {
      const critical = isCritical(c);
      return `<tr>
        <td><strong>${escapeHTML(c.name)}</strong></td>
        <td>${escapeHTML(c.category)}</td>
        <td>${escapeHTML(c.unit)}</td>
        <td>${formatDate(c.entryDate)}</td>
        <td class="${critical ? "critical-number" : ""}">${c.stock}</td>
        <td>${c.minStock}</td>
        <td><span class="badge ${critical ? "critical" : "ok"}">${critical ? "Crítico" : "Normal"}</span></td>
        <td><div class="action-group">
          <button class="action-btn" data-action="edit-consumable" data-id="${c.id}">Editar</button>
          <button class="action-btn danger" data-action="delete-consumable" data-id="${c.id}">Eliminar</button>
        </div></td>
      </tr>`;
    }).join("");
  }

  function renderAlerts() {
    const rows = getCritical();
    $("alertEmpty").style.display = rows.length ? "none" : "block";
    $("alertTableBody").innerHTML = rows.map(c => {
      const suggested = Math.max(1, Number(c.minStock) - Number(c.stock));
      return `<tr>
        <td><strong>${escapeHTML(c.name)}</strong></td>
        <td>${escapeHTML(c.category)}</td>
        <td>${escapeHTML(c.unit)}</td>
        <td class="critical-number">${c.stock}</td>
        <td>${c.minStock}</td>
        <td><strong>${suggested}</strong></td>
        <td><button class="action-btn" data-action="edit-consumable" data-id="${c.id}">Editar</button></td>
      </tr>`;
    }).join("");
  }

  function renderAll() {
    updateCategoryFilter();
    renderStats();
    renderAssets();
    renderConsumables();
    renderAlerts();
    saveDB();
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${tab}`));
    const titles = {assets:"Gestión de Activos Fijos",consumables:"Gestión de Consumibles",alerts:"Alertas y Requerimientos"};
    $("pageTitle").textContent = titles[tab];
    if (window.innerWidth <= 760) $("sidebar").classList.remove("open");
  }

  function resetAssetForm() {
    editingAssetId = null;
    $("assetId").value = "";
    $("assetForm").reset();
    $("assetEntryDate").value = todayISO();
    $("assetSubmitBtn").textContent = "Guardar activo";
    $("cancelAssetEditBtn").hidden = true;
  }

  function resetConsumableForm() {
    editingConsumableId = null;
    $("consumableId").value = "";
    $("consumableForm").reset();
    $("consumableEntryDate").value = todayISO();
    $("consumableSubmitBtn").textContent = "Guardar consumible";
    $("cancelConsumableEditBtn").hidden = true;
  }

  function editAsset(id) {
    const a = db.assets.find(x => x.id === id);
    if (!a) return;
    editingAssetId = id;
    $("assetId").value = id;
    $("assetBrand").value = a.brand;
    $("assetModel").value = a.model;
    $("assetSerial").value = a.serial;
    $("assetEntryDate").value = a.entryDate;
    $("assetExitDate").value = a.exitDate || "";
    $("assetStatus").value = a.status;
    $("assetResponsible").value = a.responsible || "";
    $("assetSubmitBtn").textContent = "Actualizar activo";
    $("cancelAssetEditBtn").hidden = false;
    switchTab("assets");
    $("assetBrand").focus();
  }

  function editConsumable(id) {
    const c = db.consumables.find(x => x.id === id);
    if (!c) return;
    editingConsumableId = id;
    $("consumableId").value = id;
    $("consumableName").value = c.name;
    $("consumableCategory").value = c.category;
    $("consumableUnit").value = c.unit;
    $("consumableEntryDate").value = c.entryDate;
    $("consumableStock").value = c.stock;
    $("consumableMin").value = c.minStock;
    $("consumableSubmitBtn").textContent = "Actualizar consumible";
    $("cancelConsumableEditBtn").hidden = false;
    switchTab("consumables");
    $("consumableName").focus();
  }

  function deleteAsset(id) {
    const a = db.assets.find(x => x.id === id);
    if (!a || !confirm(`¿Eliminar el activo con serial "${a.serial}"?`)) return;
    db.assets = db.assets.filter(x => x.id !== id);
    renderAll();
    showToast("Activo eliminado.", "success");
  }

  function deleteConsumable(id) {
    const c = db.consumables.find(x => x.id === id);
    if (!c || !confirm(`¿Eliminar "${c.name}" del inventario?`)) return;
    db.consumables = db.consumables.filter(x => x.id !== id);
    renderAll();
    showToast("Consumible eliminado.", "success");
  }

  $("assetForm").addEventListener("submit", e => {
    e.preventDefault();
    const serial = $("assetSerial").value.trim();
    const duplicate = db.assets.some(a => normalize(a.serial) === normalize(serial) && a.id !== editingAssetId);
    if (duplicate) return showToast("El número de serie debe ser único.", "error");

    const item = {
      id: editingAssetId || uid("asset"),
      brand: $("assetBrand").value.trim(),
      model: $("assetModel").value.trim(),
      serial,
      entryDate: $("assetEntryDate").value,
      exitDate: $("assetExitDate").value,
      status: $("assetStatus").value,
      responsible: $("assetResponsible").value.trim()
    };
    if (editingAssetId) {
      const index = db.assets.findIndex(a => a.id === editingAssetId);
      db.assets[index] = item;
      showToast("Activo actualizado.", "success");
    } else {
      db.assets.push(item);
      showToast("Activo registrado.", "success");
    }
    resetAssetForm();
    renderAll();
  });

  $("consumableForm").addEventListener("submit", e => {
    e.preventDefault();
    const stock = Number($("consumableStock").value);
    const minStock = Number($("consumableMin").value);
    if (stock < 0 || minStock < 0) return showToast("El stock no puede ser negativo.", "error");

    const item = {
      id: editingConsumableId || uid("cons"),
      name: $("consumableName").value.trim(),
      category: $("consumableCategory").value.trim(),
      unit: $("consumableUnit").value.trim(),
      entryDate: $("consumableEntryDate").value,
      stock,
      minStock
    };
    if (editingConsumableId) {
      const index = db.consumables.findIndex(c => c.id === editingConsumableId);
      db.consumables[index] = item;
      showToast("Consumible actualizado.", "success");
    } else {
      db.consumables.push(item);
      showToast("Consumible registrado.", "success");
    }
    resetConsumableForm();
    renderAll();
  });

  $("assetForm").addEventListener("reset", () => setTimeout(() => {
    if (!editingAssetId) $("assetEntryDate").value = todayISO();
  }, 0));
  $("consumableForm").addEventListener("reset", () => setTimeout(() => {
    if (!editingConsumableId) $("consumableEntryDate").value = todayISO();
  }, 0));

  $("cancelAssetEditBtn").addEventListener("click", resetAssetForm);
  $("cancelConsumableEditBtn").addEventListener("click", resetConsumableForm);

  document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  $("globalSearch").addEventListener("input", renderAll);
  $("typeFilter").addEventListener("change", renderAll);
  $("statusFilter").addEventListener("change", renderAll);
  $("categoryFilter").addEventListener("change", renderAll);
  $("clearFiltersBtn").addEventListener("click", () => {
    $("globalSearch").value = "";
    $("typeFilter").value = "";
    $("statusFilter").value = "";
    $("categoryFilter").value = "";
    renderAll();
  });

  document.addEventListener("click", e => {
    const button = e.target.closest("[data-action]");
    if (!button) return;
    const {action,id} = button.dataset;
    if (action === "edit-asset") editAsset(id);
    if (action === "delete-asset") deleteAsset(id);
    if (action === "edit-consumable") editConsumable(id);
    if (action === "delete-consumable") deleteConsumable(id);
  });

  $("mobileMenu").addEventListener("click", () => $("sidebar").classList.toggle("open"));

  // ---------------- ORDEN DE REQUERIMIENTO ----------------

  let currentOrder = null;

  function nextFolio() {
    const number = Number(db.meta.nextOrderNumber || 1);
    return `OR-${String(number).padStart(6,"0")}`;
  }

  function generateOrder() {
    const critical = getCritical();
    if (!critical.length) {
      showToast("No hay consumibles en nivel crítico para generar una orden.", "error");
      return;
    }

    currentOrder = {
      folio: nextFolio(),
      date: todayISO(),
      items: critical.map(c => ({
        ...c,
        quantity: Math.max(1, Number(c.minStock) - Number(c.stock))
      }))
    };

    $("orderRequester").value = "";
    $("orderDepartment").value = "Departamento de Tecnología / Sistemas";
    $("orderPriority").value = "Crítico";
    $("orderStatus").value = "Pendiente de aprobación";
    $("orderJustification").value = "Se solicita la reposición de los materiales relacionados debido a que presentan un nivel de stock igual o inferior al mínimo establecido para garantizar la continuidad operativa.";
    updateOrderPreview();
    $("orderModal").hidden = false;
    $("orderModal").setAttribute("aria-hidden", "false");
  }

  function updateOrderPreview() {
    if (!currentOrder) return;
    $("orderFolio").textContent = currentOrder.folio;
    $("orderDate").textContent = formatDate(currentOrder.date);
    $("footerFolio").textContent = currentOrder.folio;

    $("previewRequester").textContent = $("orderRequester").value.trim() || "Por definir";
    $("previewDepartment").textContent = $("orderDepartment").value.trim() || "Por definir";
    $("previewPriority").textContent = $("orderPriority").value;
    $("previewStatus").textContent = $("orderStatus").value;
    $("previewJustification").textContent = $("orderJustification").value.trim();

    $("orderItems").innerHTML = currentOrder.items.map((c,i) => `
      <tr>
        <td>${i+1}</td>
        <td>${escapeHTML(c.name)}${c.category ? ` — ${escapeHTML(c.category)}` : ""}</td>
        <td class="stock-critical">${c.stock} ${escapeHTML(c.unit)}</td>
        <td>${c.minStock} ${escapeHTML(c.unit)}</td>
        <td><strong>${c.quantity} ${escapeHTML(c.unit)}</strong></td>
      </tr>`).join("");
  }

  $("generateOrderBtn").addEventListener("click", generateOrder);
  ["orderRequester","orderDepartment","orderPriority","orderStatus","orderJustification"].forEach(id => {
    $(id).addEventListener("input", updateOrderPreview);
    $(id).addEventListener("change", updateOrderPreview);
  });

  function closeOrderModal() {
    $("orderModal").hidden = true;
    $("orderModal").setAttribute("aria-hidden", "true");
  }

  $("closeOrderModal").addEventListener("click", closeOrderModal);

  $("orderModal").addEventListener("click", e => {
    if (e.target === $("orderModal")) closeOrderModal();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("orderModal").hidden) closeOrderModal();
  });

  function markOrderUsed() {
    db.meta.nextOrderNumber = Number(db.meta.nextOrderNumber || 1) + 1;
    saveDB();
  }

  async function downloadOrderPDF() {
    if (!currentOrder) return;
    if (typeof html2pdf === "undefined") return showToast("La librería PDF no está disponible.", "error");

    const paper = $("orderPaper");
    const filename = `Orden_Requerimiento_${currentOrder.folio}.pdf`;
    const options = {
      margin: 0,
      filename,
      image: {type:"jpeg",quality:.98},
      html2canvas: {scale:2,useCORS:true,backgroundColor:"#ffffff"},
      jsPDF: {unit:"mm",format:"a4",orientation:"portrait"}
    };
    try {
      await html2pdf().set(options).from(paper).save();
      markOrderUsed();
      showToast("Orden PDF generada.", "success");
    } catch (err) {
      console.error(err);
      showToast("No fue posible generar el PDF.", "error");
    }
  }

  async function downloadOrderWord() {
    if (!currentOrder) return;
    if (!window.docx || typeof saveAs !== "function") return showToast("La librería Word/FileSaver no está disponible.", "error");

    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, AlignmentType, WidthType, BorderStyle } = window.docx;

    const cell = text => new TableCell({
      children:[new Paragraph({children:[new TextRun({text:String(text),bold:true,size:18})]})]
    });
    const plain = text => new Paragraph({children:[new TextRun({text:String(text),size:18})]});

    const rows = [
      new TableRow({children:["N°","Descripción / Material","Stock Actual","Stock Mínimo","Cantidad a Solicitar"].map(cell)})
    ];
    currentOrder.items.forEach((c,i) => rows.push(new TableRow({
      children:[
        cell(i+1),
        cell(`${c.name} — ${c.category}`),
        cell(`${c.stock} ${c.unit}`),
        cell(`${c.minStock} ${c.unit}`),
        cell(`${c.quantity} ${c.unit}`)
      ]
    })));

    const doc = new Document({
      sections:[{
        properties:{page:{margin:{top:720,right:720,bottom:720,left:720}}},
        children:[
          new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"SISTEMA DE CONTROL E INVENTARIO",bold:true,size:28})]}),
          new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"DEPARTAMENTO DE TECNOLOGÍA / SISTEMAS",bold:true,size:20})]}),
          new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"ORDEN DE REQUERIMIENTO DE CONSUMIBLES",bold:true,size:22})]}),
          plain(""),
          new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[
            new TableRow({children:[cell("Folio"),cell(currentOrder.folio),cell("Fecha"),cell(formatDate(currentOrder.date))]}),
            new TableRow({children:[cell("Solicitante"),cell($("orderRequester").value.trim() || "Por definir"),cell("Área / Departamento"),cell($("orderDepartment").value.trim())]}),
            new TableRow({children:[cell("Prioridad"),cell($("orderPriority").value),cell("Estado"),cell($("orderStatus").value)]})
          ]}),
          plain(""),
          new Table({width:{size:100,type:WidthType.PERCENTAGE},rows}),
          plain(""),
          new Paragraph({children:[new TextRun({text:"JUSTIFICACIÓN",bold:true,size:20})]}),
          plain($("orderJustification").value.trim()),
          plain(""),
          plain(""),
          new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"______________________________                    ______________________________",size:18})]}),
          new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"Solicitado Por                                      Aprobado Por",bold:true,size:18})]})
        ]
      }]
    });

    try {
      const blob = await Packer.toBlob(doc);
      saveAs(blob, `Orden_Requerimiento_${currentOrder.folio}.docx`);
      markOrderUsed();
      showToast("Documento Word generado.", "success");
    } catch (err) {
      console.error(err);
      showToast("No fue posible generar el documento Word.", "error");
    }
  }

  $("downloadOrderPdfBtn").addEventListener("click", downloadOrderPDF);
  $("downloadOrderWordBtn").addEventListener("click", downloadOrderWord);

  // ---------------- EXPORTACIÓN GENERAL ----------------

  function exportExcel() {
    if (typeof XLSX === "undefined") return showToast("La librería Excel no está disponible.", "error");

    const assets = getFilteredAssets().map(a => ({
      Tipo:"Activo Fijo", Marca:a.brand, Modelo:a.model, "Número de Serie":a.serial,
      "Fecha de Ingreso":a.entryDate, "Fecha de Egreso":a.exitDate || "",
      Estado:a.status, Responsable:a.responsible || ""
    }));
    const consumables = getFilteredConsumables().map(c => ({
      Tipo:"Consumible", Nombre:c.name, Categoría:c.category, "Unidad de Medida":c.unit,
      "Fecha de Ingreso":c.entryDate, "Stock Actual":c.stock, "Stock Mínimo":c.minStock,
      Nivel:isCritical(c) ? "Crítico" : "Normal"
    }));

    const wb = XLSX.utils.book_new();
    const wsAssets = XLSX.utils.json_to_sheet(assets);
    const wsConsumables = XLSX.utils.json_to_sheet(consumables);
    XLSX.utils.book_append_sheet(wb, wsAssets, "Activos Fijos");
    XLSX.utils.book_append_sheet(wb, wsConsumables, "Consumibles");
    XLSX.writeFile(wb, `Inventario_${todayISO()}.xlsx`);
    showToast("Excel exportado correctamente.", "success");
  }

  async function exportGeneralPDF() {
    if (typeof html2pdf === "undefined") return showToast("La librería PDF no está disponible.", "error");

    const assets = getFilteredAssets();
    const consumables = getFilteredConsumables();
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "width:100%;padding:25px;font-family:Arial;color:#172033;background:#fff";
    wrapper.innerHTML = `
      <h1 style="margin:0 0 5px;font-size:20px">Sistema de Control e Inventario</h1>
      <p style="margin:0 0 18px;font-size:10px;color:#68758a">Exportación general · ${formatDate(todayISO())}</p>
      <h2 style="font-size:14px">Activos Fijos (${assets.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:8px">
        <thead><tr><th style="border:1px solid #ccc;padding:5px">Marca</th><th style="border:1px solid #ccc;padding:5px">Modelo</th><th style="border:1px solid #ccc;padding:5px">Serial</th><th style="border:1px solid #ccc;padding:5px">Estado</th><th style="border:1px solid #ccc;padding:5px">Responsable</th></tr></thead>
        <tbody>${assets.map(a=>`<tr><td style="border:1px solid #ddd;padding:5px">${escapeHTML(a.brand)}</td><td style="border:1px solid #ddd;padding:5px">${escapeHTML(a.model)}</td><td style="border:1px solid #ddd;padding:5px">${escapeHTML(a.serial)}</td><td style="border:1px solid #ddd;padding:5px">${escapeHTML(a.status)}</td><td style="border:1px solid #ddd;padding:5px">${escapeHTML(a.responsible)}</td></tr>`).join("")}</tbody>
      </table>
      <h2 style="font-size:14px;margin-top:20px">Consumibles (${consumables.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:8px">
        <thead><tr><th style="border:1px solid #ccc;padding:5px">Nombre</th><th style="border:1px solid #ccc;padding:5px">Categoría</th><th style="border:1px solid #ccc;padding:5px">Unidad</th><th style="border:1px solid #ccc;padding:5px">Stock</th><th style="border:1px solid #ccc;padding:5px">Mínimo</th><th style="border:1px solid #ccc;padding:5px">Nivel</th></tr></thead>
        <tbody>${consumables.map(c=>`<tr><td style="border:1px solid #ddd;padding:5px">${escapeHTML(c.name)}</td><td style="border:1px solid #ddd;padding:5px">${escapeHTML(c.category)}</td><td style="border:1px solid #ddd;padding:5px">${escapeHTML(c.unit)}</td><td style="border:1px solid #ddd;padding:5px">${c.stock}</td><td style="border:1px solid #ddd;padding:5px">${c.minStock}</td><td style="border:1px solid #ddd;padding:5px">${isCritical(c)?"CRÍTICO":"Normal"}</td></tr>`).join("")}</tbody>
      </table>`;
    document.body.appendChild(wrapper);

    try {
      await html2pdf().set({
        margin:8, filename:`Inventario_${todayISO()}.pdf`,
        image:{type:"jpeg",quality:.95}, html2canvas:{scale:2},
        jsPDF:{unit:"mm",format:"a4",orientation:"landscape"}
      }).from(wrapper).save();
      showToast("PDF general exportado.", "success");
    } catch (err) {
      console.error(err); showToast("No fue posible generar el PDF.", "error");
    } finally { wrapper.remove(); }
  }

  $("exportExcelBtn").addEventListener("click", exportExcel);
  $("exportPdfBtn").addEventListener("click", exportGeneralPDF);

  // ---------------- BACKUP / RESTORE ----------------

  $("backupBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(db,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Backup_Inventario_${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast("Copia de seguridad exportada.", "success");
  });

  $("restoreBtn").addEventListener("click", () => $("restoreInput").click());

  $("restoreInput").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.assets) || !Array.isArray(parsed.consumables)) throw new Error("Formato inválido");
      if (!confirm("Esto reemplazará los datos actuales del navegador. ¿Continuar?")) return;
      db = {
        assets: parsed.assets,
        consumables: parsed.consumables,
        meta: { ...defaultDB.meta, ...(parsed.meta || {}) }
      };
      saveDB();
      resetAssetForm(); resetConsumableForm(); renderAll();
      showToast("Copia de seguridad restaurada.", "success");
    } catch (err) {
      console.error(err);
      showToast("El archivo JSON no tiene un formato de respaldo válido.", "error");
    } finally {
      e.target.value = "";
    }
  });

  // Inicialización
  $("assetEntryDate").value = todayISO();
  $("consumableEntryDate").value = todayISO();
  renderAll();
})();
