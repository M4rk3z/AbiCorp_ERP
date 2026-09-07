// Centro de cumplimiento de RH. Se descarga únicamente cuando un usuario autorizado lo abre.
export function createHrComplianceModule(context) {
  const { $, $$, api, hasPermission, entityDialog, escapeHtml, toast, formatDate, formatDateOnly, emptyMarkup } = context;
  const content = () => $("#entity-modal-content");

  async function open() {
    try {
      const data = await api("/api/hr/compliance", { cache: false });
      renderControl(data);
      if (!entityDialog.open) entityDialog.showModal();
    } catch (error) { toast(error.message, "error"); }
  }

  function renderControl(data) {
    content().classList.add("wide", "hr-compliance-modal");
    const cases = data.cases.map((row) => `
      <button class="hr-compliance-case" type="button" data-compliance-case="${row.id}">
        <span class="hr-case-severity is-${row.severity}">${severity(row.severity)}</span>
        <span class="hr-case-main"><strong>${escapeHtml(`${row.folio} · ${row.title}`)}</strong><small>${escapeHtml(`${category(row.category)} · ${reporter(row)}`)}</small></span>
        <span class="hr-case-owner"><strong>${escapeHtml(row.investigator_name || "Sin responsable")}</strong><small>${row.evidence_count} evidencia(s)</small></span>
        <span class="hr-case-status is-${row.status}">${status(row.status)}</span><b>→</b>
      </button>`).join("");
    content().innerHTML = `<section class="hr-compliance-center">
      <div class="modal-head"><div><span class="eyebrow">RECURSOS HUMANOS · CUMPLIMIENTO</span><h2>Canal confidencial</h2><p class="muted">Casos protegidos, evidencias y decisiones con historial permanente.</p></div><button type="button" data-close-modal>×</button></div>
      <section class="hr-compliance-hero"><div><span>PROTECCIÓN ACTIVA</span><h3>Escuchar, investigar y resolver</h3><p>La identidad, las evidencias y las decisiones permanecen restringidas a usuarios autorizados. Todo caso incluye protección contra represalias.</p></div>${hasPermission("hr.compliance.manage") ? '<button class="button light" type="button" data-new-grievance>＋ Registrar caso</button>' : ""}</section>
      <section class="hr-compliance-metrics"><article><small>ABIERTOS</small><strong>${data.indicators.open}</strong><span>requieren seguimiento</span></article><article class="critical"><small>CRÍTICOS</small><strong>${data.indicators.critical}</strong><span>atención prioritaria</span></article><article><small>SIN RESPONSABLE</small><strong>${data.indicators.unassigned}</strong><span>pendientes de asignar</span></article><article><small>RESUELTOS</small><strong>${data.indicators.resolved}</strong><span>con trazabilidad</span></article></section>
      <section class="hr-compliance-list"><div class="panel-head"><div><h3>Expedientes confidenciales</h3><p>Sólo se muestra la información necesaria para identificar el caso.</p></div><span>${data.cases.length} REGISTRO(S)</span></div>${cases || emptyMarkup("Sin casos registrados", "Cuando se registre un caso aparecerá en esta bandeja protegida.")}</section>
    </section>`;
    resetScroll();
    $("[data-new-grievance]")?.addEventListener("click", () => renderCreate(data));
    $$('[data-compliance-case]').forEach((button) => button.onclick = () => openDetail(Number(button.dataset.complianceCase)));
  }

  function renderCreate(data) {
    const employees = data.employees.map((row) => `<option value="${row.id}">${escapeHtml(`${row.employee_number} · ${row.full_name}`)}</option>`).join("");
    content().innerHTML = `<form id="hr-grievance-form" class="hr-grievance-form">
      <div class="modal-head"><div><span class="eyebrow">NUEVO EXPEDIENTE CONFIDENCIAL</span><h2>Registrar un caso</h2><p class="muted">Captura hechos verificables. No incluyas datos personales innecesarios.</p></div><button type="button" data-close-modal>×</button></div>
      <div class="hr-confidential-notice"><b>◈</b><div><strong>Protección contra represalias activa</strong><span>El acceso y cada cambio quedarán registrados en la bitácora.</span></div></div>
      <div class="form-grid">
        <label>Asunto<input name="title" maxlength="180" required></label>
        <label>Categoría<select name="category" required><option value="">Selecciona</option><option value="harassment">Acoso</option><option value="discrimination">Discriminación</option><option value="retaliation">Represalia</option><option value="labor">Condición laboral</option><option value="safety">Seguridad</option><option value="ethics">Ética</option><option value="other">Otra</option></select></label>
        <label>Severidad<select name="severity"><option value="low">Baja</option><option value="medium" selected>Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
        <label>Canal<select name="channel"><option value="internal">Registro interno</option><option value="portal">Portal</option><option value="email">Correo</option><option value="phone">Teléfono</option><option value="in_person">Presencial</option><option value="other">Otro</option></select></label>
        <label>Tipo de reporte<select name="reporterType" id="hr-grievance-reporter"><option value="anonymous">Anónimo</option><option value="employee">Colaborador identificado</option><option value="third_party">Tercero identificado</option></select></label>
        <label data-grievance-employee class="hidden">Colaborador<select name="reporterEmployeeId"><option value="">Selecciona</option>${employees}</select></label>
        <label data-grievance-contact class="hidden">Contacto seguro<input name="reporterContact" maxlength="240"></label>
        <label>Fecha del hecho<input name="occurredOn" type="date"></label><label>Lugar<input name="location" maxlength="240"></label>
        <label>Personas señaladas<input name="subjectNames" maxlength="500"></label><label>Fecha objetivo<input name="targetDate" type="date"></label>
        <label>Confidencialidad<select name="confidentiality"><option value="strict">Estricta</option><option value="restricted">Restringida</option></select></label>
      </div>
      <label>Descripción de los hechos<textarea name="description" rows="6" maxlength="4000" required></textarea></label>
      <p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-back-compliance>Volver</button><button class="button primary" type="submit">Registrar de forma segura</button></div>
    </form>`;
    resetScroll();
    const reporterSelect = $("#hr-grievance-reporter");
    const syncReporter = () => {
      $("[data-grievance-employee]").classList.toggle("hidden", reporterSelect.value !== "employee");
      $("[data-grievance-contact]").classList.toggle("hidden", reporterSelect.value === "anonymous");
    };
    reporterSelect.onchange = syncReporter; syncReporter();
    $("[data-back-compliance]").onclick = open;
    $("#hr-grievance-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector('[type="submit"]'), errorBox = form.querySelector(".form-error");
      button.disabled = true; button.textContent = "Protegiendo información…";
      try {
        const result = await api("/api/hr/compliance/grievances", { method: "POST", body: Object.fromEntries(new FormData(form)) });
        toast(`Caso ${result.folio} registrado de forma confidencial.`); await openDetail(result.id);
      } catch (error) {
        errorBox.textContent = error.message; errorBox.classList.remove("hidden"); button.disabled = false; button.textContent = "Registrar de forma segura";
      }
    };
  }

  async function openDetail(id) {
    try {
      const [detail, control] = await Promise.all([
        api(`/api/hr/compliance/grievances/${id}`, { cache: false }),
        api("/api/hr/compliance", { cache: false }),
      ]);
      renderDetail(detail, control);
    } catch (error) { toast(error.message, "error"); }
  }

  function renderDetail(detail, control) {
    const row = detail.case;
    const investigators = control.users.map((user) => `<option value="${user.id}" ${Number(row.investigator_user_id) === Number(user.id) ? "selected" : ""}>${escapeHtml(`${user.full_name} · ${user.username}`)}</option>`).join("");
    const history = detail.history.map((item) => `<div class="hr-case-history-item"><i></i><div><strong>${escapeHtml(actionLabel(item.action))}</strong><span>${escapeHtml(item.comment || status(item.next_status))}</span><small>${escapeHtml(item.actor_name || "Sistema")} · ${formatDate(item.created_at)}</small></div></div>`).join("");
    const evidence = detail.evidence.map((item) => `<article class="hr-case-evidence"><span>${escapeHtml(item.evidence_type.toUpperCase())}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description || item.external_reference || "Sin descripción")}</p><small>${escapeHtml(item.created_by_name || "Sistema")} · ${formatDate(item.created_at)}</small></div></article>`).join("");
    const allowedActions = caseActions(row.status).filter((item) => hasPermission(item.permission));
    content().innerHTML = `<section class="hr-case-detail">
      <div class="modal-head"><div><span class="eyebrow">${escapeHtml(row.folio)}</span><h2>${escapeHtml(row.title)}</h2><p class="muted">Expediente de acceso restringido · protección contra represalias activa</p></div><button type="button" data-close-modal>×</button></div>
      <div class="hr-case-detail-top"><div class="hr-case-summary"><div class="hr-case-tags"><span class="hr-case-severity is-${row.severity}">${severity(row.severity)}</span><span class="hr-case-status is-${row.status}">${status(row.status)}</span></div><small>${escapeHtml(`${category(row.category)} · ${reporter(row)}`)}</small><p>${escapeHtml(row.description)}</p><dl><div><dt>Fecha del hecho</dt><dd>${row.occurred_on ? formatDateOnly(row.occurred_on) : "No indicada"}</dd></div><div><dt>Lugar</dt><dd>${escapeHtml(row.location || "No indicado")}</dd></div><div><dt>Responsable</dt><dd>${escapeHtml(row.investigator_name || "Sin asignar")}</dd></div><div><dt>Fecha objetivo</dt><dd>${row.target_date ? formatDateOnly(row.target_date) : "Sin definir"}</dd></div></dl></div>
      <aside class="hr-case-controls"><h3>Gestión del caso</h3>${hasPermission("hr.grievances.investigate") ? `<form id="hr-case-assign"><label>Responsable<select name="investigatorUserId" required><option value="">Selecciona</option>${investigators}</select></label><button class="button ghost wide" type="submit">Asignar responsable</button></form>` : ""}${allowedActions.length ? `<label>Comentario / resolución<textarea id="hr-case-comment" rows="4" placeholder="Documenta la decisión y sus motivos."></textarea></label><div class="hr-case-action-buttons">${allowedActions.map((item) => `<button class="button ${item.primary ? "primary" : "ghost"}" type="button" data-case-action="${item.id}">${item.label}</button>`).join("")}</div>` : ""}</aside></div>
      <div class="hr-case-columns"><section><div class="panel-head"><div><h3>Evidencias</h3><p>Referencias protegidas relacionadas con el caso.</p></div></div>${evidence || emptyMarkup("Sin evidencias", "Registra notas, correos, documentos o referencias verificables.")}${hasPermission("hr.compliance.manage") ? `<form id="hr-case-evidence-form" class="hr-evidence-form"><label>Tipo<select name="evidenceType"><option value="note">Nota</option><option value="document">Documento</option><option value="email">Correo</option><option value="photo">Fotografía</option><option value="link">Enlace</option><option value="other">Otra</option></select></label><label>Título<input name="title" maxlength="180" required></label><label class="span-2">Descripción<textarea name="description" rows="3" maxlength="2000"></textarea></label><label class="span-2">Referencia externa<input name="externalReference" maxlength="500"></label><button class="button ghost" type="submit">＋ Agregar evidencia</button></form>` : ""}</section><section><div class="panel-head"><div><h3>Historial protegido</h3><p>No se reemplazan decisiones anteriores.</p></div></div><div class="hr-case-history">${history}</div></section></div>
      <div class="modal-actions"><button class="button ghost" type="button" data-back-compliance>Volver a casos</button></div>
    </section>`;
    resetScroll();
    $("[data-back-compliance]").onclick = open;
    $("#hr-case-assign")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      await submitAction(row.id, "assign", "Responsable asignado para investigación.", Number(form.get("investigatorUserId")));
    });
    $$('[data-case-action]').forEach((button) => button.onclick = () => submitAction(row.id, button.dataset.caseAction, $("#hr-case-comment")?.value || ""));
    $("#hr-case-evidence-form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type="submit"]'); button.disabled = true; button.textContent = "Guardando evidencia…";
      try { await api(`/api/hr/compliance/grievances/${row.id}/evidence`, { method: "POST", body: Object.fromEntries(new FormData(form)) }); toast("Evidencia registrada."); await openDetail(row.id); }
      catch (error) { toast(error.message, "error"); button.disabled = false; button.textContent = "＋ Agregar evidencia"; }
    });
  }

  async function submitAction(id, action, comment, investigatorUserId = null) {
    const actionButtons = $$('[data-case-action], #hr-case-assign button');
    actionButtons.forEach((button) => { button.disabled = true; });
    try {
      await api(`/api/hr/compliance/grievances/${id}/action`, { method: "POST", body: { action, comment, investigatorUserId } });
      toast("Caso actualizado con trazabilidad."); await openDetail(id);
    } catch (error) {
      toast(error.message, "error");
      actionButtons.forEach((button) => { button.disabled = false; });
    }
  }

  function caseActions(value) {
    return ({
      received: [{ id: "triage", label: "Iniciar clasificación", permission: "hr.grievances.investigate" }, { id: "investigate", label: "Iniciar investigación", permission: "hr.grievances.investigate", primary: true }, { id: "dismiss", label: "Desestimar", permission: "hr.grievances.resolve" }],
      triage: [{ id: "investigate", label: "Iniciar investigación", permission: "hr.grievances.investigate", primary: true }, { id: "dismiss", label: "Desestimar", permission: "hr.grievances.resolve" }],
      investigating: [{ id: "plan", label: "Crear plan de acción", permission: "hr.grievances.investigate" }, { id: "resolve", label: "Resolver caso", permission: "hr.grievances.resolve", primary: true }],
      action_plan: [{ id: "resolve", label: "Resolver caso", permission: "hr.grievances.resolve", primary: true }],
      resolved: [{ id: "reopen", label: "Reabrir", permission: "hr.grievances.resolve" }, { id: "close", label: "Cerrar expediente", permission: "hr.grievances.resolve", primary: true }],
      closed: [{ id: "reopen", label: "Reabrir", permission: "hr.grievances.resolve" }],
      dismissed: [{ id: "reopen", label: "Reabrir", permission: "hr.grievances.resolve" }],
    })[value] || [];
  }

  const status = (value) => ({ received: "Recibido", triage: "Clasificación", investigating: "Investigando", action_plan: "Plan de acción", resolved: "Resuelto", closed: "Cerrado", dismissed: "Desestimado" })[value] || value;
  const severity = (value) => ({ low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" })[value] || value;
  const category = (value) => ({ harassment: "Acoso", discrimination: "Discriminación", retaliation: "Represalia", labor: "Condición laboral", safety: "Seguridad", ethics: "Ética", other: "Otra" })[value] || value;
  const reporter = (row) => row.reporter_type === "anonymous" ? "Reporte anónimo" : row.reporter_type === "employee" ? (row.reporter_employee_name || "Colaborador protegido") : "Tercero identificado";
  const actionLabel = (value) => ({ created: "Caso recibido", assign: "Responsable asignado", triage: "Clasificación iniciada", investigate: "Investigación iniciada", plan: "Plan de acción", resolve: "Caso resuelto", close: "Expediente cerrado", reopen: "Caso reabierto", dismiss: "Caso desestimado", evidence_added: "Evidencia agregada" })[value] || value;
  function resetScroll() { entityDialog.scrollTop = 0; content().scrollTop = 0; }

  return { open };
}
