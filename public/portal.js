const state = { companySlug: localStorage.getItem("abicorp_portal_company") || "", csrf: "", data: null, currentView: "home", documents: [], notifications: [], cfdi: [], team: null, editingRequestId: null, reviewingRequestId: null, clarifyingCfdiId: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const publicView = $("#public-view"), pinView = $("#pin-view"), appView = $("#app-view"), loading = $("#portal-loading");

boot();

async function boot() {
  bindBaseEvents();
  try {
    const companies = await fetch("/api/companies").then((response) => response.json()).then((data) => data.companies || []);
    const select = $("#portal-company");
    select.innerHTML = companies.map((company) => `<option value="${escapeAttr(company.slug)}">${escapeHtml(company.tradeName || company.legalName)}</option>`).join("");
    if (!state.companySlug || !companies.some((company) => company.slug === state.companySlug)) state.companySlug = companies[0]?.slug || "";
    select.value = state.companySlug;
    syncPortalCompanyName(companies);
    $("#company-field").hidden = companies.length < 2;
    select.addEventListener("change", () => { state.companySlug = select.value; localStorage.setItem("abicorp_portal_company", state.companySlug); syncPortalCompanyName(companies); });
    const status = await api("/api/portal/public", {}, false);
    $("#portal-disabled").hidden = status.enabled;
    $("#portal-login-form button[type=submit]").disabled = !status.enabled;
    if (status.enabled) await restoreSession();
  } catch (error) { showMessage("login-message", error.message); }
}

function syncPortalCompanyName(companies) {
  const company = companies.find((item) => item.slug === state.companySlug);
  const name = company?.tradeName || company?.legalName || "Empresa";
  $$('[data-portal-company-name]').forEach((element) => { element.textContent = name; });
}

function bindBaseEvents() {
  $("#portal-login-form").addEventListener("submit", login);
  $("#pin-form").addEventListener("submit", changePin);
  $("[data-show-pin]").addEventListener("click", (event) => {
    const input = event.currentTarget.closest(".pin-field").querySelector("input");
    input.type = input.type === "password" ? "text" : "password";
    event.currentTarget.textContent = input.type === "password" ? "Ver" : "Ocultar";
  });
  $("#portal-logout").addEventListener("click", logout);
  $("#mobile-menu").addEventListener("click", () => appView.classList.toggle("menu-open"));
  $("#portal-nav").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]"); if (!button) return;
    state.currentView = button.dataset.view; renderCurrentView(); appView.classList.remove("menu-open");
  });
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $("#request-form").addEventListener("submit", submitRequest);
  $("#request-form").elements.leaveType.addEventListener("change", updateRequestPolicyOptions);
  $("#request-form").elements.isUnpaid.addEventListener("change", updateRequestPolicyOptions);
  $("#review-form").addEventListener("submit", submitTeamReview);
  $("#document-form").addEventListener("submit", submitDocument);
  $("#portal-document-type").addEventListener("change", syncPortalDocumentRules);
  $("#cfdi-clarification-form").addEventListener("submit", submitCfdiClarification);
  $("#portal-body").addEventListener("click", portalBodyClick);
}

async function restoreSession() {
  try { await loadPortal(); } catch (error) { if (error.status !== 401) throw error; }
}

async function login(event) {
  event.preventDefault(); hideMessage("login-message");
  const form = new FormData(event.currentTarget);
  state.companySlug = $("#portal-company").value || state.companySlug;
  localStorage.setItem("abicorp_portal_company", state.companySlug);
  setLoading(true);
  try {
    const result = await api("/api/portal/login", { method: "POST", body: { employeeNumber: form.get("employeeNumber"), pin: form.get("pin") } }, false);
    state.csrf = result.csrfToken;
    if (result.requiresPinChange) return showOnly(pinView);
    await loadPortal();
  } catch (error) { showMessage("login-message", error.message); }
  finally { setLoading(false); }
}

async function changePin(event) {
  event.preventDefault(); hideMessage("pin-message");
  const form = new FormData(event.currentTarget), newPin = String(form.get("newPin") || ""), confirm = String(form.get("confirmPin") || "");
  if (newPin !== confirm) return showMessage("pin-message", "Los PIN no coinciden.");
  setLoading(true);
  try { await api("/api/portal/pin", { method: "POST", body: { newPin } }); await loadPortal(); }
  catch (error) { showMessage("pin-message", error.message); }
  finally { setLoading(false); }
}

async function loadPortal() {
  state.data = await api("/api/portal/me", {}, false); state.csrf = state.data.csrfToken;
  const employee = state.data.employee;
  $("#employee-name").textContent = employee.full_name;
  $("#employee-number").textContent = employee.employee_number;
  $("#employee-initials").textContent = initials(employee.full_name);
  $("#today-label").textContent = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  $("#team-nav").hidden = !state.data.hasDirectReports;
  $("#cfdi-nav").hidden = !state.data.permissions.viewCfdi;
  updateUnread(state.data.unreadNotifications);
  showOnly(appView); renderCurrentView();
}

async function logout() {
  setLoading(true);
  try { await api("/api/portal/logout", { method: "POST" }); }
  catch { /* La cookie se elimina también al recargar. */ }
  finally { state.data = null; state.csrf = ""; showOnly(publicView); setLoading(false); }
}

function renderCurrentView() {
  $$("#portal-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === state.currentView));
  const titles = { home: "Resumen", requests: "Solicitudes", schedule: "Mi horario", cfdi: "Recibos de nómina", documents: "Documentos", notifications: "Notificaciones", team: "Mi plantilla" };
  $("#view-title").textContent = titles[state.currentView] || "Portal";
  if (state.currentView === "home") renderHome();
  if (state.currentView === "requests") renderRequests();
  if (state.currentView === "schedule") renderSchedule();
  if (state.currentView === "cfdi") loadCfdiReceipts();
  if (state.currentView === "documents") loadDocuments();
  if (state.currentView === "notifications") loadNotifications();
  if (state.currentView === "team") loadTeam();
}

function renderHome() {
  const data = state.data, employee = data.employee, vacation = data.vacation;
  $("#portal-body").innerHTML = `<div class="hero-grid"><article class="welcome-card"><p class="eyebrow">BIENVENIDO AL PORTAL</p><h2>${greeting()}, ${escapeHtml(firstName(employee.full_name))}.</h2><p>Desde aquí puedes revisar tu información y mantener el seguimiento de tus solicitudes sin acudir físicamente a Recursos Humanos.</p>${data.permissions.createRequests ? '<button class="primary" data-new-request>Nueva solicitud →</button>' : ""}</article>
  <article class="balance-card"><p class="eyebrow">VACACIONES DISPONIBLES</p>${vacation ? `<div class="balance-number">${formatNumber(vacation.available)}</div><strong>días</strong><small>Saldo ${formatNumber(vacation.balance)} · Adelantados ${formatNumber(vacation.debt)}</small><div class="balance-meter"><i></i></div>` : '<div class="empty">Consulta no habilitada</div>'}</article></div>
  <div class="section-heading"><div><h2>Mi expediente</h2><p>Información laboral registrada por Recursos Humanos.</p></div></div>
  <div class="card-grid">${infoCard("Empresa", employee.company_name)}${infoCard("Centro de trabajo", employee.work_center_name)}${infoCard("Departamento", employee.department_name || employee.area_name)}${infoCard("Puesto", employee.job_position_name || employee.position)}${infoCard("Fecha de ingreso", dateLabel(employee.hire_date))}${infoCard("Tipo de contrato", employmentLabel(employee.contract_type || employee.employment_type))}</div>
  <div class="section-heading"><div><h2>Actividad reciente</h2><p>Últimas solicitudes creadas.</p></div><button class="link-button" data-view-link="requests">Ver historial →</button></div>${requestsTable(data.requests.slice(0,5))}`;
}

function renderRequests() {
  $("#portal-body").innerHTML = `<div class="section-heading"><div><h2>Historial de solicitudes</h2><p>Vacaciones, permisos e incapacidades.</p></div>${state.data.permissions.createRequests ? '<button class="primary" data-new-request>Nueva solicitud</button>' : ""}</div>${requestsTable(state.data.requests)}`;
}

function renderSchedule() {
  const schedule = state.data.schedule;
  if (!schedule) return $("#portal-body").innerHTML = '<div class="empty">La consulta de horarios no está habilitada.</div>';
  const entries = state.data.publishedSchedule || [];
  if (!entries.length) return $("#portal-body").innerHTML = `<div class="empty">${escapeHtml(schedule.description || "Aún no tienes un turno asignado.")}</div>`;
  const working = entries.filter((row) => row.calendar_status === "scheduled").length;
  const absences = entries.filter((row) => ["vacation", "permission", "incapacity"].includes(row.calendar_status)).length;
  const holidays = entries.filter((row) => row.calendar_status === "holiday").length;
  const firstDate = entries[0].work_date, lastDate = entries.at(-1).work_date;
  $("#portal-body").innerHTML = `<section class="portal-calendar-hero"><div><span class="eyebrow">AGENDA LABORAL PERSONAL</span><h2>${escapeHtml(schedule.name || "Mi horario")}</h2><p>Tu calendario se actualiza automáticamente con el turno asignado, días feriados y solicitudes aprobadas.</p></div><div class="portal-calendar-range"><small>PERIODO VISIBLE</small><strong>${dateLabel(firstDate)} — ${dateLabel(lastDate)}</strong></div></section>
  <div class="portal-calendar-summary"><article><strong>${working}</strong><span>jornadas programadas</span></article><article><strong>${absences}</strong><span>ausencias autorizadas</span></article><article><strong>${holidays}</strong><span>fechas feriadas</span></article></div>
  <div class="portal-calendar-legend"><span class="scheduled"><i></i>Jornada</span><span class="vacation"><i></i>Vacaciones</span><span class="permission"><i></i>Permiso</span><span class="incapacity"><i></i>Incapacidad</span><span class="holiday"><i></i>Feriado</span><span class="rest"><i></i>Descanso</span></div>
  <section class="portal-calendar"><div class="portal-calendar-weekdays">${["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map((day) => `<span>${day}</span>`).join("")}</div><div class="portal-calendar-days">${entries.map(portalCalendarDay).join("")}</div></section>`;
}

async function loadCfdiReceipts() {
  try {
    state.cfdi = (await api("/api/portal/payroll/cfdi", {}, false)).receipts;
    renderCfdiReceipts();
  } catch (error) { portalError(error); }
}

function renderCfdiReceipts() {
  $("#portal-body").innerHTML = `<div class="section-heading"><div><h2>Recibos CFDI de nómina</h2><p>Consulta XML y PDF, confirma la recepción o solicita una aclaración.</p></div><span class="count-pill">${state.cfdi.length} RECIBO(S)</span></div>${state.cfdi.length ? `<div class="review-grid">${state.cfdi.map((row) => `<article class="review-card"><div class="review-card-head"><div><small>${escapeHtml(row.uuid)}</small><h3>${moneyLabel(row.total, row.currency_code)}</h3></div><span class="badge ${row.confirmed_at ? "success" : "submitted"}">${row.confirmed_at ? "Recibido" : "Nuevo"}</span></div><p><strong>${row.payroll_type === "E" ? "Nómina extraordinaria" : "Nómina ordinaria"}</strong> · pago ${dateLabel(row.payment_date)}</p><p>Periodo ${dateLabel(row.period_start)} — ${dateLabel(row.period_end)}</p><div class="review-metrics"><span><strong>${moneyLabel(row.total_perceptions, row.currency_code)}</strong> percepciones</span><span><strong>${moneyLabel(row.total_deductions, row.currency_code)}</strong> deducciones</span></div><div class="cfdi-file-actions">${row.files.map((file) => `<a class="secondary compact" href="${apiUrl(`/api/portal/payroll/cfdi/${row.id}/files/${file.id}`)}">Descargar ${escapeHtml(file.file_type.toUpperCase())}</a>`).join("")}</div>${row.open_clarifications ? `<div class="review-history">${row.open_clarifications} aclaración(es) en seguimiento.</div>` : ""}<div class="dialog-actions">${row.confirmed_at ? "" : `<button class="primary" data-confirm-cfdi="${row.id}">Confirmar recepción</button>`}<button class="secondary" data-clarify-cfdi="${row.id}">Solicitar aclaración</button></div></article>`).join("")}</div>` : '<div class="empty">Aún no tienes CFDI de nómina disponibles.</div>'}`;
}

function moneyLabel(value, currency = "MXN") {
  return `${Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: currency || "MXN" })} ${currency || "MXN"}`;
}

async function loadDocuments() {
  try { state.documents = (await api("/api/portal/documents", {}, false)).documents; renderDocuments(); }
  catch (error) { portalError(error); }
}
function renderDocuments() {
  const button = state.data.permissions.uploadDocuments ? '<button class="primary" data-new-document>Adjuntar documento</button>' : "";
  const expiring = state.documents.filter((row) => row.expiry_date && Date.parse(`${row.expiry_date}T00:00:00`) >= Date.now()).length;
  $("#portal-body").innerHTML = `<section class="portal-document-hero"><div><span class="eyebrow">ARCHIVO PERSONAL PROTEGIDO</span><h2>Mis documentos</h2><p>Consulta las versiones vigentes de tu expediente y descarga cada archivo de forma segura.</p></div>${button}</section>
  <div class="portal-document-summary"><span><strong>${state.documents.length}</strong> documentos vigentes</span><span><strong>${expiring}</strong> con fecha de vencimiento</span></div>
  ${state.documents.length ? `<div class="portal-document-grid">${state.documents.map((row) => `<article class="portal-document-card"><div class="portal-document-icon">${documentIcon(row)}</div><div class="portal-document-card-main"><div class="portal-document-card-head"><span>${escapeHtml(row.document_type_name || row.sensitivity || "Documento")}</span><b>V${row.version_number}</b></div><h3>${escapeHtml(row.original_name)}</h3><p>${escapeHtml(row.description || "Documento del expediente laboral")}</p><div class="portal-document-meta"><span>Subido ${dateLabel(row.created_at)}</span>${row.issue_date ? `<span>Emitido ${dateLabel(row.issue_date)}</span>` : ""}${row.expiry_date ? `<span class="${Date.parse(`${row.expiry_date}T23:59:59`) < Date.now() ? "expired" : ""}">Vence ${dateLabel(row.expiry_date)}</span>` : ""}</div></div><a class="portal-document-download" href="${apiUrl(`/api/portal/documents/${row.id}/download`)}">Descargar <span>↓</span></a></article>`).join("")}</div>` : '<div class="empty">No hay documentos disponibles.</div>'}`;
}

async function loadNotifications() {
  try { state.notifications = (await api("/api/portal/notifications", {}, false)).notifications; renderNotifications(); }
  catch (error) { portalError(error); }
}
function renderNotifications() {
  $("#portal-body").innerHTML = `<div class="section-heading"><div><h2>Centro de notificaciones</h2><p>Avisos y movimientos de tus solicitudes.</p></div></div><div class="notification-list">${state.notifications.length ? state.notifications.map((row) => `<article class="notification ${row.is_read ? "" : "unread"}"><i></i><div><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.message)}</p></div><div><small>${dateLabel(row.created_at)}</small>${row.is_read ? "" : `<button class="link-button" data-read-notification="${row.id}">Marcar leída</button>`}</div></article>`).join("") : '<div class="empty">No tienes notificaciones.</div>'}</div>`;
  updateUnread(state.notifications.filter((row) => !row.is_read).length);
}

async function loadTeam() {
  try { state.team = await api("/api/portal/team", {}, false); renderTeam(); }
  catch (error) { portalError(error); }
}
function renderTeam() {
  const { people, calendar, coverage, pendingRequests = [] } = state.team;
  $("#portal-body").innerHTML = `<div class="section-heading"><div><h2>Cobertura de hoy</h2><p>Disponibilidad calculada con ausencias aprobadas.</p></div></div><div class="coverage-grid">${coverage.map((row) => `<article class="coverage-card"><h3>${escapeHtml(row.department)}</h3><div class="coverage-numbers"><div><strong>${row.availableToday}</strong><small>DISPONIBLES</small></div><div><strong>${row.absentToday}</strong><small>AUSENTES</small></div></div></article>`).join("") || '<div class="empty">No tienes colaboradores asignados.</div>'}</div>
  <div class="section-heading"><div><h2>Solicitudes por revisar</h2><p>Consulta horario, incidencia y cobertura antes de registrar tu decisión.</p></div><span class="count-pill">${pendingRequests.length} PENDIENTES</span></div>${pendingRequests.length ? `<div class="review-grid">${pendingRequests.map(teamRequestCard).join("")}</div>` : '<div class="empty">No tienes solicitudes pendientes de revisión.</div>'}
  <div class="section-heading"><div><h2>Mi plantilla</h2><p>Información operativa, sin datos sensibles.</p></div></div>${people.length ? `<table class="data-table"><thead><tr><th>Colaborador</th><th>Departamento</th><th>Puesto</th><th>Turno</th><th>Estado</th></tr></thead><tbody>${people.map((row) => `<tr><td><strong>${escapeHtml(row.full_name)}</strong><br><small>${escapeHtml(row.employee_number)}</small></td><td>${escapeHtml(row.department_name || row.area_name || "—")}</td><td>${escapeHtml(row.position || "—")}</td><td>${escapeHtml(row.shift_name || "—")}</td><td><span class="badge ${row.status}">${statusLabel(row.status)}</span></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No tienes colaboradores asignados.</div>'}
  <div class="section-heading"><div><h2>Calendario del equipo</h2><p>Solicitudes pendientes y ausencias aprobadas.</p></div></div>${calendar.length ? `<table class="data-table"><thead><tr><th>Colaborador</th><th>Tipo</th><th>Periodo</th><th>Estado</th></tr></thead><tbody>${calendar.map((row) => `<tr><td>${escapeHtml(row.employee_name)}</td><td>${leaveLabel(row.leave_type)}</td><td>${dateLabel(row.start_date)} — ${dateLabel(row.end_date)}</td><td><span class="badge ${row.status}">${statusLabel(row.status)}</span></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No hay ausencias próximas.</div>'}`;
}

async function portalBodyClick(event) {
  if (event.target.closest("[data-new-request]")) { openNewRequest(); return; }
  if (event.target.closest("[data-new-document]")) { fillDocumentTypes(); return $("#document-dialog").showModal(); }
  const editRequest = event.target.closest("[data-edit-request]");
  if (editRequest) { openRequestEdit(Number(editRequest.dataset.editRequest)); return; }
  const reviewRequest = event.target.closest("[data-review-request]");
  if (reviewRequest) { openTeamReview(Number(reviewRequest.dataset.reviewRequest)); return; }
  const view = event.target.closest("[data-view-link]"); if (view) { state.currentView = view.dataset.viewLink; return renderCurrentView(); }
  const confirmCfdi = event.target.closest("[data-confirm-cfdi]");
  if (confirmCfdi) {
    setLoading(true);
    try { await api(`/api/portal/payroll/cfdi/${confirmCfdi.dataset.confirmCfdi}/confirm`, { method: "POST" }); await loadCfdiReceipts(); flash("Recepción del CFDI confirmada.", "success"); }
    catch (error) { flash(error.message, "error"); }
    finally { setLoading(false); }
    return;
  }
  const clarifyCfdi = event.target.closest("[data-clarify-cfdi]");
  if (clarifyCfdi) {
    state.clarifyingCfdiId = Number(clarifyCfdi.dataset.clarifyCfdi);
    $("#cfdi-clarification-form").reset(); $("#cfdi-dialog").showModal(); return;
  }
  const read = event.target.closest("[data-read-notification]");
  if (read) { await api(`/api/portal/notifications/${read.dataset.readNotification}/read`, { method: "PATCH" }); return loadNotifications(); }
}

async function submitCfdiClarification(event) {
  event.preventDefault();
  const formNode = event.currentTarget, form = new FormData(formNode);
  setLoading(true);
  try {
    await api(`/api/portal/payroll/cfdi/${state.clarifyingCfdiId}/clarifications`, { method: "POST", body: { message: form.get("message") } });
    $("#cfdi-dialog").close(); formNode.reset(); await loadCfdiReceipts(); flash("Aclaración enviada a Nómina.", "success");
  } catch (error) { flash(error.message, "error"); }
  finally { setLoading(false); }
}

async function submitRequest(event) {
  event.preventDefault(); const formNode = event.currentTarget, form = new FormData(formNode), file = form.get("attachment");
  const body = Object.fromEntries([...form.entries()].filter(([key]) => key !== "attachment"));
  if (state.editingRequestId) body.leaveType = state.data.requests.find((row) => row.id === state.editingRequestId)?.leave_type;
  setLoading(true);
  try {
    const editing = state.editingRequestId;
    const request = await api(editing ? `/api/portal/requests/${editing}` : "/api/portal/requests", { method: editing ? "PATCH" : "POST", body });
    if (file?.size) await uploadFile(file, { requestId: request.id, documentTypeId: documentTypeForRequest(body.leaveType), description: `Respaldo de la solicitud ${request.folio}` });
    $("#request-dialog").close(); formNode.reset(); await loadPortal(); state.currentView = "requests"; renderCurrentView(); flash(`Solicitud ${request.folio} registrada correctamente.`, "success");
  } catch (error) { flash(error.message, "error"); }
  finally { setLoading(false); }
}

async function submitTeamReview(event) {
  event.preventDefault();
  const formNode = event.currentTarget, form = new FormData(formNode);
  setLoading(true);
  try {
    await api(`/api/portal/team/requests/${state.reviewingRequestId}/action`, {
      method: "POST", body: { action: form.get("action"), reason: form.get("reason"),
        proposedStartDate: form.get("proposedStartDate"), proposedEndDate: form.get("proposedEndDate") },
    });
    $("#review-dialog").close(); formNode.reset(); await loadPortal(); state.currentView = "team";
    await loadTeam(); flash("La decisión quedó registrada y el colaborador fue notificado.", "success");
  } catch (error) { flash(error.message, "error"); }
  finally { setLoading(false); }
}

async function submitDocument(event) {
  event.preventDefault(); const formNode = event.currentTarget, form = new FormData(formNode), file = form.get("file"); setLoading(true);
  try { await uploadFile(file, { documentTypeId: form.get("documentTypeId"), description: form.get("description"), issueDate: form.get("issueDate"), expiryDate: form.get("expiryDate") }); $("#document-dialog").close(); formNode.reset(); await loadDocuments(); flash("Documento guardado correctamente.", "success"); }
  catch (error) { flash(error.message, "error"); }
  finally { setLoading(false); }
}

async function uploadFile(file, extra) {
  if (!file?.size) return; const contentBase64 = await fileBase64(file);
  return api("/api/portal/documents", { method: "POST", body: { ...extra, originalName: file.name, mimeType: file.type || "application/octet-stream", contentBase64 } });
}

async function api(path, options = {}, includeCsrf = true) {
  const headers = { "X-Company-Slug": state.companySlug, ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (includeCsrf && state.csrf && options.method && !["GET", "HEAD"].includes(options.method)) headers["X-CSRF-Token"] = state.csrf;
  const response = await fetch(path, { credentials: "same-origin", ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
  if (!response.ok) { const error = new Error(data?.error || "No fue posible completar la solicitud."); error.status = response.status; throw error; }
  return data;
}

function apiUrl(path) { const url = new URL(path, location.origin); if (state.companySlug) url.searchParams.set("company", state.companySlug); return url.pathname + url.search; }
function showOnly(view) { [publicView, pinView, appView].forEach((item) => item.hidden = item !== view); }
function setLoading(active) { loading.hidden = !active; }
function showMessage(id, message) { const node = $(`#${id}`); node.textContent = message; node.hidden = false; }
function hideMessage(id) { $(`#${id}`).hidden = true; }
function flash(message, type = "info") { const node = $("#portal-message"); node.textContent = message; node.className = `notice ${type}`; node.hidden = false; setTimeout(() => node.hidden = true, 5000); }
function portalError(error) { if (error.status === 401) return showOnly(publicView); flash(error.message, "error"); }
function updateUnread(count) { const node = $("#nav-unread"); node.hidden = !count; node.title = `${count} sin leer`; }
function openNewRequest() {
  state.editingRequestId = null;
  const form = $("#request-form"); form.reset(); form.elements.leaveType.disabled = false;
  $("#request-dialog-eyebrow").textContent = "NUEVA SOLICITUD";
  $("#request-dialog-title").textContent = "Solicitar ausencia";
  $("#request-submit-label").textContent = "Enviar solicitud";
  fillCoverageOptions(); updateRequestPolicyOptions(); setDefaultRequestDates(); $("#request-dialog").showModal();
}
function openRequestEdit(id) {
  const request = state.data.requests.find((row) => row.id === id);
  if (!request || request.review_action !== "request_changes") return;
  state.editingRequestId = id;
  const form = $("#request-form"); form.reset();
  form.elements.leaveType.value = request.leave_type; form.elements.leaveType.disabled = true;
  form.elements.subtype.value = request.subtype || ""; form.elements.startDate.value = String(request.start_date).slice(0,10);
  form.elements.endDate.value = String(request.end_date).slice(0,10); form.elements.totalDays.value = request.total_days || "";
  form.elements.totalHours.value = request.total_hours || ""; form.elements.reason.value = request.reason || "";
  form.elements.coverageEmployeeId.value = request.coverage_employee_id || "";
  form.elements.isUnpaid.checked = Boolean(request.is_unpaid);
  form.elements.unpaidTermsAccepted.checked = Boolean(request.unpaid_terms_accepted);
  $("#request-dialog-eyebrow").textContent = "CORREGIR SOLICITUD";
  $("#request-dialog-title").textContent = request.folio;
  $("#request-submit-label").textContent = "Enviar modificaciones";
  fillCoverageOptions(request.coverage_employee_id); updateRequestPolicyOptions(); $("#request-dialog").showModal();
}
function openTeamReview(id) {
  const request = state.team?.pendingRequests?.find((row) => row.id === id); if (!request) return;
  state.reviewingRequestId = id;
  $("#review-request-summary").innerHTML = `<strong>${escapeHtml(request.employee_name)}</strong><span>${escapeHtml(request.folio)} · ${leaveLabel(request.leave_type)}</span><span>${dateLabel(request.start_date)} — ${dateLabel(request.end_date)} · ${formatNumber(request.total_days)} días</span><span>Turno: ${escapeHtml(request.shift_name || request.schedule?.description || "Sin asignar")}</span><span>Cobertura estimada: ${request.coverage_available_after} disponibles después de autorizar</span><p>${escapeHtml(request.reason)}</p>`;
  $("#review-form").reset(); $("#review-dialog").showModal();
}
function setDefaultRequestDates() { const today = new Date().toISOString().slice(0,10); const form = $("#request-form"); form.elements.startDate.value = today; form.elements.endDate.value = today; }
function fillCoverageOptions(selectedId = "") { const select = $("#request-coverage"); select.innerHTML = '<option value="">Sin asignar</option>' + (state.data.coverageOptions || []).map((row) => `<option value="${row.id}" ${Number(selectedId) === row.id ? "selected" : ""}>${escapeHtml(row.full_name)} · ${escapeHtml(row.position || row.employee_number)}</option>`).join(""); }
function updateRequestPolicyOptions() { const form = $("#request-form"), permission = form.elements.leaveType.value === "permission"; $("#permission-unpaid-options").hidden = !permission; form.elements.isUnpaid.disabled = !permission; form.elements.unpaidTermsAccepted.disabled = !permission || !form.elements.isUnpaid.checked; form.elements.unpaidTermsAccepted.required = permission && form.elements.isUnpaid.checked; if (!permission) { form.elements.isUnpaid.checked = false; form.elements.unpaidTermsAccepted.checked = false; } }
function fillDocumentTypes() {
  const types = state.data.documentTypes || [];
  $("#portal-document-type").innerHTML = types.map((row) => `<option value="${row.id}" data-expiry="${row.requires_expiry_date}" data-allows-expiry="${row.allows_expiry_date}">${escapeHtml(row.name)}</option>`).join("");
  syncPortalDocumentRules();
}
function syncPortalDocumentRules() {
  const form = $("#document-form"), option = $("#portal-document-type").selectedOptions[0];
  const allowsExpiry = option?.dataset.allowsExpiry === "1";
  $("#portal-document-expiry-field").hidden = !allowsExpiry;
  form.elements.expiryDate.disabled = !allowsExpiry;
  form.elements.expiryDate.required = allowsExpiry && option?.dataset.expiry === "1";
  if (!allowsExpiry) form.elements.expiryDate.value = "";
}
function documentTypeForRequest(type) { const code = type === "incapacity" ? "MEDICAL" : "OTHER"; return state.data.documentTypes?.find((row) => row.code === code)?.id || state.data.documentTypes?.[0]?.id; }
function infoCard(label, value) { return `<article class="info-card"><small>${label}</small><strong>${escapeHtml(value || "Sin registrar")}</strong></article>`; }
function requestsTable(rows) { return rows.length ? `<table class="data-table"><thead><tr><th>Folio</th><th>Tipo</th><th>Periodo</th><th>Estado e historial</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.folio)}</strong><small class="table-note">${row.documents?.length || 0} adjunto(s) · ${row.history?.length || 0} movimiento(s)</small></td><td>${leaveLabel(row.leave_type)}${row.is_unpaid ? '<small class="table-note">Sin goce</small>' : ""}</td><td>${dateLabel(row.start_date)} — ${dateLabel(row.end_date)}<small class="table-note">${formatNumber(row.working_days || row.total_days)} día(s) hábil(es)</small></td><td><span class="badge ${row.review_action === "request_changes" ? "changes" : row.status}">${requestStatusLabel(row)}</span>${row.rejection_reason ? `<small class="table-note">${escapeHtml(row.rejection_reason)}</small>` : row.review_reason ? `<small class="table-note">${escapeHtml(row.review_reason)}</small>` : ""}${row.proposed_start_date ? `<small class="table-note">Propuesta: ${dateLabel(row.proposed_start_date)} — ${dateLabel(row.proposed_end_date)}</small>` : ""}</td><td>${row.review_action === "request_changes" ? `<button class="secondary compact" data-edit-request="${row.id}">Modificar</button>` : ""}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">Aún no hay solicitudes.</div>'; }
function teamRequestCard(row) { return `<article class="review-card"><div class="review-card-head"><div><small>${escapeHtml(row.folio)}</small><h3>${escapeHtml(row.employee_name)}</h3></div><span class="badge ${row.review_action === "resubmitted" ? "success" : "submitted"}">${row.review_action === "resubmitted" ? "Corregida" : "Pendiente"}</span></div><p><strong>${leaveLabel(row.leave_type)}</strong> · ${dateLabel(row.start_date)} — ${dateLabel(row.end_date)}</p><p>${escapeHtml(row.reason)}</p>${row.review_reason ? `<div class="review-history">Última observación: ${escapeHtml(row.review_reason)}</div>` : ""}${row.coverage_within_limit ? "" : '<div class="review-history">Advertencia: la solicitud excede el cupo de ausencias configurado.</div>'}<div class="review-metrics"><span><strong>${row.coverage_available_after}</strong> disponibles después · mínimo ${row.coverage_minimum_available}</span><span><strong>${escapeHtml(row.shift_name || "—")}</strong> turno</span></div><button class="primary wide" data-review-request="${row.id}">Revisar solicitud →</button></article>`; }
function scheduleCard(group) { const days = (group.days || []).map(dayLabel).join(", "); const periods = (group.periods || []).map((period) => `${period.start}–${period.end}`).join(" · "); return `<article class="schedule-card"><h3>${escapeHtml(days || "Jornada")}</h3><p>${escapeHtml(periods || "Horario por confirmar")}</p></article>`; }
function portalCalendarDay(row) {
  const status = row.calendar_status || (row.is_day_off ? "rest" : "scheduled");
  const labels = { scheduled: "Jornada", vacation: "Vacaciones", permission: "Permiso", incapacity: "Incapacidad", holiday: "Feriado", rest: "Descanso" };
  const date = new Date(`${row.work_date}T12:00:00`);
  const hours = row.scheduled_start && row.scheduled_end ? `${row.scheduled_start} — ${row.scheduled_end}` : "Sin jornada";
  const detail = row.absence_hours ? `${formatNumber(row.absence_hours)} h autorizadas · ${hours}`
    : status === "scheduled" ? hours : status === "holiday" ? row.holiday_name : row.event_label || labels[status];
  return `<article class="portal-calendar-day ${status}"><header><span>${date.getDate()}</span><small>${new Intl.DateTimeFormat("es-MX", { month: "short" }).format(date)}</small></header><strong>${labels[status] || "Evento"}</strong><p>${escapeHtml(detail || "")}</p>${row.actual_start || row.actual_end ? `<small class="portal-calendar-actual">Real ${escapeHtml(row.actual_start || "—")} — ${escapeHtml(row.actual_end || "—")}</small>` : ""}</article>`;
}
function documentIcon(row) { const name = String(row.original_name || "").toLowerCase(); if (name.endsWith(".pdf")) return "PDF"; if (name.endsWith(".xml")) return "XML"; if (/\.(png|jpe?g|webp)$/.test(name)) return "IMG"; return "DOC"; }
function leaveLabel(value) { return ({ vacation: "Vacaciones", permission: "Permiso", incapacity: "Incapacidad" })[value] || value; }
function employmentLabel(value) { return ({ permanent: "Permanente", temporary: "Temporal", contractor: "Contratista", intern: "Practicante" })[value] || value; }
function statusLabel(value) { return ({ submitted: "En revisión", approved: "Aprobada", rejected: "Rechazada", cancelled: "Cancelada", closed: "Cerrada", active: "Activo", leave: "Ausente", inactive: "Inactivo" })[value] || value; }
function requestStatusLabel(row) { if (row.review_action === "request_changes") return "Requiere cambios"; if (row.review_action === "resubmitted") return "Corregida · en revisión"; if (row.status === "submitted" && row.current_approval_step === "manager") return "Pendiente Jefe de área"; if (row.status === "submitted" && row.current_approval_step === "hr") return "Pendiente Administrador RH"; return statusLabel(row.status); }
function dayLabel(value) { return ({ mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado", sun: "Domingo", lunes: "Lunes", martes: "Martes", miercoles: "Miércoles", jueves: "Jueves", viernes: "Viernes", sabado: "Sábado", domingo: "Domingo" })[String(value).toLowerCase()] || value; }
function dateLabel(value) { if (!value) return "Sin registrar"; const date = new Date(`${String(value).slice(0,10)}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date); }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches"; }
function firstName(value) { return String(value || "").trim().split(/\s+/)[0]; }
function initials(value) { return String(value || "").split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase(); }
function formatNumber(value) { return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(Number(value || 0)); }
function fileBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = reject; reader.readAsDataURL(file); }); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function escapeAttr(value) { return escapeHtml(value); }
