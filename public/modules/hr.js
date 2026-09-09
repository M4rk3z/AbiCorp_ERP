// Módulo de Recursos Humanos cargado únicamente al abrir su sección.
export function createHrModule(context) {
  const { $, $$, API_BASE, HR_CONTROL_CACHE_MS, state, api, hasPermission, pageContent, entityDialog, confirmAction, requestActionText, beginPageRender, renderIsCurrent, escapeHtml, escapeAttribute, toast, formatDate, formatDateOnly, todayInput, inventoryNumber, emptyMarkup, workforceStatus, hrEmployment, hrShift, hrShiftCatalogSummary, hrParsedShiftSchedule, hrShiftSchedule, hrVacationSeniority, hrServiceYears, hrAutomaticVacationPlan, fileToBase64, downloadAuthenticatedFile, automaticCodeBanner, checkbox, initials, loadNotifications } = context;

  async function renderHr() {
    const token = beginPageRender();
    const cached = state.hrControl;
    if (cached) {
      renderHrContent(cached, cached.options || state.hrOptions, token);
      void (async () => {
        try {
          const fresh = await api("/api/hr/control", { cache: false });
          if (!renderIsCurrent(token)) return;
          state.hrControl = fresh;
          state.hrOptions = fresh.options || state.hrOptions;
          if (fresh._controlVersion !== cached._controlVersion && !entityDialog.open) {
            renderHrContent(fresh, fresh.options || state.hrOptions, token);
          }
        } catch {
          // Ya existe una fotografía utilizable; se reintentará en la próxima entrada.
        }
      })();
      return;
    }
    const control = await api("/api/hr/control", { cacheTtlMs: HR_CONTROL_CACHE_MS });
    const options = control.options || await api("/api/hr/options");
    renderHrContent(control, options, token);
  }
  
  function renderHrContent(control, options, token) {
    if (!renderIsCurrent(token)) return;
    state.hrOptions = options;
    state.hrControl = control;
    pageContent.innerHTML =
      '<section class="workforce-command hr-command"><div class="workforce-command-copy"><span class="workforce-live"><i></i>CENTRO DE PERSONAS</span><h2>Organiza a tu equipo</h2><p>Expedientes, asistencia y solicitudes de personal en un espacio claro y conectado.</p><div class="workforce-command-kpis"><div><span>PLANTILLA ACTIVA</span><strong>' + control.indicators.activePeople + '</strong><small>personas</small></div><div><span>AUSENCIAS HOY</span><strong>' + control.indicators.awayToday + '</strong><small>registradas</small></div></div>' + hrCommandActions() + '</div>' +
      hrPeopleScene(control) + '</section>' +
      hrAnalyticsDashboard(control) +
      hrUnifiedDashboard(control);
    bindHrAnalytics(control);
    $$("[data-hr-new]").forEach((button) => button.onclick = () => openHrModal(button.dataset.hrNew));
    const catalogsButton = $("[data-hr-catalogs]");
    const bulkButton = $("[data-hr-bulk]");
    const portalButton = $("[data-hr-portal]");
    const schedulesButton = $("[data-hr-schedules]");
    const complianceButton = $("[data-hr-compliance]");
    if (catalogsButton) catalogsButton.onclick = () => openHrCatalogsModal();
    if (bulkButton) bulkButton.onclick = () => openHrBulkImportModal();
    if (portalButton) portalButton.onclick = () => openHrPortalModal();
    if (schedulesButton) schedulesButton.onclick = () => openHrSchedulesModal();
    if (complianceButton) complianceButton.onclick = () => openHrComplianceModal();
    $$("[data-hr-employee-action]").forEach((button) => button.onclick = () => openHrModal(button.dataset.hrEmployeeAction, Number(button.dataset.employeeId)));
    $$("[data-hr-deactivate]").forEach((button) => button.onclick = () => openHrDeactivateModal(Number(button.dataset.hrDeactivate)));
    $$(".hr-row-actions").forEach((menu) => menu.addEventListener("toggle", () => {
      if (menu.open) $$(".hr-row-actions[open]").filter((other) => other !== menu).forEach((other) => other.removeAttribute("open"));
    }));
    $$("[data-hr-action]").forEach((button) => button.onclick = async () => {
      try {
        const action = button.dataset.hrAction;
        let reason = action === "approve" ? "Autorizado por Administrador RH." : "";
        if (action === "approve") {
          const direct = button.dataset.hrStep === "manager";
          const confirmed = await confirmAction({
            eyebrow: "SOLICITUD DE PERSONAL",
            title: "Aprobar solicitud",
            message: direct
              ? "Esta solicitud sigue pendiente del jefe de área. Como Administrador RH puedes autorizarla directamente y cerrar ambas revisiones."
              : "La solicitud quedará autorizada y se aplicarán sus efectos correspondientes.",
            confirmLabel: direct ? "Aprobar directamente" : "Aprobar solicitud",
          });
          if (!confirmed) return;
        }
        if (action === "reject") { reason = await requestActionText({ eyebrow: "SOLICITUD DE PERSONAL", title: "Rechazar solicitud", message: "Explica el motivo para que el colaborador pueda consultarlo y, si corresponde, corregir su solicitud.", fieldLabel: "Motivo del rechazo", confirmLabel: "Rechazar solicitud", tone: "danger" }); if (!reason) return; }
        await api("/api/hr/leaves/" + button.dataset.hrId + "/action", { method: "POST", body: { action, reason } });
        toast("Solicitud actualizada."); await Promise.all([renderHr(), loadNotifications()]);
      } catch (error) { toast(error.message, "error"); }
    });
    $$("[data-hr-print]").forEach((button) => button.onclick = () => printHrLeaveReceipt(Number(button.dataset.hrPrint)));
    const focusedRequest = state.hrApprovalFocusId ? $('[data-hr-request-row="' + state.hrApprovalFocusId + '"]') : null;
    if (focusedRequest) {
      focusedRequest.classList.add("focused");
      requestAnimationFrame(() => focusedRequest.scrollIntoView({ behavior: "smooth", block: "center" }));
      state.hrApprovalFocusId = null;
    }
  }

  function hrCommandActions() {
    const primary = hasPermission("hr.manage")
      ? '<div class="hr-command-primary"><button class="button workforce-accent" type="button" data-hr-new="person">＋ Agregar personal</button><button class="button ghost light" type="button" data-hr-bulk>Carga masiva</button></div>'
      : "";
    const manageLinks = hasPermission("hr.manage")
      ? '<button type="button" data-hr-schedules><span>◷</span>Horarios</button><button type="button" data-hr-portal><span>◎</span>Portal</button><button type="button" data-hr-catalogs><span>⚙</span>Catálogos</button>'
      : "";
    const compliance = hasPermission("hr.compliance.view")
      ? '<button type="button" data-hr-compliance><span>◇</span>Cumplimiento</button>'
      : "";
    if (!primary && !manageLinks && !compliance) return "";
    return '<div class="workforce-command-actions">' + primary + '<nav class="hr-command-links" aria-label="Herramientas de Recursos Humanos">' + manageLinks + compliance + '</nav></div>';
  }
  
  let hrComplianceModulePromise = null;

  async function openHrComplianceModal() {
    if (!hrComplianceModulePromise) {
      hrComplianceModulePromise = import("./hr-compliance.js?v=20260821-01")
        .then(({ createHrComplianceModule }) => createHrComplianceModule({
          $, $$, api, hasPermission, entityDialog, escapeHtml, toast, formatDate,
          formatDateOnly, emptyMarkup,
        }))
        .catch((error) => { hrComplianceModulePromise = null; throw error; });
    }
    const compliance = await hrComplianceModulePromise;
    return compliance.open();
  }

  async function openHrSchedulesModal(periodId = "", calendarStart = "") {
    try {
      const query = new URLSearchParams();
      if (periodId) query.set("periodId", periodId);
      if (calendarStart) query.set("startDate", calendarStart);
      const data = await api("/api/hr/schedules" + (query.size ? "?" + query.toString() : ""));
      const period = data.selectedPeriod, version = data.activeVersion;
      const people = (state.hrControl?.people || []).filter((row) => row.status !== "inactive");
      const peopleOptions = people.map((row) => '<option value="' + row.id + '">' + escapeHtml(row.employee_number + " · " + row.full_name) + '</option>').join("");
      const automatic = data.automaticEntries || [];
      const comparisonRows = automatic.filter((row) => row.actual_start || row.actual_end).map((row) => '<tr><td><strong>' + escapeHtml(row.employee_name) + '</strong><small>' + escapeHtml(row.employee_number) + '</small></td><td>' + formatDateOnly(row.work_date) + '</td><td>' + hrScheduleTime(row.scheduled_start, row.scheduled_end, row.is_day_off) + '</td><td>' + hrScheduleTime(row.actual_start, row.actual_end, false) + '</td><td>' + hrVariance(row.variance_minutes) + '</td><td>' + (row.actual_version ? "v" + row.actual_version : "Pendiente") + '</td></tr>').join("");
      const correctionRows = data.corrections.map((row) => '<article class="hr-schedule-correction"><div><strong>' + escapeHtml(row.employee_name) + '</strong><small>' + escapeHtml(row.employee_number) + ' · ' + formatDateOnly(row.work_date) + '</small><p>' + escapeHtml(row.reason) + '</p><small>Propuesta: ' + escapeHtml((row.proposed_start || "—") + " — " + (row.proposed_end || "—")) + '</small></div><div><span class="status ' + (row.status === "approved" ? "active" : row.status === "pending" ? "pending" : "inactive") + '">' + hrCorrectionStatus(row.status) + '</span>' + (row.status === "pending" && hasPermission("hr.approve") ? '<button class="button primary small" type="button" data-schedule-correction="' + row.id + '" data-action="approve">Autorizar</button><button class="button ghost small" type="button" data-schedule-correction="' + row.id + '" data-action="reject">Rechazar</button>' : "") + '</div></article>').join("");
      const weekDates = hrScheduleWeekDates(data.automaticRange.startDate);
      const entriesByEmployeeDate = new Map(automatic.map((row) => [row.employee_id + ":" + row.work_date, row]));
      const calendarHead = weekDates.map((date, index) => '<div class="hr-calendar-day-head"><strong>' + ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][index] + '</strong><span>' + formatDateOnly(date) + '</span></div>').join("");
      const calendarRows = people.map((person) => '<div class="hr-calendar-person"><div class="hr-calendar-person-name"><strong>' + escapeHtml(person.full_name) + '</strong><span>' + escapeHtml(person.employee_number) + ' · ' + escapeHtml(person.shift_name || "Sin turno") + '</span></div>' + weekDates.map((date) => hrAutomaticCalendarCell(entriesByEmployeeDate.get(person.id + ":" + date))).join("") + '</div>').join("");
      const scheduledPeople = new Set(automatic.filter((row) => row.calendar_status === "scheduled").map((row) => Number(row.employee_id))).size;
      const absences = automatic.filter((row) => ["vacation", "permission", "incapacity"].includes(row.calendar_status)).length;
      const holidays = new Set(automatic.filter((row) => row.calendar_status === "holiday").map((row) => row.work_date)).size;
      const previousWeek = hrAddScheduleDays(data.automaticRange.startDate, -7), nextWeek = hrAddScheduleDays(data.automaticRange.startDate, 7);
      $("#entity-modal-content").classList.add("wide", "hr-schedule-modal");
      $("#entity-modal-content").innerHTML = '<section class="hr-schedule-admin hr-schedule-automatic"><div class="modal-head"><div><span class="eyebrow">CALENDARIO AUTOMÁTICO DE PERSONAL</span><h2>Vista de horarios</h2><p class="muted">Se forma con el turno asignado y se actualiza al aprobar vacaciones, permisos, incapacidades o registrar una fecha feriada.</p></div><button type="button" data-close-modal>×</button></div>' +
        '<div class="hr-auto-schedule-toolbar"><button class="button ghost" type="button" data-auto-schedule-week="' + previousWeek + '">← Semana anterior</button><label><span>Semana visible</span><input id="hr-auto-schedule-date" type="date" value="' + data.automaticRange.startDate + '"></label><button class="button ghost" type="button" data-auto-schedule-week="' + nextWeek + '">Semana siguiente →</button><div class="hr-schedule-summary"><div><strong>' + scheduledPeople + '/' + people.length + '</strong><span>con jornada</span></div><div><strong>' + absences + '</strong><span>ausencias autorizadas</span></div><div><strong>' + holidays + '</strong><span>feriados</span></div></div></div>' +
        '<div class="hr-auto-schedule-legend"><span class="scheduled">Jornada</span><span class="vacation">Vacaciones</span><span class="permission">Permiso</span><span class="incapacity">Incapacidad</span><span class="holiday">Feriado</span><span class="rest">Descanso</span></div>' +
        '<section class="hr-calendar-shell"><div class="hr-calendar-help"><strong>Vista previa operativa</strong><span>No necesitas generar ni publicar semanas. Los cambios autorizados se reflejan aquí y en el portal del colaborador.</span></div><div class="hr-calendar-scroll"><div class="hr-calendar-grid"><div class="hr-calendar-corner">Colaborador</div>' + calendarHead + calendarRows + '</div></div></section>' +
        '<details class="hr-schedule-advanced"><summary><span><strong>Control real y correcciones</strong><small>Registra lo ocurrido sin alterar el calendario automático</small></span><b>Mostrar</b></summary><div class="hr-schedule-advanced-body"><div class="hr-schedule-layout"><section class="hr-schedule-panel"><div class="panel-head"><div><h3>Capturar horario real</h3><p>Registra la jornada efectivamente realizada.</p></div></div><form id="hr-actual-entry-form" class="form-grid compact"><label>Colaborador<select name="employeeId" required>' + peopleOptions + '</select></label><label>Fecha<input name="workDate" type="date" value="' + data.automaticRange.startDate + '" required></label><label>Entrada real<input name="actualStart" type="time"></label><label>Salida real<input name="actualEnd" type="time"></label><label>Descanso (min)<input name="breakMinutes" type="number" min="0" max="1440" value="0"></label><label class="span-2">Referencia<input name="reason" maxlength="800" placeholder="Captura manual, biométrico, etc."></label><button class="button primary" type="submit">Guardar horario real</button></form></section><section class="hr-schedule-panel"><div class="panel-head"><div><h3>Solicitar corrección</h3><p>Conserva el valor anterior y solicita autorización.</p></div></div><form id="hr-schedule-correction-form" class="form-grid compact"><label>Colaborador<select name="employeeId" required>' + peopleOptions + '</select></label><label>Fecha<input name="workDate" type="date" value="' + data.automaticRange.startDate + '" required></label><label>Nueva entrada<input name="proposedStart" type="time"></label><label>Nueva salida<input name="proposedEnd" type="time"></label><label>Descanso (min)<input name="proposedBreakMinutes" type="number" min="0" max="1440" value="0"></label><label class="span-2">Motivo<textarea name="reason" rows="2" minlength="5" required></textarea></label><button class="button ghost" type="submit">Enviar a autorización</button></form></section></div><section class="hr-schedule-panel"><div class="panel-head"><div><h3>Programado contra real</h3><p>Las diferencias se calculan automáticamente.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Colaborador</th><th>Fecha</th><th>Programado</th><th>Real</th><th>Diferencia</th><th>Historial</th></tr></thead><tbody>' + (comparisonRows || '<tr><td colspan="6">Aún no existen horarios reales en esta semana.</td></tr>') + '</tbody></table></div></section><section class="hr-schedule-panel"><div class="panel-head"><div><h3>Correcciones</h3><p>Motivo, decisión y responsable quedan protegidos.</p></div></div><div class="hr-schedule-corrections">' + (correctionRows || emptyMarkup("Sin correcciones", "No hay solicitudes de corrección registradas.")) + '</div></section></div></details></section>';
      bindHrScheduleModal(data);
      entityDialog.showModal();
    } catch (error) { toast(error.message, "error"); }
  }
  
  function bindHrScheduleModal(data) {
    const refresh = () => openHrSchedulesModal(data.selectedPeriod?.id || "", data.automaticRange?.startDate || "");
    $$('[data-auto-schedule-week]').forEach((button) => button.onclick = () =>
      openHrSchedulesModal(data.selectedPeriod?.id || "", button.dataset.autoScheduleWeek));
    $("#hr-auto-schedule-date")?.addEventListener("change", (event) =>
      openHrSchedulesModal(data.selectedPeriod?.id || "", event.target.value));
    $("#hr-schedule-period")?.addEventListener("change", (event) => openHrSchedulesModal(event.target.value));
    $("#hr-schedule-period-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { const result = await api("/api/hr/schedule-periods", { method: "POST", body: { startDate: form.get("startDate") } }); toast("Semana creada. Ahora puedes completar los turnos."); await openHrSchedulesModal(result.id); } catch (error) { toast(error.message, "error"); } });
    $("[data-schedule-quick-start]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget; button.disabled = true; button.textContent = "Creando calendario…";
      try {
        const result = await api("/api/hr/schedule-periods", { method: "POST", body: { startDate: button.dataset.startDate } });
        button.textContent = "Aplicando turnos…";
        await api("/api/hr/schedule-periods/" + result.id + "/apply-default", { method: "POST", body: {} });
        toast("Calendario creado con los turnos asignados."); await openHrSchedulesModal(result.id);
      } catch (error) { toast(error.message, "error"); button.disabled = false; button.textContent = "Crear semana automáticamente"; }
    });
    $$('[data-schedule-action]').forEach((button) => button.onclick = async () => {
      const actions = { default: ["/api/hr/schedule-periods/" + data.selectedPeriod.id + "/apply-default", "Turnos predeterminados aplicados."], copy: ["/api/hr/schedule-periods/" + data.selectedPeriod.id + "/copy-previous", "Semana anterior copiada."], publish: ["/api/hr/schedule-versions/" + data.activeVersion.id + "/publish", "Versión publicada."] };
      const selected = actions[button.dataset.scheduleAction]; if (!selected) return;
      if (button.dataset.scheduleAction === "publish" && !await confirmAction({ eyebrow: "HORARIOS SEMANALES", title: "Publicar calendario", message: "La versión quedará protegida contra cambios y será visible para los colaboradores.", confirmLabel: "Publicar calendario" })) return;
      try { button.disabled = true; button.textContent = "Procesando…"; await api(selected[0], { method: "POST", body: {} }); toast(selected[1]); await refresh(); } catch (error) { toast(error.message, "error"); button.disabled = false; }
    });
    $$("[data-schedule-cell]").forEach((button) => button.onclick = () => {
      const form = $("#hr-scheduled-entry-form"); if (!form) return;
      $$("[data-schedule-cell]").forEach((cell) => cell.classList.toggle("is-selected", cell === button));
      form.elements.employeeId.value = button.dataset.employeeId;
      form.elements.workDate.value = button.dataset.workDate;
      form.elements.startTime.value = button.dataset.startTime || "";
      form.elements.endTime.value = button.dataset.endTime || "";
      form.elements.breakMinutes.value = button.dataset.breakMinutes || "0";
      form.elements.isDayOff.checked = button.dataset.dayOff === "1";
      form.elements.notes.value = button.dataset.notes || "";
      form.querySelector('button[type="submit"]').disabled = false;
      $("#hr-schedule-editor-title").textContent = button.dataset.employeeName + " · " + button.dataset.dateLabel;
      $("#hr-schedule-editor-help").textContent = button.dataset.suggested === "1" ? "Turno sugerido automáticamente; puedes ajustarlo antes de guardar." : "Edita únicamente lo necesario y guarda el cambio.";
      form.elements.startTime.disabled = form.elements.isDayOff.checked;
      form.elements.endTime.disabled = form.elements.isDayOff.checked;
      form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    $("#hr-scheduled-entry-form")?.elements.isDayOff?.addEventListener("change", (event) => {
      const form = event.currentTarget.form; form.elements.startTime.disabled = event.currentTarget.checked; form.elements.endTime.disabled = event.currentTarget.checked;
    });
    $("#hr-scheduled-entry-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api("/api/hr/schedule-versions/" + data.activeVersion.id + "/entries", { method: "POST", body: formObject(form, ["employeeId", "breakMinutes"], ["isDayOff"]) }); toast("Jornada programada guardada."); await refresh(); } catch (error) { toast(error.message, "error"); } });
    $("#hr-actual-entry-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api("/api/hr/actual-shifts", { method: "POST", body: formObject(form, ["employeeId", "breakMinutes"]) }); toast("Horario real guardado."); await refresh(); } catch (error) { toast(error.message, "error"); } });
    $("#hr-schedule-correction-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api("/api/hr/schedule-corrections", { method: "POST", body: formObject(form, ["employeeId", "proposedBreakMinutes"]) }); toast("Corrección enviada a autorización."); await refresh(); } catch (error) { toast(error.message, "error"); } });
    bindScheduleImport("#hr-schedule-import", "/api/hr/schedule-periods/" + (data.selectedPeriod?.id || "") + "/import", refresh);
    bindScheduleImport("#hr-actual-import", "/api/hr/actual-shifts/import", refresh);
    $$('[data-schedule-template]').forEach((button) => button.onclick = () => downloadHrScheduleTemplate(button.dataset.scheduleTemplate, data));
    $$('[data-schedule-correction]').forEach((button) => button.onclick = async () => { const action = button.dataset.action; const reason = await requestActionText({ eyebrow: "CORRECCIÓN DE HORARIO", title: action === "approve" ? "Autorizar corrección" : "Rechazar corrección", message: "La decisión y su motivo quedarán registrados en el historial del colaborador.", fieldLabel: action === "approve" ? "Motivo de autorización" : "Motivo del rechazo", confirmLabel: action === "approve" ? "Autorizar" : "Rechazar", tone: action === "approve" ? "primary" : "danger" }); if (!reason) return; try { await api("/api/hr/schedule-corrections/" + button.dataset.scheduleCorrection + "/action", { method: "POST", body: { action, reason } }); toast("Corrección atendida."); await refresh(); } catch (error) { toast(error.message, "error"); } });
  }
  
  async function bindScheduleImport(selector, endpoint, refresh) {
    $(selector)?.addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (!file) return; try { event.target.disabled = true; toast("Leyendo e importando el archivo…"); const result = await api(endpoint, { method: "POST", body: { originalName: file.name, contentBase64: await fileToBase64(file) } }); toast(result.imported + " fila(s) importadas" + (result.errors.length ? "; " + result.errors.length + " con error." : ".")); await refresh(); } catch (error) { toast(error.message, "error"); event.target.disabled = false; } });
  }
  
  function downloadHrScheduleTemplate(type, data) {
    const employee = state.hrControl?.people?.find((row) => row.status !== "inactive");
    const employeeNumber = employee?.employee_number || "EJEMPLO-001";
    const date = data.selectedPeriod?.start_date || todayInput();
    const csv = type === "actual"
      ? `employee_number,date,start,end,break_minutes,reason\r\n${employeeNumber},${date},08:05,17:02,60,Importación de control\r\n`
      : `employee_number,date,start,end,break_minutes,day_off,notes\r\n${employeeNumber},${date},08:00,17:00,60,false,Jornada programada\r\n`;
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = type === "actual" ? "plantilla-horarios-reales.csv" : "plantilla-horarios-programados.csv"; link.click(); URL.revokeObjectURL(url);
  }
  
  function formObject(form, numberFields = [], booleanFields = []) { const body = Object.fromEntries(form.entries()); numberFields.forEach((key) => { body[key] = Number(body[key] || 0); }); booleanFields.forEach((key) => { body[key] = form.get(key) === "on"; }); return body; }
  function hrScheduleSource(value) { return ({ manual: "Captura manual", default_shift: "Turnos predeterminados", previous_week: "Semana anterior", csv: "Importación CSV", xlsx: "Importación XLSX" })[value] || value; }
  function hrScheduleStatus(value) { return ({ draft: "Borrador", published: "Publicada", superseded: "Sustituida" })[value] || value; }
  function hrCorrectionStatus(value) { return ({ pending: "Pendiente", approved: "Autorizada", rejected: "Rechazada" })[value] || value; }
  function hrScheduleTime(start, end, dayOff) { if (dayOff) return '<span class="status inactive">Descanso</span>'; return start || end ? escapeHtml((start || "—") + " — " + (end || "—")) : "Sin captura"; }
  function hrVariance(value) { if (value == null) return "—"; const number = Number(value); return '<strong class="' + (number < 0 ? "danger-text" : number > 0 ? "success-text" : "") + '">' + (number > 0 ? "+" : "") + number + ' min</strong>'; }
  function hrScheduleWeekDates(startDate) {
    const start = new Date(startDate + "T00:00:00Z");
    return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setUTCDate(date.getUTCDate() + index); return date.toISOString().slice(0, 10); });
  }
  function hrCurrentWeekMonday() {
    const current = new Date(todayInput() + "T00:00:00Z");
    const offset = (current.getUTCDay() + 6) % 7;
    current.setUTCDate(current.getUTCDate() - offset);
    return current.toISOString().slice(0, 10);
  }
  function hrScheduleSuggestion(person, workDate) {
    const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(workDate + "T00:00:00Z").getUTCDay()];
    const schedule = hrParsedShiftSchedule(person.shift_schedule_json);
    const group = schedule.find((item) => Array.isArray(item.days) && item.days.includes(dayKey));
    const periods = (group?.periods || []).filter((item) => item.start && item.end);
    if (periods.length) return { start: periods[0].start, end: periods.at(-1).end,
      breakMinutes: periods.length > 1 ? Math.max(0, hrTimeMinutes(periods[1].start) - hrTimeMinutes(periods[0].end)) : Number(person.shift_break_minutes || 0) };
    const legacyDays = String(person.shift_work_days || "").split(",").map((day) => day.trim());
    if (legacyDays.includes(dayKey) && person.shift_start_time && person.shift_end_time) return {
      start: person.shift_start_time, end: person.shift_end_time, breakMinutes: Number(person.shift_break_minutes || 0),
    };
    return null;
  }
  function hrScheduleCalendarCell(person, workDate, entry, editable) {
    const suggestion = hrScheduleSuggestion(person, workDate);
    const assigned = Boolean(entry), suggested = !assigned && Boolean(suggestion);
    const dayOff = assigned ? Boolean(entry.is_day_off) : !suggestion;
    const start = entry?.start_time || suggestion?.start || "", end = entry?.end_time || suggestion?.end || "";
    const breakMinutes = Number(entry?.break_minutes ?? suggestion?.breakMinutes ?? 0);
    const main = dayOff ? "Descanso" : (start && end ? start + "–" + end : "Sin jornada");
    const detail = assigned ? (entry.notes || "Programado") : suggested ? "Turno sugerido" : "Sin turno ese día";
    const classes = "hr-calendar-cell " + (assigned ? "is-assigned" : suggested ? "is-suggested" : "is-off");
    const content = '<strong>' + escapeHtml(main) + '</strong><span>' + escapeHtml(detail) + '</span>';
    if (!editable) return '<div class="' + classes + '">' + content + '</div>';
    return '<button type="button" class="' + classes + '" data-schedule-cell data-employee-id="' + person.id + '" data-employee-name="' + escapeAttribute(person.full_name) + '" data-work-date="' + workDate + '" data-date-label="' + escapeAttribute(formatDateOnly(workDate)) + '" data-start-time="' + escapeAttribute(start) + '" data-end-time="' + escapeAttribute(end) + '" data-break-minutes="' + breakMinutes + '" data-day-off="' + (dayOff ? "1" : "0") + '" data-notes="' + escapeAttribute(entry?.notes || "") + '" data-suggested="' + (suggested ? "1" : "0") + '">' + content + '</button>';
  }
  function hrAutomaticCalendarCell(entry) {
    if (!entry) return '<div class="hr-calendar-cell is-off"><strong>Sin información</strong><span>Revisa el turno asignado</span></div>';
    const status = entry.calendar_status || (entry.is_day_off ? "rest" : "scheduled");
    const labels = { scheduled: "Jornada", vacation: "Vacaciones", permission: "Permiso", incapacity: "Incapacidad", holiday: "Feriado", rest: "Descanso" };
    const hours = entry.scheduled_start && entry.scheduled_end ? entry.scheduled_start + "–" + entry.scheduled_end : "Sin jornada";
    const main = status === "scheduled" ? hours : labels[status] || "Evento";
    const detail = entry.absence_hours ? inventoryNumber(entry.absence_hours) + " h · " + hours
      : entry.event_label || (status === "rest" ? "Turno no laborable" : entry.shift_name || "Automático");
    return '<div class="hr-calendar-cell hr-auto-calendar-cell is-' + escapeAttribute(status) + '"><strong>' + escapeHtml(main) + '</strong><span>' + escapeHtml(detail) + '</span>' + (entry.actual_start || entry.actual_end ? '<small>Real ' + escapeHtml((entry.actual_start || "—") + "–" + (entry.actual_end || "—")) + '</small>' : "") + '</div>';
  }
  function hrTimeMinutes(value) { const [hours, minutes] = String(value || "0:0").split(":").map(Number); return hours * 60 + minutes; }
  function hrAddScheduleDays(date, days) { const value = new Date(date + "T00:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
  
  function openHrBulkImportModal(batch = null) {
    const card = $("#entity-modal-content");
    card.classList.add("wide", "hr-bulk-modal");
    const previewRows = batch?.previewRows || [];
    const warningRows = Number(batch?.warningRows || 0);
    const hasWarnings = warningRows > 0;
    const importButtonText = batch
      ? (hasWarnings ? "Importar de todos modos " : "Confirmar ") + batch.validRows + " alta(s)"
      : "";
    const validationState = batch?.errorRows ? "Requiere correcciones"
      : hasWarnings ? "Listo con advertencias" : "Listo para importar";
    const validationCopy = batch?.errorRows
      ? "Ningún colaborador se guardará hasta corregir los errores bloqueantes."
      : hasWarnings
        ? "Los expedientes pueden importarse incompletos después de confirmar el aviso."
        : "El archivo está listo. Confirma para crear los expedientes.";
    const preview = batch ? '<section class="hr-bulk-summary"><article><span>FILAS</span><strong>' + batch.totalRows + '</strong></article><article class="success"><span>LISTAS</span><strong>' + batch.validRows + '</strong></article><article class="' + (hasWarnings ? "warning" : "success") + '"><span>CON AVISO</span><strong>' + warningRows + '</strong></article><article class="' + (batch.errorRows ? "danger" : "success") + '"><span>CON ERROR</span><strong>' + batch.errorRows + '</strong></article></section>' +
      '<section class="hr-bulk-preview"><div class="panel-head"><div><h3>Resultado de la validación</h3><p>' + validationCopy + '</p></div><span class="status ' + (batch.errorRows ? "inactive" : "active") + '">' + validationState + '</span></div><div class="table-wrap"><table><thead><tr><th>Fila</th><th>Colaborador</th><th>CURP</th><th>Empresa / departamento</th><th>Validación</th></tr></thead><tbody>' + previewRows.map((row) => '<tr><td><strong>' + row.rowNumber + '</strong></td><td>' + escapeHtml(row.fullName || "Sin nombre") + '</td><td>' + escapeHtml(row.curp || "—") + '</td><td><strong>' + escapeHtml(row.companyCode || "—") + '</strong><small>' + escapeHtml(row.departmentCode || "—") + '</small></td><td>' + ((row.errors || []).length ? '<ul class="hr-bulk-errors">' + row.errors.map((error) => '<li>' + escapeHtml(error) + '</li>').join("") + '</ul>' : (row.warnings || []).length ? '<ul class="hr-bulk-warnings">' + row.warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join("") + '</ul>' : '<span class="status active">✓ Válida</span>') + '</td></tr>').join("") + '</tbody></table></div></section>' +
      (hasWarnings && !batch.errorRows ? '<section class="hr-bulk-warning-confirm"><div class="hr-bulk-warning-copy"><span class="hr-bulk-warning-icon" aria-hidden="true">!</span><div><strong>Se crearán ' + warningRows + ' expediente(s) con datos organizacionales pendientes.</strong><p>Podrás completar empresa, centro, departamento, área y puesto posteriormente desde Recursos Humanos.</p></div></div><button class="hr-bulk-accept-button" type="button" data-hr-bulk-warning-accept aria-pressed="false"><span class="hr-bulk-accept-mark" aria-hidden="true">!</span><span class="hr-bulk-accept-label"><small>CONFIRMACIÓN REQUERIDA</small><strong data-hr-bulk-accept-copy>Acepto y deseo continuar</strong></span><span class="hr-bulk-accept-state" data-hr-bulk-accept-state>Pendiente</span></button><p class="hr-bulk-accept-help" data-hr-bulk-accept-help>Presiona el botón amarillo para habilitar la importación.</p></section>' : "") : "";
    card.innerHTML = '<section class="hr-bulk-import"><div class="modal-head"><div><span class="eyebrow">ALTA CONTROLADA DE PERSONAL</span><h2>Carga masiva</h2><p class="muted">Importa hasta 500 colaboradores desde CSV o XLSX. La vista previa no guarda información.</p></div><button type="button" data-close-modal>×</button></div>' +
      '<div class="hr-bulk-steps"><article><span>01</span><div><strong>Descarga la plantilla</strong><small>Incluye instrucciones y los códigos vigentes de tus catálogos.</small></div><button class="button ghost small" type="button" data-hr-bulk-template>Descargar XLSX</button></article><article><span>02</span><div><strong>Completa y valida</strong><small>Conserva los encabezados y utiliza fechas yyyy-mm-dd.</small></div></article><article><span>03</span><div><strong>Confirma una sola vez</strong><small>Los avisos se pueden aceptar; los errores bloqueantes deben corregirse.</small></div></article></div>' +
      '<form id="hr-bulk-form" class="hr-bulk-file"><label class="' + (batch ? "is-validated" : "") + '" for="hr-bulk-file"><span class="hr-bulk-format">XLSX / CSV</span><div><strong data-hr-bulk-file-name>' + escapeHtml(batch?.originalName || "Selecciona el archivo de personal") + '</strong><small data-hr-bulk-file-meta>' + (batch ? "Archivo procesado · Puedes reemplazarlo si es necesario" : "Máximo 5 MB · 500 filas por lote") + '</small></div><span class="hr-bulk-file-state ' + (batch ? "is-validated" : "") + '" data-hr-bulk-file-state>' + (batch ? "Validado ✓" : "Sin archivo") + '</span><b data-hr-bulk-file-action>' + (batch ? "Cambiar archivo" : "Elegir archivo") + '</b><input id="hr-bulk-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><p class="form-error hidden"></p><button class="button ghost hr-bulk-validate-button" type="submit" disabled title="Selecciona un archivo para continuar">Validar archivo</button></form>' + preview +
      '<div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button>' + (batch && !batch.errorRows ? '<button class="button primary hr-bulk-final-button' + (hasWarnings ? " is-locked" : "") + '" type="button" data-hr-bulk-confirm ' + (hasWarnings ? 'disabled title="Primero acepta la confirmación requerida"' : "") + '>' + importButtonText + '</button>' : "") + '</div></section>';
    $("[data-hr-bulk-template]", card).onclick = () => downloadAuthenticatedFile("/api/hr/people/import/template", "plantilla-carga-personal.xlsx");
    const bulkForm = $("#hr-bulk-form", card);
    const bulkFileInput = $("#hr-bulk-file", card);
    const bulkFileLabel = $("label[for='hr-bulk-file']", bulkForm);
    const bulkValidateButton = $("button[type='submit']", bulkForm);
    bulkFileInput.addEventListener("change", () => {
      const file = bulkFileInput.files?.[0];
      const validExtension = Boolean(file && /\.(csv|xlsx)$/i.test(file.name));
      const validSize = Boolean(file && file.size <= 5 * 1024 * 1024);
      const ready = validExtension && validSize;
      const fileState = $("[data-hr-bulk-file-state]", bulkForm);
      const errorBox = $(".form-error", bulkForm);
      bulkFileLabel.classList.toggle("is-ready", ready);
      bulkFileLabel.classList.toggle("is-validated", !file && Boolean(batch));
      bulkFileLabel.classList.toggle("is-invalid", Boolean(file) && !ready);
      fileState.className = "hr-bulk-file-state " + (ready ? "is-ready" : file ? "is-invalid" : batch ? "is-validated" : "");
      $("[data-hr-bulk-file-name]", bulkForm).textContent = file?.name || batch?.originalName || "Selecciona el archivo de personal";
      $("[data-hr-bulk-file-meta]", bulkForm).textContent = ready
        ? (file.size / 1024 / 1024).toFixed(2) + " MB · Preparado para validación"
        : file && !validExtension ? "Formato no permitido · Utiliza XLSX o CSV"
          : file && !validSize ? "El archivo supera el límite de 5 MB"
            : batch ? "Archivo procesado · Puedes reemplazarlo si es necesario" : "Máximo 5 MB · 500 filas por lote";
      fileState.textContent = ready ? "Listo para validar" : file ? "Revisar archivo" : batch ? "Validado ✓" : "Sin archivo";
      $("[data-hr-bulk-file-action]", bulkForm).textContent = file || batch ? "Cambiar archivo" : "Elegir archivo";
      bulkValidateButton.disabled = !ready;
      bulkValidateButton.title = ready ? "Validar el archivo seleccionado" : "Selecciona un archivo válido para continuar";
      if (ready || !file) errorBox.classList.add("hidden");
      else {
        errorBox.textContent = validExtension ? "El archivo no puede superar 5 MB." : "Selecciona un archivo CSV o XLSX.";
        errorBox.classList.remove("hidden");
      }
    });
    bulkForm.onsubmit = async (event) => {
      event.preventDefault();
      const file = bulkFileInput.files?.[0];
      const box = $(".form-error", event.currentTarget), button = $('button[type="submit"]', event.currentTarget);
      box.classList.add("hidden");
      try {
        if (!file || !/\.(csv|xlsx)$/i.test(file.name)) throw new Error("Selecciona un archivo CSV o XLSX.");
        if (file.size > 5 * 1024 * 1024) throw new Error("El archivo no puede superar 5 MB.");
        button.disabled = true; button.textContent = "Validando filas…";
        const fileState = $("[data-hr-bulk-file-state]", bulkForm);
        fileState.className = "hr-bulk-file-state is-processing";
        fileState.textContent = "Validando…";
        const result = await api("/api/hr/people/import/preview", { method: "POST", body: { originalName: file.name, contentBase64: await fileToBase64(file) } });
        openHrBulkImportModal(result.batch);
      } catch (error) {
        const ready = Boolean(file && /\.(csv|xlsx)$/i.test(file.name) && file.size <= 5 * 1024 * 1024);
        button.disabled = !ready; button.textContent = "Validar archivo";
        const fileState = $("[data-hr-bulk-file-state]", bulkForm);
        fileState.className = "hr-bulk-file-state " + (ready ? "is-ready" : "is-invalid");
        fileState.textContent = ready ? "Listo para validar" : "Revisar archivo";
        box.textContent = error.message; box.classList.remove("hidden");
      }
    };
    $("[data-hr-bulk-warning-accept]", card)?.addEventListener("click", (event) => {
      const acceptButton = event.currentTarget;
      const accepted = acceptButton.getAttribute("aria-pressed") !== "true";
      const confirmButton = $("[data-hr-bulk-confirm]", card);
      acceptButton.setAttribute("aria-pressed", String(accepted));
      acceptButton.classList.toggle("is-accepted", accepted);
      $("[data-hr-bulk-accept-copy]", acceptButton).textContent = accepted ? "Confirmación aceptada" : "Acepto y deseo continuar";
      $("[data-hr-bulk-accept-state]", acceptButton).textContent = accepted ? "Aceptado ✓" : "Pendiente";
      $("[data-hr-bulk-accept-help]", card).textContent = accepted
        ? "Confirmación registrada. Ya puedes completar la importación."
        : "Presiona el botón amarillo para habilitar la importación.";
      confirmButton.disabled = !accepted;
      confirmButton.classList.toggle("is-locked", !accepted);
      confirmButton.title = accepted ? "" : "Primero acepta la confirmación requerida";
    });
    $("[data-hr-bulk-confirm]", card)?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = "Creando expedientes…";
      try {
        const result = await api("/api/hr/people/import-batches/" + batch.id + "/commit", {
          method: "POST", body: { confirmWarnings: hasWarnings },
        });
        state.hrOptions = null; state.hrControl = null;
        entityDialog.close();
        toast(result.batch.importedRows + " colaborador(es) importado(s) correctamente.");
        await renderHr();
      } catch (error) {
        const accepted = $("[data-hr-bulk-warning-accept]", card)?.getAttribute("aria-pressed") === "true";
        button.disabled = hasWarnings && !accepted; button.textContent = importButtonText;
        toast(error.message, "error");
      }
    });
    if (!entityDialog.open) entityDialog.showModal();
  }
  
  async function openHrPortalModal() {
    try {
      const data = await api("/api/hr/portal/settings");
      const settings = data.settings;
      const enabled = Boolean(settings.portal_enabled);
      $("#entity-modal-content").classList.add("compact");
      $("#entity-modal-content").innerHTML = '<section class="hr-portal-launcher"><div class="modal-head"><div><span class="eyebrow">AUTOSERVICIO DEL COLABORADOR</span><h2>Portal de colaboradores</h2><p class="muted">Controla únicamente si el portal está disponible para iniciar sesión.</p></div><button type="button" data-close-modal>×</button></div><form id="hr-portal-settings"><div class="hr-portal-switch-card ' + (enabled ? "is-enabled" : "") + '"><div class="hr-portal-switch-icon">' + (enabled ? "✓" : "○") + '</div><div><strong>' + (enabled ? "Portal activo" : "Portal desactivado") + '</strong><span>' + (enabled ? "Los colaboradores autorizados pueden ingresar." : "Ningún colaborador puede iniciar sesión.") + '</span></div><label class="hr-switch"><input type="checkbox" name="enabled" ' + (enabled ? "checked" : "") + '><span></span></label></div><p class="hr-portal-profile-note">El usuario, PIN y los permisos se administran desde el <strong>perfil de cada colaborador</strong>. Las políticas, festivos y cobertura están en <strong>Catálogos</strong>.</p><div class="modal-actions"><a class="button ghost" href="/portal" target="_blank" rel="noopener">Abrir portal ↗</a><button class="button primary" type="submit">Guardar estado</button></div></form></section>';
      $("#hr-portal-settings").onsubmit = async (event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        try { await api("/api/hr/portal/settings", { method: "PATCH", body: { enabled: form.get("enabled") === "on" } }); toast("Estado del portal actualizado."); await openHrPortalModal(); }
        catch (error) { toast(error.message, "error"); }
      };
      entityDialog.showModal();
    } catch (error) { toast(error.message, "error"); }
  }
  
  function portalPermission(name, label, checked) {
    return '<label><input type="checkbox" data-portal-permission="' + name + '" ' + (checked ? "checked" : "") + '><span>' + label + '</span></label>';
  }

  function hrEmployeePortalAccessMarkup(person, access = null) {
    const portal = access || {};
    const status = portal.access_status || "inactive";
    const pinState = portal.must_change_pin === 0 ? "PIN personal configurado"
      : portal.activation_expires_at ? "PIN 0000 vigente hasta " + formatDate(portal.activation_expires_at)
        : "Pendiente de activación o reinicio de PIN";
    const pinTone = portal.must_change_pin === 0 ? "ready" : portal.activation_expires_at ? "pending" : "inactive";
    const statusLabel = ({ active: "Acceso activo", blocked: "Acceso bloqueado", inactive: "Sin acceso" })[status] || "Sin acceso";
    return '<div class="hr-registration-section hr-profile-portal" data-profile-portal>' +
      '<header class="hr-portal-profile-head"><div><span>ACCESO AL PORTAL</span><h3>Cuenta del colaborador</h3><p>Administra el ingreso sin mostrar ni almacenar el PIN personal.</p></div><strong class="hr-access-status ' + status + '"><i></i>' + statusLabel + '</strong></header>' +
      '<div class="hr-profile-portal-identity"><article><i class="hr-profile-access-icon">ID</i><div><small>USUARIO DE ACCESO</small><strong>' + escapeHtml(person.employee_number) + '</strong><em>Se genera con el ID laboral y no puede modificarse.</em></div></article><article><i class="hr-profile-access-icon">••</i><div><small>SEGURIDAD DEL PIN</small><strong>' + escapeHtml(pinState) + '</strong><em>RH sólo puede reiniciarlo; el PIN definitivo permanece privado.</em></div><b class="hr-pin-state ' + pinTone + '">' + (pinTone === "ready" ? "Configurado" : pinTone === "pending" ? "Temporal" : "Pendiente") + '</b></article></div>' +
      '<div class="hr-profile-access-config"><fieldset><legend>Disponibilidad de la cuenta</legend><p>Define si el colaborador puede entrar al portal.</p><div class="hr-access-state-options"><label><input type="radio" name="portalAccessStatus" value="active" data-profile-portal-status ' + (status === "active" ? "checked" : "") + '><span><i>✓</i><strong>Activo</strong><small>Puede iniciar sesión</small></span></label><label><input type="radio" name="portalAccessStatus" value="blocked" data-profile-portal-status ' + (status === "blocked" ? "checked" : "") + '><span><i>!</i><strong>Bloqueado</strong><small>Suspensión temporal</small></span></label><label><input type="radio" name="portalAccessStatus" value="inactive" data-profile-portal-status ' + (status === "inactive" ? "checked" : "") + '><span><i>—</i><strong>Inactivo</strong><small>No puede ingresar</small></span></label></div></fieldset><aside><span>¿El colaborador olvidó su PIN?</span><p>Genera nuevamente el PIN temporal 0000, vigente durante seis horas.</p><button class="button ghost" type="button" data-profile-portal-reset>↻ Reiniciar PIN a 0000</button></aside></div>' +
      '<details><summary><span><strong>Permisos del colaborador</strong><small>Elige únicamente la información que podrá consultar.</small></span><b>Configurar</b></summary><div class="hr-portal-permissions">' + portalPermission("canViewFile", "Expediente", portal.can_view_file ?? 1) + portalPermission("canViewVacation", "Vacaciones", portal.can_view_vacation ?? 1) + portalPermission("canCreateRequests", "Crear solicitudes", portal.can_create_requests ?? 1) + portalPermission("canUploadDocuments", "Adjuntar documentos", portal.can_upload_documents ?? 1) + portalPermission("canViewSchedule", "Horarios", portal.can_view_schedule ?? 1) + portalPermission("canViewSalary", "Salario", portal.can_view_salary ?? 0) + portalPermission("canViewCfdi", "CFDI propios", portal.can_view_cfdi ?? 1) + portalPermission("canViewMedical", "Médicos propios", portal.can_view_medical ?? 1) + '</div></details>' +
      '<footer class="hr-profile-portal-footer"><span><strong>Un solo guardado para todo el expediente</strong><small>El acceso, los permisos y los datos del colaborador se aplican con el bot&oacute;n principal.</small></span></footer></div>';
  }

  function readHrEmployeePortalAccess(section = $("[data-profile-portal]")) {
    if (!section) return null;
    const selectedStatus = $("[data-profile-portal-status]:checked", section);
    const body = { status: selectedStatus?.value || "inactive" };
    $$('[data-portal-permission]', section).forEach((input) => { body[input.dataset.portalPermission] = input.checked; });
    return body;
  }

  function bindHrEmployeePortalProfile(person) {
    const section = $("[data-profile-portal]");
    if (!section) return;
    const legacySaveButton = $("[data-profile-portal-save]", section);
    if (legacySaveButton) legacySaveButton.onclick = async () => {
      const button = $("[data-profile-portal-save]", section), selectedStatus = $("[data-profile-portal-status]:checked", section);
      const body = { status: selectedStatus?.value || "inactive" };
      $$('[data-portal-permission]', section).forEach((input) => { body[input.dataset.portalPermission] = input.checked; });
      button.disabled = true; button.textContent = "Guardando acceso…";
      try { await api("/api/hr/portal/employees/" + person.id, { method: "PATCH", body }); toast("Acceso del colaborador actualizado."); await openHrEditPersonModal(person.id, "portal"); }
      catch (error) { button.disabled = false; button.textContent = "Guardar acceso"; toast(error.message, "error"); }
    };
    $("[data-profile-portal-reset]", section).onclick = async () => {
      if (!await confirmAction({ eyebrow: "PERFIL DEL COLABORADOR", title: "Reiniciar PIN a 0000", message: "Se cerrarán las sesiones abiertas y el PIN temporal estará vigente durante seis horas.", confirmLabel: "Reiniciar PIN", tone: "danger" })) return;
      try { await api("/api/hr/portal/employees/" + person.id + "/reset-pin", { method: "POST", body: {} }); toast("PIN reiniciado. El colaborador deberá cambiarlo al ingresar."); await openHrEditPersonModal(person.id, "portal"); }
      catch (error) { toast(error.message, "error"); }
    };
  }

  function selectedValue(value, expected) { return value === expected ? "selected" : ""; }

  function setupHrProfileTabs(card, initialTab = "general") {
    const fields = $(".hr-registration-fields", card);
    if (!fields || $("[data-hr-profile-tabs]", fields)) return;
    const definitions = [
      { key: "general", number: "01", label: "Resumen", detail: "Datos generales y contacto" },
      { key: "identity", number: "02", label: "Identidad", detail: "Fiscal, personal y domicilio" },
      { key: "labor", number: "03", label: "Laboral", detail: "Puesto, contrato y nómina" },
      { key: "position", number: "04", label: "Puesto", detail: "Descriptivo y perfil" },
      { key: "documents", number: "05", label: "Documentos", detail: "Archivos y vigencias" },
      { key: "portal", number: "06", label: "Portal", detail: "Usuario, PIN y permisos" },
    ];
    const panels = new Map(definitions.map((item) => {
      const panel = document.createElement("section");
      panel.id = "hr-profile-panel-" + item.key;
      panel.className = "hr-profile-tab-panel";
      panel.dataset.hrProfilePanel = item.key;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", "hr-profile-tab-" + item.key);
      return [item.key, panel];
    }));
    const originalNodes = [...fields.children];
    const completionNode = originalNodes.find((node) => node.classList.contains("hr-file-completion"));
    const salaryNode = originalNodes.find((node) => node.classList.contains("hr-sensitive-section"));
    if (salaryNode) salaryNode.insertAdjacentHTML("afterbegin", '<header class="hr-salary-head"><i aria-hidden="true">$</i><div><span>INFORMACI&Oacute;N SALARIAL</span><h3>Compensaci&oacute;n y pago</h3><p>Datos confidenciales para perfiles autorizados.</p></div><strong>ACCESO RESTRINGIDO</strong></header>');
    originalNodes.forEach((node) => {
      if (node === completionNode) return;
      const title = node.firstElementChild?.textContent?.trim().toUpperCase() || "";
      const key = node.classList.contains("hr-sensitive-section") ? "labor"
        : node.hasAttribute("data-hr-position-profile-section") ? "position"
        : node.hasAttribute("data-hr-documents-section") ? "documents"
        : /ACCESO AL PORTAL/.test(title) ? "portal"
        : /IDENTIDAD PERSONAL|DOMICILIO/.test(title) ? "identity"
          : /CONDICIONES LABORALES|ADSCRIPCIÓN LABORAL|CONTRATO Y NÓMINA|SALARIO/.test(title) ? "labor"
            : "general";
      panels.get(key).append(node);
    });
    const available = definitions.filter((item) => panels.get(item.key).children.length);
    const tablist = document.createElement("nav");
    tablist.className = "hr-profile-tabs";
    tablist.dataset.hrProfileTabs = "";
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Secciones del expediente");
    tablist.innerHTML = available.map((item) => '<button id="hr-profile-tab-' + item.key + '" type="button" role="tab" data-hr-profile-tab="' + item.key + '" aria-controls="hr-profile-panel-' + item.key + '"><span>' + item.number + '</span><strong>' + item.label + '</strong><small>' + item.detail + '</small></button>').join("");
    if (completionNode) fields.append(completionNode);
    fields.append(tablist, ...available.map((item) => panels.get(item.key)));
    const activate = (key, focus = false) => {
      const selected = available.some((item) => item.key === key) ? key : available[0]?.key;
      if (!selected) return;
      $$('[data-hr-profile-tab]', tablist).forEach((button) => {
        const active = button.dataset.hrProfileTab === selected;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
        if (active && focus) button.focus();
      });
      available.forEach((item) => { panels.get(item.key).hidden = item.key !== selected; });
    };
    $$('[data-hr-profile-tab]', tablist).forEach((button, index, buttons) => {
      button.onclick = () => activate(button.dataset.hrProfileTab);
      button.onkeydown = (event) => {
        let next = null;
        if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
        if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next == null) return;
        event.preventDefault(); activate(buttons[next].dataset.hrProfileTab, true);
      };
    });
    fields.closest("form")?.addEventListener("invalid", (event) => {
      const panel = event.target.closest("[data-hr-profile-panel]");
      if (panel?.hidden) activate(panel.dataset.hrProfilePanel);
    }, true);
    activate(initialTab);
  }

  function hrPositionProfileMarkup(person, position) {
    if (!position) return '<div class="hr-registration-section hr-position-profile" data-hr-position-profile-section><span>DOCUMENTACIÓN DEL PUESTO</span><div class="hr-position-profile-empty"><i>＋</i><div><h3>Sin puesto asignado</h3><p>Selecciona un puesto en la pestaña Laboral para vincular su descriptivo y perfil.</p></div></div></div>';
    const facts = [
      ["Código", position.code],
      ["Empresa", person.company_name],
      ["Centro de trabajo", person.work_center_name],
      ["Departamento", person.department_name],
      ["Área", person.area_name],
      ["Jefe inmediato", person.manager_name],
      ["Turno", person.shift_name || hrShift(person.shift)],
    ].filter(([, value]) => value).map(([label, value]) => '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join("");
    const description = escapeHtml(position.description || "El descriptivo de este puesto todavía no está registrado.").replace(/\r?\n/g, "<br>");
    const profileRows = [
      ["Estudios", position.profile_education],
      ["Experiencia", position.profile_experience],
      ["Conocimientos", position.profile_knowledge],
      ["Habilidades", position.profile_skills],
      ["Competencias", position.profile_competencies],
    ].map(([label, value]) => '<div><span>' + label + '</span><p>' + escapeHtml(value || "Sin definir").replace(/\r?\n/g, "<br>") + '</p></div>').join("");
    return '<div class="hr-registration-section hr-position-profile" data-hr-position-profile-section><span>DOCUMENTACIÓN DEL PUESTO</span><header><div><small>' + escapeHtml(position.code || "SIN FOLIO") + '</small><h3>' + escapeHtml(position.name) + '</h3><p>El descriptivo define el trabajo; el perfil define a la persona adecuada para realizarlo.</p></div>' + (hasPermission("hr.manage") ? '<button class="button ghost" type="button" data-edit-profile-position>Editar definición</button>' : "") + '</header><div class="hr-position-profile-facts">' + facts + '</div><section class="hr-position-definition descriptive"><header><div><span>DESCRIPTIVO DE PUESTO</span><strong>¿Qué hace este puesto?</strong></div><button class="button ghost" type="button" data-print-position-document="description">Imprimir descriptivo</button></header><p>' + description + '</p></section><section class="hr-position-definition profile"><header><div><span>PERFIL DE PUESTO</span><strong>¿Quién puede desempeñar este puesto?</strong></div><button class="button primary" type="button" data-print-position-document="profile">Imprimir perfil</button></header><div class="hr-position-profile-requirements">' + profileRows + '</div></section></div>';
  }

  function bindHrPositionProfile(person, position) {
    const section = $("[data-hr-position-profile-section]");
    if (!section || !position) return;
    $$("[data-print-position-document]", section).forEach((button) => button.onclick = () =>
      printHrPositionProfile(position, person, button.dataset.printPositionDocument)
    );
    const edit = $("[data-edit-profile-position]", section);
    if (edit) edit.onclick = () => openHrCatalogsModal("positions", "", position.id);
  }

  function hrDocumentSensitivityLabel(value) {
    return ({ standard: "General", fiscal: "Fiscal", salary: "Salarial restringido", cfdi: "CFDI restringido", medical: "Médico restringido" })[value]
      || value || "General";
  }

  function hrDocumentSize(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function hrEmployeeDocumentsMarkup(person, data = {}) {
    const documents = (data.documents || []).filter((row) => Number(row.employee_id) === Number(person.id));
    const currentDocuments = documents.filter((row) => Number(row.is_current) === 1);
    const documentTypes = data.documentTypes || [];
    const missing = new Set(person.missing_file_documents || []);
    const requiredTypes = documentTypes.filter((row) => Number(row.required_for_active) === 1);
    const checklist = requiredTypes.map((type) => {
      const document = currentDocuments.find((row) => Number(row.document_type_id) === Number(type.id));
      return '<article class="hr-document-check ' + (document ? "ready" : "pending") + '"><i>' + (document ? "✓" : "!") + '</i><span><strong>' + escapeHtml(type.name) + '</strong><small>' + (document ? "Documento vigente · v" + Number(document.version_number || 1) : "Pendiente de cargar") + '</small></span></article>';
    }).join("");
    const typeOptions = documentTypes.map((type) => '<option value="' + type.id + '" data-sensitive="' + escapeAttribute(type.sensitivity) + '" data-issue="' + Number(type.requires_issue_date || 0) + '" data-expiry="' + Number(type.requires_expiry_date || 0) + '" data-allows-expiry="' + Number(type.allows_expiry_date || 0) + '">' + escapeHtml(type.name + (missing.has(type.name) ? " · pendiente" : "")) + '</option>').join("");
    const rows = documents.map((document) => '<article class="hr-employee-document ' + (document.is_current ? "current" : "previous") + '"><div class="hr-document-symbol">' + (document.is_current ? "DOC" : "v" + Number(document.version_number || 1)) + '</div><div><strong>' + escapeHtml(document.document_type_name || "Documento") + '</strong><span>' + escapeHtml(document.original_name) + '</span><small>' + formatDate(document.created_at) + ' · ' + hrDocumentSize(document.size_bytes) + ' · ' + hrDocumentSensitivityLabel(document.sensitivity) + '</small></div><div class="hr-document-actions"><b>' + (document.is_current ? "VIGENTE" : "ANTERIOR") + '</b><a href="' + API_BASE + '/api/documents/' + document.id + '/download">Descargar</a>' + (hasPermission("documents.manage") ? '<button type="button" data-delete-hr-document="' + document.id + '">Eliminar</button>' : "") + '</div></article>').join("");
    const upload = hasPermission("documents.manage")
      ? '<div class="hr-document-upload" data-hr-document-upload><header><div><span>AGREGAR AL EXPEDIENTE</span><h4>Cargar o reemplazar documento</h4></div><small>Máximo 8 MB</small></header><label>Archivo<input type="file" data-hr-document-file></label><div class="form-grid"><label>Clasificación<select data-hr-document-type><option value="">Selecciona el tipo documental</option>' + typeOptions + '</select><small data-hr-document-access>La clasificación determina los permisos de acceso.</small></label><label>Fecha de emisión<input type="date" data-hr-document-issue></label><label data-hr-document-expiry-field hidden>Fecha de vencimiento<input type="date" data-hr-document-expiry disabled></label><label>Descripción<input data-hr-document-description maxlength="500" placeholder="Ej. Documento firmado"></label></div><p class="form-error hidden" data-hr-document-error></p><button class="button primary" type="button" data-upload-hr-document>↑ Guardar documento</button></div>'
      : '<p class="hr-document-readonly">Puedes consultar y descargar los documentos. La carga requiere permiso de administración documental.</p>';
    return '<div class="hr-registration-section hr-profile-documents" data-hr-documents-section><span>DOCUMENTOS DEL EXPEDIENTE</span><header class="hr-documents-head"><div><h3>Expediente documental</h3><p>Completa los requisitos del colaborador sin salir de Gestión de personas.</p></div><strong>' + currentDocuments.length + ' vigente(s)</strong></header>' + (checklist ? '<div class="hr-document-checklist">' + checklist + '</div>' : "") + upload + '<section class="hr-employee-document-list"><header><strong>Archivos vinculados</strong><small>' + documents.length + ' archivo(s), incluidas versiones anteriores</small></header>' + (rows || '<div class="hr-document-empty"><strong>Aún no hay documentos</strong><small>Carga el primer archivo para comenzar el expediente.</small></div>') + '</section></div>';
  }

  async function refreshHrPersonModal(employeeId, initialTab = "documents") {
    const control = await api("/api/hr/control", { cache: false });
    state.hrControl = control;
    state.hrOptions = control.options || state.hrOptions;
    await openHrEditPersonModal(employeeId, initialTab);
  }

  function bindHrEmployeeDocuments(person) {
    const section = $("[data-hr-documents-section]");
    if (!section) return;
    const type = $("[data-hr-document-type]", section);
    const issue = $("[data-hr-document-issue]", section);
    const expiry = $("[data-hr-document-expiry]", section);
    const expiryField = $("[data-hr-document-expiry-field]", section);
    const access = $("[data-hr-document-access]", section);
    const syncRules = () => {
      const option = type?.selectedOptions?.[0];
      const allowsExpiry = option?.dataset.allowsExpiry === "1";
      if (issue) issue.dataset.required = String(option?.dataset.issue === "1");
      if (expiryField) expiryField.hidden = !allowsExpiry;
      if (expiry) {
        expiry.disabled = !allowsExpiry;
        expiry.dataset.required = String(allowsExpiry && option?.dataset.expiry === "1");
        if (!allowsExpiry) expiry.value = "";
      }
      if (access) access.textContent = option?.value
        ? "Acceso: " + hrDocumentSensitivityLabel(option.dataset.sensitive)
        : "La clasificación determina los permisos de acceso.";
    };
    if (type) { type.onchange = syncRules; syncRules(); }
    const upload = $("[data-upload-hr-document]", section);
    if (upload) upload.onclick = async () => {
      const file = $("[data-hr-document-file]", section)?.files?.[0];
      const errorBox = $("[data-hr-document-error]", section);
      errorBox.classList.add("hidden");
      if (!file?.size) { errorBox.textContent = "Selecciona un archivo."; return errorBox.classList.remove("hidden"); }
      if (!type.value) { errorBox.textContent = "Selecciona la clasificación del documento."; return errorBox.classList.remove("hidden"); }
      if (file.size > 8 * 1024 * 1024) { errorBox.textContent = "El archivo supera el límite de 8 MB."; return errorBox.classList.remove("hidden"); }
      if ((issue.dataset.required === "true" && !issue.value) || (expiry.dataset.required === "true" && !expiry.value)) {
        errorBox.textContent = "Completa las fechas obligatorias de esta clasificación.";
        return errorBox.classList.remove("hidden");
      }
      upload.disabled = true;
      upload.textContent = "Cargando…";
      try {
        await api("/api/documents", { method: "POST", body: {
          originalName: file.name, mimeType: file.type || "application/octet-stream",
          contentBase64: await fileToBase64(file), module: "hr", entityType: "employee",
          entityId: String(person.id), employeeId: person.id, documentTypeId: type.value,
          issueDate: issue.value, expiryDate: expiry.value,
          description: $("[data-hr-document-description]", section)?.value || "",
        } });
        toast("Documento integrado al expediente.");
        await refreshHrPersonModal(person.id, "documents");
      } catch (error) {
        upload.disabled = false;
        upload.textContent = "↑ Guardar documento";
        errorBox.textContent = error.message;
        errorBox.classList.remove("hidden");
      }
    };
    $$('[data-delete-hr-document]', section).forEach((button) => button.onclick = async () => {
      if (!await confirmAction({ eyebrow: "EXPEDIENTE DEL COLABORADOR", title: "Eliminar documento", message: "Si eliminas la versión vigente, se restaurará automáticamente la versión anterior.", confirmLabel: "Eliminar documento", tone: "danger" })) return;
      try {
        await api("/api/documents/" + button.dataset.deleteHrDocument, { method: "DELETE" });
        toast("Documento eliminado.");
        await refreshHrPersonModal(person.id, "documents");
      } catch (error) { toast(error.message, "error"); }
    });
  }

  function printHrPositionProfile(position, person = null, documentType = "profile") {
    if (!position) return toast("El colaborador no tiene un puesto asignado.", "error");
    const printWindow = window.open("", "_blank", "width=920,height=760");
    if (!printWindow) return toast("El navegador bloqueó la ventana de impresión.", "error");
    printWindow.opener = null;
    const isDescription = documentType === "description";
    const title = isDescription ? "Descriptivo de puesto" : "Perfil de puesto";
    const question = isDescription ? "¿Qué hace este puesto?" : "¿Quién puede desempeñar este puesto?";
    const issueDate = new Intl.DateTimeFormat("es-MX", { dateStyle: "long" }).format(new Date());
    const stylesheetUrl = escapeAttribute(new URL("../hr-position-document.css?v=20260907-01", import.meta.url).href);
    const logoUrl = escapeAttribute(new URL("../assets/abicorp-logo.png", import.meta.url).href);
    const documentCode = (position.code || "SIN-FOLIO") + (isDescription ? "-DES" : "-PER");
    const identityRows = [
      ["Nombre del puesto", position.name], ["Código del puesto", position.code || "Sin folio"],
      ["Empresa", person?.company_name || "Aplicación general"], ["Centro de trabajo", person?.work_center_name || "Todos los centros"],
      ["Departamento", person?.department_name || "Sin departamento asignado"], ["Área", person?.area_name || "Sin área asignada"],
      ["Ocupante de referencia", person?.full_name || "Documento general del puesto"], ["Número de empleado", person?.employee_number || "No aplica"],
      ["Turno", person ? person.shift_name || hrShift(person.shift) : "Según asignación"],
    ].map(([label, value]) => '<div class="identity-cell"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join("");
    const requirementRows = [
      ["Estudios", position.profile_education],
      ["Experiencia", position.profile_experience],
      ["Conocimientos", position.profile_knowledge],
      ["Habilidades", position.profile_skills],
      ["Competencias", position.profile_competencies],
    ].map(([label, value]) => '<div class="requirement-row"><div class="requirement-label">' + label + '</div><div class="requirement-value">' + escapeHtml(value || "Pendiente de definir") + '</div></div>').join("");
    const organization = [
      ["Reporta a", person?.manager_name || "Según estructura autorizada"],
      ["Área de adscripción", person?.area_name || person?.department_name || "Por definir"],
      ["Jornada", person ? person.shift_name || hrShift(person.shift) : "Según asignación"],
    ].map(([label, value]) => '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join("");
    const documentBody = isDescription
      ? '<section class="document-section"><div class="section-heading"><b>02</b><div><span>Descriptivo de puesto</span><strong>Propósito, funciones y responsabilidades</strong></div></div><div class="content-panel"><p>' + escapeHtml(position.description || "El descriptivo del puesto está pendiente de documentar.") + '</p></div></section><section class="document-section"><div class="section-heading"><b>03</b><div><span>Relaciones de trabajo</span><strong>Ubicación dentro de la organización</strong></div></div><div class="organization-strip">' + organization + '</div></section>'
      : '<section class="document-section"><div class="section-heading"><b>02</b><div><span>Perfil del ocupante</span><strong>Requisitos y competencias requeridas</strong></div></div><div class="requirements-table">' + requirementRows + '</div></section>';
    printWindow.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' · ' + escapeHtml(position.name) + '</title><link rel="stylesheet" href="' + stylesheetUrl + '"></head><body><main class="position-document"><header class="document-brand"><div class="document-brand-main"><img src="' + logoUrl + '" alt=""><div><strong>ABICORP</strong><span>ERP MODULAR · RECURSOS HUMANOS</span></div></div><div class="document-control"><div><span>Código</span><strong>' + escapeHtml(documentCode) + '</strong></div><div><span>Versión</span><strong>1.0</strong></div><div><span>Estado</span><strong>Vigente</strong></div></div></header><section class="document-title"><div><span class="document-kicker">DOCUMENTACIÓN ORGANIZACIONAL</span><h1>' + title + '</h1><p>' + escapeHtml(position.name) + '</p></div><aside class="document-purpose"><span>Propósito del documento</span><strong>' + question + '</strong></aside></section><section class="document-section"><div class="section-heading"><b>01</b><div><span>Identificación</span><strong>Datos generales del puesto</strong></div></div><div class="identity-grid">' + identityRows + '</div></section>' + documentBody + '<section class="signatures"><div class="signature"><span>Elaboró</span><strong>Recursos Humanos</strong></div><div class="signature"><span>Revisó</span><strong>' + escapeHtml(person?.manager_name || "Jefatura inmediata") + '</strong></div><div class="signature"><span>Autorizó</span><strong>Dirección / Gerencia</strong></div></section><footer class="document-footer"><p>Documento generado desde Gestión de personas el ' + escapeHtml(issueDate) + '. La copia impresa se considera no controlada salvo que cuente con firmas de autorización.</p><span>' + escapeHtml(documentCode) + ' · V1.0</span></footer></main><nav class="document-toolbar" aria-label="Acciones del documento"><button type="button" data-position-print-close>Cerrar</button><button type="button" data-position-print-action>Imprimir / Guardar PDF</button></nav></body></html>');
    printWindow.document.close();
    const bindPrintActions = () => {
      printWindow.document.querySelector("[data-position-print-close]")?.addEventListener("click", () => printWindow.close());
      printWindow.document.querySelector("[data-position-print-action]")?.addEventListener("click", () => printWindow.print());
    };
    if (printWindow.document.readyState === "loading") printWindow.document.addEventListener("DOMContentLoaded", bindPrintActions, { once: true });
    else bindPrintActions();
  }
  
  function hrAnalyticsDashboard(control) {
    const areaOptions = [...new Map(control.people.filter((row) => row.area_id).map((row) => [String(row.area_id), row.area_name || "Sin área"])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "es"))
      .map(([id, name]) => '<option value="' + escapeAttribute(id) + '">' + escapeHtml(name) + '</option>').join("");
    const shiftOptions = [...new Map(control.people.filter((row) => row.work_shift_id).map((row) => [String(row.work_shift_id), row.shift_name || hrShift(row.shift)])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "es"))
      .map(([id, name]) => '<option value="' + escapeAttribute(id) + '">' + escapeHtml(name) + '</option>').join("");
    return '<section class="hr-analytics panel" data-hr-analytics>' +
      '<div class="hr-analytics-head"><div><span class="eyebrow">INTELIGENCIA DE PLANTILLA</span><h2>Pulso de Recursos Humanos</h2><p>Indicadores, distribución, disponibilidad y alertas calculadas con la información operativa.</p></div><span class="hr-analytics-live"><i></i>DATOS ACTUALIZADOS</span></div>' +
      '<div class="hr-analytics-filters">' +
        '<label><span>Periodo</span><select data-hr-filter="period"><option value="month">Mes actual</option><option value="quarter">Últimos 90 días</option><option value="year">Año actual</option><option value="all">Histórico</option></select></label>' +
        '<label><span>Área</span><select data-hr-filter="area"><option value="all">Todas las áreas</option>' + areaOptions + '</select></label>' +
        '<label><span>Turno</span><select data-hr-filter="shift"><option value="all">Todos los turnos</option>' + shiftOptions + '</select></label>' +
        '<label><span>Contratación</span><select data-hr-filter="employment"><option value="all">Todos los tipos</option><option value="permanent">Permanente</option><option value="temporary">Temporal</option><option value="contractor">Contratista</option><option value="intern">Practicante</option></select></label>' +
        '<label><span>Estado</span><select data-hr-filter="status"><option value="all">Todos</option><option value="active">Activos</option><option value="leave">Ausentes</option><option value="inactive">Bajas</option></select></label>' +
        '<button type="button" data-hr-clear-filters>Limpiar filtros</button>' +
      '</div><div data-hr-analytics-body></div></section>';
  }
  
  function bindHrAnalytics(control) {
    const root = $("[data-hr-analytics]");
    if (!root) return;
    const render = () => {
      const filters = {};
      $$("[data-hr-filter]", root).forEach((input) => { filters[input.dataset.hrFilter] = input.value; });
      $("[data-hr-analytics-body]", root).innerHTML = hrAnalyticsBody(control, filters);
    };
    $$("[data-hr-filter]", root).forEach((input) => input.addEventListener("change", render));
    $("[data-hr-clear-filters]", root).onclick = () => {
      $$("[data-hr-filter]", root).forEach((input) => { input.selectedIndex = 0; });
      render();
    };
    render();
  }
  
  function hrAnalyticsBody(control, filters) {
    const bounds = hrAnalyticsPeriod(filters.period);
    const people = control.people.filter((row) =>
      (filters.area === "all" || String(row.area_id || "") === filters.area) &&
      (filters.shift === "all" || String(row.work_shift_id || "") === filters.shift) &&
      (filters.employment === "all" || row.employment_type === filters.employment) &&
      (filters.status === "all" || row.status === filters.status));
    const peopleIds = new Set(people.map((row) => Number(row.id)));
    const leaves = control.leaves.filter((row) => peopleIds.has(Number(row.employee_id)));
    const active = people.filter((row) => row.status === "active");
    const hires = people.filter((row) => hrDateWithin(row.hire_date || row.created_at, bounds)).length;
    const exits = people.filter((row) => row.status === "inactive" && hrDateWithin(row.updated_at, bounds)).length;
    const turnover = Math.round(exits / Math.max(1, active.length + exits / 2) * 1000) / 10;
    const currentDate = todayInput();
    const activeAbsences = leaves.filter((row) => row.status === "approved" && row.start_date <= currentDate && row.end_date >= currentDate);
    const availablePeople = Math.max(0, active.length - new Set(activeAbsences.map((row) => row.employee_id)).size);
    const vacationDays = active.filter((row) => row.employment_type === "permanent")
      .reduce((sum, row) => sum + Number(row.vacation_balance || 0), 0);
    const kpis = [
      ["PLANTILLA ACTIVA", active.length, "Colaboradores disponibles", "primary"],
      ["ALTAS", hires, hrAnalyticsPeriodLabel(filters.period), "positive"],
      ["BAJAS", exits, hrAnalyticsPeriodLabel(filters.period), exits ? "warning" : ""],
      ["ROTACIÓN", inventoryNumber(turnover) + "%", "Bajas sobre plantilla promedio", turnover >= 10 ? "warning" : ""],
      ["DISPONIBLES HOY", availablePeople, activeAbsences.length + " ausencia(s) activa(s)", ""],
      ["VACACIONES", inventoryNumber(vacationDays) + " d", "Saldo disponible de la plantilla", ""],
    ].map(([label, value, detail, tone]) => '<article class="hr-stat-card ' + tone + '"><span>' + label + '</span><strong>' + value + '</strong><small>' + detail + '</small></article>').join("");
    const areaGroups = hrAnalyticsGroups(active, (row) => row.area_name || "Sin área");
    const contractGroups = hrAnalyticsGroups(active, (row) => hrEmployment(row.employment_type));
    const shiftGroups = hrAnalyticsGroups(active, (row) => row.employment_type === "contractor" ? "Sin turno" : (row.shift_name || hrShift(row.shift)));
    const distribution = '<article class="hr-insight-card hr-distribution-card"><header><div><span>DISTRIBUCIÓN</span><h3>Composición de la plantilla</h3></div><strong>' + active.length + ' ACTIVO(S)</strong></header><div class="hr-chart-tabs"><div><h4>Por área</h4>' + hrAnalyticsBars(areaGroups, active.length) + '</div><div><h4>Por contratación</h4>' + hrAnalyticsBars(contractGroups, active.length) + '</div><div><h4>Por turno</h4>' + hrAnalyticsBars(shiftGroups, active.length) + '</div></div></article>';
    const projection = hrAbsenceProjection(active, leaves);
    const alerts = hrAnalyticsAlerts(people, leaves);
    const statusSummary = '<article class="hr-insight-card hr-availability-card"><header><div><span>PRÓXIMOS 28 DÍAS</span><h3>Proyección de disponibilidad</h3></div><strong>' + availablePeople + ' HOY</strong></header>' + projection + '</article>';
    const alertMarkup = '<article class="hr-insight-card hr-alert-card"><header><div><span>ATENCIÓN REQUERIDA</span><h3>Alertas operativas</h3></div><strong>' + alerts.length + ' ALERTA(S)</strong></header><div class="hr-alert-list">' + (alerts.length ? alerts.slice(0, 8).map((alert) => '<div class="' + alert.tone + '"><i>' + alert.symbol + '</i><div><strong>' + escapeHtml(alert.title) + '</strong><small>' + escapeHtml(alert.detail) + '</small></div></div>').join("") : '<div class="hr-analytics-empty"><i>✓</i><div><strong>Sin alertas críticas</strong><small>La plantilla filtrada no requiere atención inmediata.</small></div></div>') + '</div></article>';
    const empty = people.length ? "" : '<div class="hr-analytics-no-results">No hay colaboradores que coincidan con los filtros seleccionados.</div>';
    return empty + '<div class="hr-stat-grid">' + kpis + '</div><div class="hr-insight-grid">' + distribution + statusSummary + alertMarkup + '</div>';
  }
  
  function hrAnalyticsPeriod(period) {
    const end = todayInput();
    if (period === "all") return { start: "0000-01-01", end };
    if (period === "year") return { start: end.slice(0, 4) + "-01-01", end };
    if (period === "quarter") return { start: hrIsoDateOffset(-89), end };
    return { start: end.slice(0, 7) + "-01", end };
  }
  
  function hrAnalyticsPeriodLabel(period) {
    return ({ month: "Durante el mes actual", quarter: "Durante los últimos 90 días", year: "Durante el año actual", all: "En todo el historial" })[period] || "Durante el periodo";
  }
  
  function hrIsoDateOffset(days, origin = todayInput()) {
    const date = new Date(origin + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  
  function hrDateWithin(value, bounds) {
    const date = String(value || "").slice(0, 10);
    return Boolean(date && date >= bounds.start && date <= bounds.end);
  }
  
  function hrAnalyticsGroups(rows, labelFor) {
    const counts = new Map();
    rows.forEach((row) => {
      const label = labelFor(row);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).slice(0, 6);
  }
  
  function hrAnalyticsBars(groups, total) {
    if (!groups.length) return '<p class="hr-chart-empty">Sin datos</p>';
    return '<div class="hr-bar-chart">' + groups.map(([label, value]) => {
      const percent = Math.round(value / Math.max(1, total) * 100);
      return '<div class="hr-bar-row"><div><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong></div><b><i style="width:' + percent + '%"></i></b><small>' + percent + '%</small></div>';
    }).join("") + '</div>';
  }
  
  function hrAbsenceProjection(activePeople, leaves) {
    const activeIds = new Set(activePeople.map((row) => Number(row.id)));
    const weeks = Array.from({ length: 4 }, (_, index) => {
      const start = hrIsoDateOffset(index * 7);
      const end = hrIsoDateOffset(index * 7 + 6);
      const absences = leaves.filter((row) => activeIds.has(Number(row.employee_id)) && row.status === "approved" && row.start_date <= end && row.end_date >= start);
      const absent = new Set(absences.map((row) => Number(row.employee_id))).size;
      const available = Math.max(0, activePeople.length - absent);
      const percent = Math.round(available / Math.max(1, activePeople.length) * 100);
      return { start, end, absent, available, percent };
    });
    return '<div class="hr-availability-weeks">' + weeks.map((week, index) => '<div><span>SEMANA ' + (index + 1) + '</span><strong>' + week.available + ' disponibles</strong><small>' + formatDateOnly(week.start) + ' — ' + formatDateOnly(week.end) + '</small><b><i style="width:' + week.percent + '%"></i></b><em>' + week.absent + ' ausencia(s)</em></div>').join("") + '</div>';
  }
  
  function hrAnalyticsAlerts(people, leaves) {
    const alerts = [];
    const currentDate = todayInput();
    const next30 = hrIsoDateOffset(30);
    const next14 = hrIsoDateOffset(14);
    people.filter((row) => row.status !== "inactive").forEach((row) => {
      const endDate = row.employment_type === "temporary" ? row.contract_end_date
        : ["contractor", "intern"].includes(row.employment_type) ? row.service_end_date : "";
      if (endDate && endDate >= currentDate && endDate <= next30) {
        alerts.push({ tone: "warning", symbol: "!", title: row.full_name, detail: hrEmployment(row.employment_type) + " concluye el " + formatDateOnly(endDate) });
      }
      const missing = [...(row.missing_file_fields || []), ...(row.missing_file_documents || [])];
      if (missing.length) alerts.push({ tone: "info", symbol: "i", title: "Expediente incompleto · " + row.full_name, detail: Number(row.file_completion_percent || 0) + "% completo · Falta: " + missing.slice(0, 6).join(", ") });
      (row.document_expiry_alerts || []).forEach((document) => alerts.push({
        tone: document.type === "expired" ? "warning" : "info",
        symbol: document.type === "expired" ? "!" : "→",
        title: (document.type === "expired" ? "Documento vencido · " : "Documento por vencer · ") + row.full_name,
        detail: document.documentName + " · " + formatDateOnly(document.expiryDate),
      }));
    });
    const pending = leaves.filter((row) => row.status === "submitted");
    if (pending.length) alerts.push({ tone: "warning", symbol: "?", title: pending.length + " solicitud(es) pendientes", detail: "Requieren autorización de Recursos Humanos." });
    const upcoming = leaves.filter((row) => row.status === "approved" && row.start_date > currentDate && row.start_date <= next14);
    if (upcoming.length) alerts.push({ tone: "info", symbol: "→", title: upcoming.length + " ausencia(s) próximas", detail: "Comienzan durante los próximos 14 días." });
    return alerts;
  }
  
  function hrUnifiedDashboard(control) {
    const pending = control.leaves.filter((row) => row.status === "submitted");
    const focusId = Number(state.hrApprovalFocusId || 0);
    const recentLeaves = [...control.leaves].sort((left, right) => {
      const leftPriority = Number(left.id) === focusId ? 0 : left.status === "submitted" ? 1 : 2;
      const rightPriority = Number(right.id) === focusId ? 0 : right.status === "submitted" ? 1 : 2;
      return leftPriority - rightPriority;
    }).slice(0, 8);
    const employeeCards = control.people.map((row) => {
      const portrait = row.photo_filename
        ? '<img class="hr-employee-avatar" src="' + API_BASE + '/api/hr/people/' + row.id + '/photo?v=' + encodeURIComponent(row.updated_at || "") + '" alt="Fotografía de ' + escapeAttribute(row.full_name) + '" />'
        : '<span class="hr-employee-avatar fallback">' + escapeHtml(initials(row.full_name)) + '</span>';
      const operationActions = row.status !== "inactive" && hasPermission("hr.operate")
        ? '<button type="button" data-hr-employee-action="permission" data-employee-id="' + row.id + '">Permiso</button>' +
          (row.employment_type === "permanent" ? '<button type="button" data-hr-employee-action="vacation" data-employee-id="' + row.id + '">Vacaciones</button>' : "") +
          '<button type="button" data-hr-employee-action="incapacity" data-employee-id="' + row.id + '">Incapacidad</button>'
        : "";
      const actionButtons = operationActions +
        (row.status !== "inactive" && hasPermission("hr.manage") ? '<button class="hr-deactivate-action" type="button" data-hr-deactivate="' + row.id + '">Dar de baja</button>' : "") +
        (hasPermission("hr.manage") ? '<button class="hr-edit-action" type="button" data-hr-employee-action="edit" data-employee-id="' + row.id + '">Editar expediente</button>' : "");
      const actions = actionButtons ? '<details class="hr-row-actions"><summary>Gestionar <span>⌄</span></summary><div>' + actionButtons + '</div></details>' : "";
      const shiftTitle = row.employment_type === "contractor" ? "Sin horario asignado" : (row.shift_name || hrShift(row.shift));
      const shiftDetail = row.employment_type === "contractor" ? (row.organization_name || "Contratista externo") : hrShiftSchedule(row);
      let trackingLabel = "VACACIONES";
      let trackingTitle = row.employment_type === "permanent" ? inventoryNumber(row.vacation_balance || 0) + " días" : "No aplica";
      let trackingDetail = row.employment_type === "permanent"
        ? (row.vacation_plan_name || (hrServiceYears(row.hire_date) < 1 ? "Disponible al cumplir 1 año" : "Sin plan asignado"))
        : hrEmployment(row.employment_type);
      if (row.employment_type === "contractor") {
        trackingLabel = "DÍAS CONTRATADOS";
        trackingTitle = inventoryNumber(row.service_total_days || 0) + " días";
        trackingDetail = row.service_start_date && row.service_end_date
          ? formatDateOnly(row.service_start_date) + " — " + formatDateOnly(row.service_end_date)
          : "Periodo sin definir";
      } else if (row.employment_type === "intern") {
        trackingLabel = "HORAS DE PRÁCTICA";
        trackingTitle = inventoryNumber(row.completed_service_hours || 0) + " / " + inventoryNumber(row.required_service_hours || 0) + " h";
        trackingDetail = inventoryNumber(row.remaining_service_hours || 0) + " h pendientes · " + inventoryNumber(row.service_progress_percent || 0) + "%";
      }
      const timeline = hrEmploymentTimeline(row);
      return '<article class="hr-employee-card"><div class="hr-employee-identity">' + portrait + '<div><small>' + escapeHtml(row.employee_number) + '</small><strong>' + escapeHtml(row.full_name) + '</strong><p>' + escapeHtml(row.email || row.phone || "Sin contacto") + '</p></div>' + workforceStatus(row.status) + '</div><div class="hr-employee-work"><div><span>ÁREA Y PUESTO</span><strong>' + escapeHtml(row.area_name || "Sin área") + '</strong><small>' + escapeHtml(row.job_position_name || row.position || "Sin puesto") + '</small></div><div><span>TURNO · ' + escapeHtml(hrEmployment(row.employment_type)) + '</span><strong>' + escapeHtml(shiftTitle) + '</strong><small>' + escapeHtml(shiftDetail) + '</small></div></div><div class="hr-employee-facts"><div><span>' + trackingLabel + '</span><strong>' + escapeHtml(trackingTitle) + '</strong><small>' + escapeHtml(trackingDetail) + '</small></div><div><span>' + escapeHtml(timeline.label) + '</span><strong>' + escapeHtml(timeline.title) + '</strong><small>' + escapeHtml(timeline.detail) + '</small></div></div><div class="hr-employee-manage">' + actions + '</div></article>';
    }).join("");
    const requestRows = recentLeaves.map((row) => '<div class="hr-request-row" data-hr-request-row="' + row.id + '"><span class="hr-request-kind">' + hrLeaveSymbol(row.leave_type) + '</span><div><strong>' + escapeHtml(row.employee_name) + ' · ' + escapeHtml(row.folio) + '</strong><small>' + hrLeaveLabel(row.leave_type) + ' · ' + formatDateOnly(row.start_date) + ' — ' + formatDateOnly(row.end_date) + '</small><small>' + (row.current_approval_step === "manager" ? "Pendiente Jefe de área" : row.current_approval_step === "hr" ? "Pendiente Administrador RH" : "Flujo concluido") + (row.coverage?.withinLimit === false ? " · ⚠ Cupo de ausencias excedido" : "") + '</small></div>' + workforceStatus(row.status) + '<div class="hr-request-actions">' + hrLeaveActions(row) + '</div></div>').join("");
    const activityColumn = '<aside class="hr-activity-column"><article class="panel"><div class="panel-head"><div><h3>Solicitudes y ausencias</h3><p>Permisos, vacaciones e incapacidades.</p></div><span>' + pending.length + ' PENDIENTE(S)</span></div><div class="compact-list">' + (requestRows || emptyMarkup("Sin solicitudes", "Las solicitudes creadas desde cada trabajador aparecerán aquí.")) + '</div></article></aside>';
    const addPerson = hasPermission("hr.manage") ? '<button class="button primary small" type="button" data-hr-new="person">＋ Agregar personal</button>' : "";
    const teamColumn = '<section class="panel hr-team-panel"><div class="panel-head"><div><span class="eyebrow">GESTIÓN DESDE LA PERSONA</span><h3>Mi equipo</h3><p>El personal guardado aquí también aparece en Datos Maestros.</p></div><div class="hr-team-head-actions"><span>' + control.people.length + ' PERSONA(S)</span>' + addPerson + '</div></div><div class="hr-team-summary"><div><strong>' + control.indicators.activePeople + '</strong><span>ACTIVOS</span></div><div><strong>' + pending.length + '</strong><span>POR APROBAR</span></div><div><strong>' + control.indicators.staffEntriesMonth + '</strong><span>ALTAS DEL MES</span></div><div><strong>' + inventoryNumber(control.indicators.turnoverRate || 0) + '%</strong><span>ROTACIÓN DEL MES</span></div></div><div class="hr-employee-list">' + (employeeCards || emptyMarkup("No hay personal registrado", "Agrega el primer expediente para comenzar.")) + '</div></section>';
    return '<section class="hr-unified-layout">' + activityColumn + teamColumn + '</section>';
  }
  
  function hrLeaveLabel(type) { return ({ permission: "Permiso", vacation: "Vacaciones", incapacity: "Incapacidad" })[type] || type; }
  function hrLeaveSymbol(type) { return ({ permission: "P", vacation: "V", incapacity: "+" })[type] || "·"; }
  
  function hrPeopleScene(control) {
    const pending = control.indicators.pendingRequests;
    const turnover = inventoryNumber(control.indicators.turnoverRate || 0);
    return '<aside class="workforce-scene hr-scene" aria-label="Resumen operativo de Recursos Humanos"><header class="hr-overview-head"><div><span>RESUMEN OPERATIVO</span><strong>Actividad del equipo</strong></div><small><i></i>Actualizado</small></header><div class="hr-overview-grid"><article class="hr-overview-card requests"><span class="hr-overview-number">01</span><div><small>SOLICITUDES</small><strong>' + pending + '</strong><p>pendientes de revisión</p></div><span class="hr-overview-visual request" aria-hidden="true"><i></i><i></i><b>✓</b></span></article><article class="hr-overview-card movements"><span class="hr-overview-number">02</span><div><small>MOVIMIENTOS DEL MES</small><strong>' + control.indicators.staffEntriesMonth + ' <em>altas</em></strong><p>' + control.indicators.staffExitsMonth + ' bajas registradas</p></div><span class="hr-overview-visual movement" aria-hidden="true"><i></i><i></i><i></i></span></article><article class="hr-overview-card turnover"><span class="hr-overview-number">03</span><div><small>ROTACIÓN DEL MES</small><strong>' + turnover + '%</strong><p>seguimiento de plantilla</p></div><span class="hr-overview-visual rotation" aria-hidden="true" style="--hr-turnover:' + Math.min(100, Math.max(0, Number(turnover) || 0)) + '"><i></i></span></article></div><footer class="hr-overview-footer"><span><i></i>Información sincronizada</span><strong>PERSONAL · SOLICITUDES · MOVIMIENTOS</strong></footer></aside>';
  }
  
  function hrEmploymentDetailsMarkup(person = {}) {
    const value = (field) => escapeAttribute(person[field] || "");
    return '<section class="hr-employment-section span-two hidden" data-employment-section="temporary"><div class="hr-employment-section-head"><span>CONTRATO TEMPORAL</span></div><div class="form-grid"><label>Fin del contrato<input name="contractEndDate" type="date" value="' + value("contract_end_date") + '" data-employment-required /></label></div></section>' +
      '<section class="hr-employment-section span-two hidden" data-employment-section="contractor"><div class="hr-employment-section-head"><span>EMPRESA DE PROCEDENCIA</span></div><div class="form-grid"><label>Empresa perteneciente<input name="organizationName" maxlength="180" value="' + value("organization_name") + '" data-employment-required /></label><label>Contacto de la empresa<input name="organizationContactName" maxlength="180" value="' + value("organization_contact_name") + '" /></label><label>Teléfono de la empresa<input name="organizationContactPhone" maxlength="40" value="' + value("organization_contact_phone") + '" /></label><label>Correo de la empresa<input name="organizationContactEmail" type="email" maxlength="180" value="' + value("organization_contact_email") + '" /></label><label>Inicio del servicio<input name="serviceStartDate" type="date" value="' + value("service_start_date") + '" data-employment-required /></label><label>Fin del servicio<input name="serviceEndDate" type="date" value="' + value("service_end_date") + '" data-employment-required /></label><div class="hr-tracking-summary span-two" data-contractor-days><span>DÍAS PROGRAMADOS</span><strong>' + inventoryNumber(person.service_total_days || 0) + '</strong><small>Se calculan automáticamente con el periodo de servicio.</small></div><label class="span-two">Datos de la empresa<textarea name="organizationDetails" rows="2" placeholder="Dirección, especialidad o información de referencia">' + escapeHtml(person.organization_details || "") + '</textarea></label></div></section>' +
      '<section class="hr-employment-section span-two hidden" data-employment-section="intern"><div class="hr-employment-section-head"><span>INSTITUCIÓN Y ASESOR</span></div><div class="form-grid"><label>Institución<input name="organizationName" maxlength="180" value="' + value("organization_name") + '" data-employment-required /></label><label>Contacto de la institución<input name="organizationContactName" maxlength="180" value="' + value("organization_contact_name") + '" /></label><label>Teléfono de la institución<input name="organizationContactPhone" maxlength="40" value="' + value("organization_contact_phone") + '" /></label><label>Correo de la institución<input name="organizationContactEmail" type="email" maxlength="180" value="' + value("organization_contact_email") + '" /></label><label>Inicio de prácticas<input name="serviceStartDate" type="date" value="' + value("service_start_date") + '" data-employment-required /></label><label>Fin de prácticas<input name="serviceEndDate" type="date" value="' + value("service_end_date") + '" data-employment-required /></label><label>Horas requeridas<input name="requiredServiceHours" type="number" min="1" step="0.5" value="' + value("required_service_hours") + '" data-employment-required /></label><div class="hr-tracking-summary"><span>HORAS PLANEADAS</span><strong data-intern-planned-hours>' + inventoryNumber(person.planned_service_hours || 0) + '</strong><small>Calculadas con el turno y el periodo.</small></div><div class="hr-intern-progress span-two"><div><span>HORAS ACUMULADAS</span><strong data-intern-completed-hours>' + inventoryNumber(person.completed_service_hours || 0) + '</strong></div><div><span>HORAS PENDIENTES</span><strong data-intern-remaining-hours>' + inventoryNumber(person.remaining_service_hours || person.required_service_hours || 0) + '</strong></div><div><span>AVANCE</span><strong data-intern-progress>' + inventoryNumber(person.service_progress_percent || 0) + '%</strong></div></div><label class="span-two">Datos de la institución<textarea name="organizationDetails" rows="2" placeholder="Carrera, plantel, dirección o convenio">' + escapeHtml(person.organization_details || "") + '</textarea></label><label>Asesor responsable<input name="advisorName" maxlength="180" value="' + value("advisor_name") + '" data-employment-required /></label><label>Teléfono del asesor<input name="advisorPhone" maxlength="40" value="' + value("advisor_phone") + '" /></label><label>Correo del asesor<input name="advisorEmail" type="email" maxlength="180" value="' + value("advisor_email") + '" /></label></div></section>';
  }
  
  function hrServiceDayCount(startDate, endDate) {
    if (!startDate || !endDate || endDate < startDate) return 0;
    return Math.floor((Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000) + 1;
  }
  
  function hrDaysUntil(date) {
    if (!date) return null;
    return Math.ceil((Date.parse(date + "T00:00:00Z") - Date.parse(todayInput() + "T00:00:00Z")) / 86400000);
  }
  
  function hrEmploymentTimeline(person) {
    if (person.employment_type === "permanent") {
      const years = hrServiceYears(person.hire_date);
      return {
        label: "ANTIGÜEDAD",
        title: years + (years === 1 ? " año" : " años"),
        detail: person.hire_date ? "Alta " + formatDateOnly(person.hire_date) : "Sin fecha de alta",
      };
    }
    const endDate = person.employment_type === "temporary" ? person.contract_end_date : person.service_end_date;
    const label = ({
      temporary: "FIN DE CONTRATO",
      contractor: "FIN DE SERVICIO",
      intern: "FIN DE PRÁCTICAS",
    })[person.employment_type] || "RELACIÓN LABORAL";
    const remainingDays = hrDaysUntil(endDate);
    let detail = hrEmployment(person.employment_type);
    if (remainingDays != null) {
      detail = remainingDays < 0 ? "Periodo concluido"
        : remainingDays === 0 ? "Concluye hoy"
          : remainingDays + (remainingDays === 1 ? " día restante" : " días restantes");
    }
    return {
      label,
      title: endDate ? formatDateOnly(endDate) : "Sin fecha definida",
      detail,
    };
  }
  
  function hrPlannedShiftHours(shift, startDate, endDate) {
    if (!shift || !startDate || !endDate || endDate < startDate) return 0;
    const schedule = hrParsedShiftSchedule(shift.schedule_json);
    const groups = schedule.length ? schedule : [{
      days: String(shift.work_days || "").split(",").filter(Boolean),
      periods: [{ start: shift.start_time, end: shift.end_time }],
    }];
    const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const cursor = new Date(startDate + "T00:00:00Z");
    const limit = new Date(endDate + "T00:00:00Z");
    let minutes = 0;
    let iterations = 0;
    while (cursor <= limit && iterations < 3660) {
      const day = dayKeys[cursor.getUTCDay()];
      groups.filter((group) => group.days?.includes(day)).forEach((group) => {
        (group.periods || []).forEach((period) => {
          const [startHour, startMinute] = String(period.start || "").split(":").map(Number);
          const [endHour, endMinute] = String(period.end || "").split(":").map(Number);
          if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return;
          let duration = endHour * 60 + endMinute - (startHour * 60 + startMinute);
          if (duration <= 0) duration += 1440;
          minutes += Math.min(duration, 1440);
        });
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      iterations += 1;
    }
    return Math.round(minutes / 60 * 100) / 100;
  }
  
  function bindHrEmploymentRules(form, vacationPlans, workShifts) {
    const employmentSelect = $('[name="employmentType"]', form);
    const hireDateInput = $('[name="hireDate"]', form);
    const shiftSelect = $('[name="workShiftId"]', form);
    const shiftSummary = $("[data-hr-shift-summary]", form) || $("#hr-edit-shift-summary", form) || $("#hr-shift-summary", form);
    const vacationSummary = $("[data-hr-vacation-plan]", form) || $("#hr-edit-vacation-plan", form) || $("#hr-vacation-plan-preview", form);
    const senioritySummary = $("[data-hr-seniority]", form) || $("#hr-edit-seniority", form) || $("#hr-seniority-preview", form);
    const shiftField = shiftSelect.closest("label");
    const shiftSummaryField = shiftSummary.closest(".hr-derived-field");
    const updateShift = () => {
      if (employmentSelect.value === "contractor") {
        shiftSummary.textContent = "No aplica para contratistas";
        return;
      }
      const shift = workShifts.find((row) => row.id === Number(shiftSelect.value));
      shiftSummary.textContent = shift ? hrShiftCatalogSummary(shift) : "Sin turno seleccionado";
    };
    const update = () => {
      const type = employmentSelect.value;
      $$("[data-employment-section]", form).forEach((section) => {
        const active = section.dataset.employmentSection === type;
        section.classList.toggle("hidden", !active);
        $$("input, textarea, select", section).forEach((input) => {
          input.disabled = !active;
          input.required = active && input.hasAttribute("data-employment-required");
        });
      });
      const contractor = type === "contractor";
      shiftField.classList.toggle("hidden", contractor);
      shiftSummaryField.classList.toggle("hidden", contractor);
      if (contractor) {
        if (shiftSelect.value) shiftSelect.dataset.previousValue = shiftSelect.value;
        shiftSelect.value = "";
        shiftSelect.disabled = true;
      } else {
        shiftSelect.disabled = false;
        if (!shiftSelect.value && shiftSelect.dataset.previousValue) shiftSelect.value = shiftSelect.dataset.previousValue;
      }
      if (type === "permanent") {
        const years = hrServiceYears(hireDateInput.value);
        const plan = hrAutomaticVacationPlan(vacationPlans, hireDateInput.value);
        vacationSummary.textContent = plan
          ? plan.name + " · " + inventoryNumber(plan.annual_days) + " días"
          : "0 días · Disponible al cumplir 1 año";
        senioritySummary.textContent = years + (years === 1 ? " año" : " años");
      } else {
        vacationSummary.textContent = "No aplica · Sin vacaciones";
        senioritySummary.textContent = "No genera antigüedad";
      }
      if (type === "contractor") {
        const section = $('[data-employment-section="contractor"]', form);
        const start = $('[name="serviceStartDate"]', section)?.value;
        const end = $('[name="serviceEndDate"]', section)?.value;
        $("strong", $("[data-contractor-days]", section)).textContent = inventoryNumber(hrServiceDayCount(start, end));
      }
      if (type === "intern") {
        const section = $('[data-employment-section="intern"]', form);
        const start = $('[name="serviceStartDate"]', section)?.value;
        const end = $('[name="serviceEndDate"]', section)?.value;
        const requiredHours = Number($('[name="requiredServiceHours"]', section)?.value || 0);
        const shift = workShifts.find((row) => row.id === Number(shiftSelect.value));
        const plannedHours = hrPlannedShiftHours(shift, start, end);
        $("[data-intern-planned-hours]", section).textContent = inventoryNumber(plannedHours);
        const currentDate = todayInput();
        const elapsedEnd = start && currentDate >= start ? (end && currentDate > end ? end : currentDate) : "";
        const scheduledHours = hrPlannedShiftHours(shift, start, elapsedEnd);
        const completed = Math.min(requiredHours, scheduledHours);
        $("[data-intern-completed-hours]", section).textContent = inventoryNumber(completed);
        $("[data-intern-remaining-hours]", section).textContent = inventoryNumber(Math.max(0, requiredHours - completed));
        $("[data-intern-progress]", section).textContent = inventoryNumber(requiredHours > 0 ? Math.min(100, Math.round(completed / requiredHours * 100)) : 0) + "%";
      }
      updateShift();
    };
    employmentSelect.onchange = update;
    hireDateInput.onchange = update;
    shiftSelect.onchange = update;
    $$('[name="serviceStartDate"], [name="serviceEndDate"], [name="requiredServiceHours"]', form)
      .forEach((input) => { input.onchange = update; input.oninput = update; });
    update();
  }
  
  function hrLeaveActions(row) {
    const actions = ['<button class="link-button" type="button" data-hr-print="' + row.id + '">Imprimir</button>'];
    if (row.status === "submitted" && hasPermission("hr.approve")) {
      actions.push('<button class="button primary small" data-hr-action="approve" data-hr-step="' + escapeAttribute(row.current_approval_step) + '" data-hr-id="' + row.id + '">Aprobar</button>');
      actions.push('<button class="button ghost small danger-text" data-hr-action="reject" data-hr-step="' + escapeAttribute(row.current_approval_step) + '" data-hr-id="' + row.id + '">Rechazar</button>');
    }
    if (row.status === "approved" && hasPermission("hr.operate"))
      actions.push('<button class="link-button" data-hr-action="close" data-hr-id="' + row.id + '">Cerrar</button>');
    return actions.join("");
  }
  
  function hrLeaveStatusLabel(status) {
    return ({ submitted: "Pendiente de autorización", approved: "Aprobada", rejected: "Rechazada",
      cancelled: "Cancelada", closed: "Cerrada" })[status] || status || "Sin estado";
  }
  
  function hrLeavePrintDocument(receipt) {
    const request = receipt.request || {};
    const balance = receipt.balance;
    const stylesheetUrl = escapeAttribute(new URL("./hr-receipt.css?v=20260826-01", window.location.href).href);
    const logoUrl = escapeAttribute(new URL("./assets/abicorp-logo.png", window.location.href).href);
    const issuedAt = escapeHtml(new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short" }).format(new Date()));
    const balanceRows = request.leave_type === "vacation" && balance ? `
      <section class="receipt-balance" aria-label="Saldo de vacaciones"><div><span>Saldo inicial</span><strong>${inventoryNumber(balance.available_before)} días</strong></div><div><span>Solicitados</span><strong>${inventoryNumber(balance.requested_days)} días</strong></div><div><span>Saldo proyectado</span><strong>${inventoryNumber(balance.available_after)} días</strong></div><div class="${Number(balance.advance_days) > 0 ? "warning" : ""}"><span>Anticipados</span><strong>${inventoryNumber(balance.advance_days)} días</strong></div></section>` : "";
    const history = (receipt.history || []).map((entry) => `<tr><td>${formatDate(entry.created_at)}</td><td>${escapeHtml(entry.actor_name || entry.actor_type || "Sistema")}</td><td>${escapeHtml(hrLeaveStatusLabel(entry.new_status))}</td><td>${escapeHtml(entry.comments || "—")}</td></tr>`).join("");
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(request.folio || "Solicitud")}</title><link rel="stylesheet" href="${stylesheetUrl}"></head><body><main class="receipt-sheet">
      <header class="receipt-header"><div class="receipt-brand"><img src="${logoUrl}" alt=""><div><strong>ABICORP</strong><span>ERP MODULAR · RECURSOS HUMANOS</span></div></div><div class="receipt-reference"><span>Folio de control</span><strong>${escapeHtml(request.folio || "—")}</strong><b>${escapeHtml(hrLeaveStatusLabel(request.status))}</b></div></header>
      <section class="receipt-hero"><div><span>COMPROBANTE DE SOLICITUD</span><h1>${escapeHtml(hrLeaveLabel(request.leave_type))}</h1><p>Registro oficial del proceso de vacaciones, permisos e incapacidades.</p></div><aside><span>Días hábiles</span><strong>${inventoryNumber(request.working_days || request.total_days)}</strong><small>${formatDateOnly(request.start_date)} — ${formatDateOnly(request.end_date)}</small></aside></section>
      <section class="receipt-section"><header><span>01</span><div><strong>Identidad laboral</strong><small>Colaborador y adscripción organizacional</small></div></header><div class="receipt-grid"><div><span>Colaborador</span><strong>${escapeHtml(request.employee_name || "—")}</strong></div><div><span>ID laboral</span><strong>${escapeHtml(request.employee_number || "—")}</strong></div><div><span>Empresa y centro</span><strong>${escapeHtml([request.company_name, request.work_center_name].filter(Boolean).join(" · ") || "Sin asignar")}</strong></div><div><span>Departamento y área</span><strong>${escapeHtml([request.department_name, request.area_name].filter(Boolean).join(" · ") || "Sin asignar")}</strong></div><div><span>Puesto</span><strong>${escapeHtml(request.position_name || "Sin asignar")}</strong></div><div><span>Tipo de solicitud</span><strong>${escapeHtml(request.subtype || "Sin subtipo")}</strong></div></div></section>
      <section class="receipt-section"><header><span>02</span><div><strong>Detalle de la solicitud</strong><small>Periodo y motivo capturado</small></div></header><div class="receipt-period"><div><span>Fecha inicial</span><strong>${formatDateOnly(request.start_date)}</strong></div><i>→</i><div><span>Fecha final</span><strong>${formatDateOnly(request.end_date)}</strong></div><div><span>Días hábiles</span><strong>${inventoryNumber(request.working_days || request.total_days)} día(s)</strong></div></div><div class="receipt-reason"><span>Motivo registrado</span><p>${escapeHtml(request.reason || "—")}</p></div>${balanceRows}${request.status === "submitted" ? '<div class="receipt-notice"><strong>Saldo provisional</strong><span>El saldo mostrado es una proyección. El movimiento definitivo se aplicará cuando Recursos Humanos autorice la solicitud.</span></div>' : ""}</section>
      <section class="receipt-section receipt-history-section"><header><span>03</span><div><strong>Historial de autorización</strong><small>Trazabilidad conservada por el sistema</small></div></header><div class="receipt-table-wrap"><table class="receipt-history"><thead><tr><th>Fecha</th><th>Responsable</th><th>Estado</th><th>Observación</th></tr></thead><tbody>${history || '<tr><td colspan="4">Sin movimientos registrados.</td></tr>'}</tbody></table></div></section>
      <section class="receipt-signatures"><div><span></span><strong>Firma del colaborador</strong><small>${escapeHtml(request.employee_name || "")}</small></div><div><span></span><strong>Administrador de Recursos Humanos</strong><small>Validación y sello</small></div></section>
      <footer class="receipt-footer"><p>Emitido el ${issuedAt} · Impresión registrada: ${Number(receipt.printCount || 0)}</p><p>Documento generado por ABICORP ERP. Conserva el folio para cualquier aclaración.</p></footer>
    </main><nav class="receipt-toolbar" aria-label="Acciones del comprobante"><button class="secondary" data-print-close>Cerrar</button><button data-print-action>Imprimir / Guardar PDF</button></nav></body></html>`;
  }
  
  function showHrLeaveConfirmation(result) {
    const receipt = result.receipt || {}, request = receipt.request || {}, balance = receipt.balance;
    $("#entity-modal-content").classList.remove("wide", "hr-person-modal");
    $("#entity-modal-content").innerHTML = '<section class="hr-leave-confirmation"><div class="hr-leave-confirmation-icon">✓</div><span class="eyebrow">SOLICITUD REGISTRADA</span><h2>' + escapeHtml(result.folio) + '</h2><p>El registro quedó guardado y ya forma parte del historial del colaborador.</p><div class="hr-leave-confirmation-grid"><div><span>Colaborador</span><strong>' + escapeHtml(request.employee_name || "—") + '</strong></div><div><span>Periodo</span><strong>' + formatDateOnly(request.start_date) + ' — ' + formatDateOnly(request.end_date) + '</strong></div><div><span>Días hábiles</span><strong>' + inventoryNumber(result.workingDays) + '</strong></div><div><span>Estado</span><strong>' + escapeHtml(hrLeaveStatusLabel(request.status)) + '</strong></div>' + (balance ? '<div><span>Saldo anterior</span><strong>' + inventoryNumber(balance.available_before) + ' días</strong></div><div class="' + (Number(balance.advance_days) > 0 ? "warning" : "") + '"><span>Saldo proyectado</span><strong>' + inventoryNumber(balance.available_after) + ' días</strong></div>' : "") + '</div>' + (balance && Number(balance.advance_days) > 0 ? '<p class="hr-leave-advance-note">La solicitud incluye ' + inventoryNumber(balance.advance_days) + ' día(s) anticipado(s) y requiere autorización de RH.</p>' : '<p class="hr-leave-saved-note">El saldo se actualizará cuando Recursos Humanos autorice la solicitud.</p>') + '<div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cerrar</button><button type="button" class="button primary" data-print-created>Imprimir comprobante</button></div></section>';
    $("[data-print-created]", $("#entity-modal-content")).onclick = () => printHrLeaveReceipt(result.id);
  }
  
  async function printHrLeaveReceipt(id) {
    const printWindow = window.open("", "_blank", "width=980,height=820");
    if (!printWindow) return toast("Permite las ventanas emergentes para imprimir el comprobante.", "error");
    const stylesheetUrl = escapeAttribute(new URL("./hr-receipt.css?v=20260826-01", window.location.href).href);
    printWindow.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Preparando comprobante</title><link rel="stylesheet" href="' + stylesheetUrl + '"></head><body class="receipt-loading-page"><main class="receipt-loading"><span></span><strong>Preparando comprobante</strong><p>Registrando la emisión y organizando el documento…</p></main></body></html>');
    printWindow.document.close();
    try {
      const { receipt } = await api("/api/hr/leaves/" + id + "/print", { method: "POST", body: {} });
      printWindow.document.open();
      printWindow.document.write(hrLeavePrintDocument(receipt));
      printWindow.document.close();
      printWindow.document.querySelector("[data-print-close]").onclick = () => printWindow.close();
      printWindow.document.querySelector("[data-print-action]").onclick = () => printWindow.print();
      printWindow.focus();
    } catch (error) {
      printWindow.close();
      toast(error.message, "error");
    }
  }
  
  const HR_SHIFT_DAYS = [["mon", "Lun"], ["tue", "Mar"], ["wed", "Mié"], ["thu", "Jue"], ["fri", "Vie"], ["sat", "Sáb"], ["sun", "Dom"]];
  
  function normalizeHrTimeEntry(value) {
    const clean = String(value || "").trim().replace(/[^\d:]/g, "");
    if (!clean) return "";
    let hours;
    let minutes;
    if (clean.includes(":")) {
      [hours, minutes = "00"] = clean.split(":");
    } else {
      const digits = clean.slice(0, 4);
      hours = digits.length <= 2 ? digits : digits.slice(0, -2);
      minutes = digits.length <= 2 ? "00" : digits.slice(-2);
    }
    const hourNumber = Number(hours);
    const minuteNumber = Number(minutes);
    if (!Number.isInteger(hourNumber) || !Number.isInteger(minuteNumber) || hourNumber > 23 || minuteNumber > 59) return clean;
    return String(hourNumber).padStart(2, "0") + ":" + String(minuteNumber).padStart(2, "0");
  }
  
  function addHrShiftScheduleGroup(container, selectedDays = [], periods = []) {
    if ($$("[data-shift-group]", container).length >= 7) return toast("Un turno admite hasta siete horarios distintos.", "error");
    const section = document.createElement("section");
    section.className = "hr-shift-schedule-card";
    section.dataset.shiftGroup = "";
    section.innerHTML = '<header><div><strong>Horario semanal</strong><small>Selecciona los días que comparten estas horas.</small></div><button type="button" data-remove-shift-group aria-label="Quitar este horario">×</button></header><fieldset class="hr-work-days"><legend>Días aplicables</legend>' +
      HR_SHIFT_DAYS.map(([value, label]) => '<label><input type="checkbox" data-shift-day value="' + value + '" ' + (selectedDays.includes(value) ? "checked" : "") + ' /><span>' + label + '</span></label>').join("") +
      '</fieldset><div class="hr-shift-period-grid"><label>Entrada<input class="hr-time-entry" type="text" inputmode="numeric" maxlength="5" pattern="(?:[01]\\d|2[0-3]):[0-5]\\d" placeholder="09:00" data-shift-time="start-1" required /></label><label>Salida<input class="hr-time-entry" type="text" inputmode="numeric" maxlength="5" pattern="(?:[01]\\d|2[0-3]):[0-5]\\d" placeholder="14:00" data-shift-time="end-1" required /></label><label>Regreso <small>Opcional</small><input class="hr-time-entry" type="text" inputmode="numeric" maxlength="5" pattern="(?:[01]\\d|2[0-3]):[0-5]\\d" placeholder="16:00" data-shift-time="start-2" /></label><label>Salida final <small>Opcional</small><input class="hr-time-entry" type="text" inputmode="numeric" maxlength="5" pattern="(?:[01]\\d|2[0-3]):[0-5]\\d" placeholder="19:00" data-shift-time="end-2" /></label></div>';
    container.append(section);
    const first = periods[0] || {};
    const second = periods[1] || {};
    $('[data-shift-time="start-1"]', section).value = first.start || "";
    $('[data-shift-time="end-1"]', section).value = first.end || "";
    $('[data-shift-time="start-2"]', section).value = second.start || "";
    $('[data-shift-time="end-2"]', section).value = second.end || "";
    $$("[data-shift-time]", section).forEach((input) => {
      input.addEventListener("input", () => {
        input.value = input.value.replace(/[^\d:]/g, "").slice(0, 5);
        input.setCustomValidity("");
      });
      input.addEventListener("blur", () => {
        input.value = normalizeHrTimeEntry(input.value);
        input.setCustomValidity(input.value && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.value) ? "Usa una hora válida en formato HH:MM." : "");
      });
    });
    $("[data-remove-shift-group]", section).onclick = () => {
      if ($$("[data-shift-group]", container).length === 1) return toast("El turno debe conservar al menos un horario.", "error");
      section.remove();
    };
  }
  
  function readHrShiftSchedule(form) {
    return $$("[data-shift-group]", form).map((group) => {
      const value = (name) => normalizeHrTimeEntry($('[data-shift-time="' + name + '"]', group).value);
      const periods = [{ start: value("start-1"), end: value("end-1") }];
      if (value("start-2") || value("end-2")) periods.push({ start: value("start-2"), end: value("end-2") });
      return {
        days: $$("[data-shift-day]:checked", group).map((input) => input.value),
        periods,
      };
    });
  }
  
  function hrCatalogUsage(field, id) {
    return (state.hrControl?.people || []).filter((person) => Number(person[field]) === Number(id)).length;
  }
  
  function hrShiftScheduleGroups(shift) {
    try {
      const groups = JSON.parse(shift?.schedule_json || "[]");
      if (Array.isArray(groups) && groups.length) return groups;
    } catch {}
    return [{
      days: String(shift?.work_days || "").split(",").filter(Boolean),
      periods: [{ start: shift?.start_time || "", end: shift?.end_time || "" }],
    }];
  }
  
  function hrCatalogRecord(row, type, summary, linked, editable = true, extraActions = "") {
    return '<li class="hr-catalog-record"><div><strong>' + escapeHtml(row.name) + '</strong><small>' + escapeHtml(summary) + '</small></div><div class="hr-catalog-record-meta"><span>' + escapeHtml(row.code) + '</span><small>' + linked + ' colaborador(es)</small>' + extraActions + (editable ? '<button type="button" data-edit-hr-catalog="' + type + '" data-record-id="' + row.id + '">Editar</button>' : "") + '</div></li>';
  }
  
  async function openHrCatalogsModal(section = "areas", confirmation = "", editingId = null) {
    let policyData = { settings: {}, holidays: [], absenceLimits: [] };
    if (["policies", "holidays"].includes(section)) {
      try { policyData = await api("/api/hr/policies", { cache: false }); }
      catch (error) { toast(error.message, "error"); return; }
    }
    const o = state.hrOptions || {};
    const jobPositions = Array.isArray(o.jobPositions) ? o.jobPositions : [];
    const workShifts = Array.isArray(o.workShifts) ? o.workShifts : [];
    const vacationPlans = Array.isArray(o.vacationPlans) ? o.vacationPlans : [];
    const areas = Array.isArray(o.areaCatalog) ? o.areaCatalog : Array.isArray(o.areas) ? o.areas : [];
    const canManageAreas = hasPermission("areas.manage") || hasPermission("hr.approve");
    const sections = {
      areas: { number: "01", label: "Áreas", hint: "Estructura funcional del personal", records: areas },
      positions: { number: "02", label: "Puestos", hint: "Descriptivos y perfiles de puesto", records: jobPositions },
      shifts: { number: "03", label: "Turnos y horarios", hint: "Jornadas y calendarios", records: workShifts },
      vacations: { number: "04", label: "Planes de vacaciones", hint: "Días según antigüedad", records: vacationPlans },
      holidays: { number: "05", label: "Fechas feriadas", hint: "Días no laborables del calendario", records: policyData.holidays },
      policies: { number: "06", label: "Políticas y cobertura", hint: "Reglas de solicitudes y límites de ausencia", records: policyData.absenceLimits },
    };
    if (!sections[section]) section = "positions";
    const active = sections[section];
    const editing = editingId == null ? null : active.records.find((row) => row.id === Number(editingId));
    $("#entity-modal-content").classList.add("wide", "hr-catalog-modal");
  
    const submenu = Object.entries(sections).map(([key, item]) =>
      '<button type="button" class="' + (section === key ? "active" : "") + '" data-hr-catalog-section="' + key + '"><span>' + item.number + '</span><div><strong>' + item.label + '</strong><small>' + item.hint + '</small></div><b>' + item.records.length + '</b></button>'
    ).join("");
  
    let rows = "";
    let form = "";
    if (section === "holidays") {
      rows = policyData.holidays.map((row) => '<li class="hr-catalog-record hr-holiday-record"><div><strong>' + escapeHtml(row.name) + '</strong><small>' + formatDateOnly(row.holiday_date) + ' · No laborable</small></div><div class="hr-catalog-record-meta"><span>FERIADO</span><button class="link-button danger-text" type="button" data-delete-holiday="' + row.id + '">Quitar</button></div></li>').join("");
      form = '<form id="hr-holiday-form" class="hr-catalog-editor"><div class="hr-catalog-editor-head"><div><span>NUEVA FECHA FERIADA</span><h3>Agregar al calendario</h3></div></div><div class="form-grid compact"><label>Fecha<input name="date" type="date" required></label><label>Nombre<input name="name" maxlength="140" required placeholder="Ej. Día festivo oficial"></label></div><p class="muted">La fecha aparecerá automáticamente en los horarios de RH y de los colaboradores.</p><button class="button primary" type="submit">＋ Agregar fecha feriada</button></form>';
    } else if (section === "policies") {
      const settings = policyData.settings || {};
      const limitRows = policyData.absenceLimits.map((row) => '<form class="hr-absence-limit" data-absence-limit="' + row.department_id + '"><strong>' + escapeHtml(row.department_name) + '</strong><label>Máx. ausentes<input name="maximumAbsent" type="number" min="0" value="' + row.maximum_absent + '"></label><label>Mín. disponibles<input name="minimumAvailable" type="number" min="0" value="' + row.minimum_available + '"></label><button class="button ghost small" type="submit">Guardar</button></form>').join("");
      form = '<div class="hr-policy-catalog"><section><div class="panel-head"><div><h3>Reglas de solicitudes</h3><p>Parámetros generales para vacaciones, permisos y sesiones del portal.</p></div></div><form id="hr-policy-settings" class="hr-catalog-editor"><label class="toggle-line"><input type="checkbox" name="managerApprovalRequired" ' + (settings.manager_approval_required ? "checked" : "") + '><span><strong>Requerir autorización del Jefe de área</strong><small>Si no existe jefe asignado, la solicitud pasa directamente al Administrador RH.</small></span></label><div class="form-grid"><label>Duración de sesión<input name="sessionHours" type="number" min="1" max="24" value="' + Number(settings.session_hours || 6) + '"></label><label>PIN temporal vigente<input name="activationHours" type="number" min="1" max="24" value="' + Number(settings.activation_hours || 6) + '"></label><label>Anticipación mínima (días)<input name="minimumAdvanceDays" type="number" min="0" max="90" value="' + Number(settings.minimum_advance_days || 0) + '"></label><label>Cobertura mínima (%)<input name="minimumCoveragePercent" type="number" min="0" max="100" value="' + Number(settings.minimum_coverage_percent || 0) + '"></label></div><div class="hr-portal-permissions"><label><input type="checkbox" name="excludeWeekends" ' + (settings.exclude_weekends ? "checked" : "") + '><span>No contar fines de semana</span></label><label><input type="checkbox" name="excludeHolidays" ' + (settings.exclude_holidays ? "checked" : "") + '><span>No contar días festivos</span></label></div><button class="button primary" type="submit">Guardar políticas</button></form></section>' +
        '<section><div class="panel-head"><div><h3>Cobertura por departamento</h3><p>Define el cupo máximo de ausencias y la plantilla mínima disponible.</p></div></div><div class="hr-absence-limits">' + (limitRows || emptyMarkup("Sin departamentos", "Crea departamentos para definir su cobertura.")) + '</div></section></div>';
    } else if (section === "areas") {
      rows = areas.map((row) => hrCatalogRecord(row, "areas", (row.description || "Sin descripción") + (row.is_active ? " · Activa" : " · Inactiva"),
        hrCatalogUsage("area_id", row.id), canManageAreas)).join("");
      form = canManageAreas
        ? '<form id="hr-area-form" class="hr-catalog-editor"><div class="hr-catalog-editor-head"><div><span>' + (editing ? "EDITAR ÁREA" : "NUEVA ÁREA") + '</span><h3>' + (editing ? escapeHtml(editing.name) : "Agregar área") + '</h3></div>' + (editing ? '<button type="button" data-cancel-hr-catalog-edit>Cancelar edición</button>' : "") + '</div><div class="form-grid compact"><label>Código<input name="code" maxlength="30" pattern="[A-Za-z0-9_-]{2,30}" required placeholder="Ej. ALM" value="' + escapeAttribute(editing?.code || "") + '" ' + (editing ? "disabled" : "") + ' /></label><label>Nombre del área<input name="name" maxlength="120" required placeholder="Ej. Almacén" value="' + escapeAttribute(editing?.name || "") + '" /></label>' + (editing ? '<label>Estado<select name="isActive"><option value="true" ' + (editing.is_active ? "selected" : "") + '>Activa</option><option value="false" ' + (!editing.is_active ? "selected" : "") + '>Inactiva</option></select></label>' : "") + '</div><label>Descripción<textarea name="description" rows="3" maxlength="500">' + escapeHtml(editing?.description || "") + '</textarea></label><p class="form-error hidden"></p><button class="button primary" type="submit">' + (editing ? "Guardar cambios" : "＋ Agregar área") + "</button></form>"
        : '<div class="hr-catalog-editor"><div class="hr-catalog-editor-head"><div><span>ÁREAS DE TRABAJO</span><h3>Consulta de estructura</h3></div></div><p class="muted">La creación y modificación de áreas está reservada al Administrador de RH.</p></div>';
    } else if (section === "positions") {
      rows = jobPositions.map((row) => hrCatalogRecord(row, "positions", row.description || "Sin descriptivo",
        hrCatalogUsage("position_id", row.id), true,
        '<button type="button" data-print-catalog-position="' + row.id + '" data-position-document="description">Descriptivo</button><button type="button" data-print-catalog-position="' + row.id + '" data-position-document="profile">Perfil</button>')).join("");
      form = '<form id="hr-position-form" class="hr-catalog-editor hr-position-editor"><div class="hr-catalog-editor-head"><div><span>' + (editing ? "EDITAR PUESTO" : "NUEVO PUESTO") + '</span><h3>' + (editing ? escapeHtml(editing.name) : "Agregar puesto") + '</h3></div>' + (editing ? '<button type="button" data-cancel-hr-catalog-edit>Cancelar edición</button>' : "") + '</div><label>Nombre del puesto<input name="name" maxlength="120" required placeholder="Ej. Analista de Recursos Humanos" value="' + escapeAttribute(editing?.name || "") + '" /></label><section class="hr-position-editor-block descriptive"><header><span>DESCRIPTIVO DE PUESTO</span><strong>¿Qué hace este puesto?</strong><small>Funciones, tareas, objetivos, autoridad y relaciones de trabajo.</small></header><label>Funciones y responsabilidades<textarea name="description" rows="7" maxlength="4000" placeholder="Ej. Elaborar contratos laborales. Administrar expedientes. Reportar a la Gerencia de RH.">' + escapeHtml(editing?.description || "") + '</textarea></label></section><section class="hr-position-editor-block profile"><header><span>PERFIL DE PUESTO</span><strong>¿Quién puede desempeñar este puesto?</strong><small>Requisitos y competencias de la persona que lo ocupará.</small></header><div class="form-grid"><label>Estudios<textarea name="profileEducation" rows="3" maxlength="2000" placeholder="Ej. Licenciatura en Administración, Psicología o afín.">' + escapeHtml(editing?.profile_education || "") + '</textarea></label><label>Experiencia<textarea name="profileExperience" rows="3" maxlength="2000" placeholder="Ej. Mínimo 2 años en Recursos Humanos.">' + escapeHtml(editing?.profile_experience || "") + '</textarea></label><label>Conocimientos<textarea name="profileKnowledge" rows="3" maxlength="2000" placeholder="Ej. Excel y sistemas de nómina.">' + escapeHtml(editing?.profile_knowledge || "") + '</textarea></label><label>Habilidades<textarea name="profileSkills" rows="3" maxlength="2000" placeholder="Ej. Comunicación, organización y trabajo en equipo.">' + escapeHtml(editing?.profile_skills || "") + '</textarea></label><label class="span-two">Competencias<textarea name="profileCompetencies" rows="3" maxlength="2000" placeholder="Ej. Orientación a resultados y atención al detalle.">' + escapeHtml(editing?.profile_competencies || "") + '</textarea></label></div></section><p class="form-error hidden"></p><button class="button primary" type="submit">' + (editing ? "Guardar descriptivo y perfil" : "＋ Agregar puesto") + '</button></form>';
    } else if (section === "vacations") {
      rows = vacationPlans.map((row) => hrCatalogRecord(row, "vacations",
        inventoryNumber(row.annual_days) + " días · " + hrVacationSeniority(row),
        hrCatalogUsage("vacation_plan_id", row.id))).join("");
      form = '<form id="hr-vacation-plan-form" class="hr-catalog-editor"><div class="hr-catalog-editor-head"><div><span>' + (editing ? "EDITAR PLAN" : "NUEVO PLAN") + '</span><h3>' + (editing ? escapeHtml(editing.name) : "Agregar plan de vacaciones") + '</h3></div>' + (editing ? '<button type="button" data-cancel-hr-catalog-edit>Cancelar edición</button>' : "") + '</div><label>Nombre del plan<input name="name" maxlength="120" required placeholder="Ej. Plan 5 años" value="' + escapeAttribute(editing?.name || "") + '" /></label><div class="form-grid compact"><label>Días anuales<input name="annualDays" type="number" min="0.5" step="0.5" required value="' + escapeAttribute(editing?.annual_days || "") + '" /></label><label>Desde (años)<input name="minServiceYears" type="number" min="1" max="100" required value="' + escapeAttribute(editing?.min_service_years ?? 1) + '" /></label><label>Hasta (años)<input name="maxServiceYears" type="number" min="1" max="100" placeholder="Sin límite" value="' + escapeAttribute(editing?.max_service_years ?? "") + '" /></label></div><label>Descripción<textarea name="description" rows="3" maxlength="500">' + escapeHtml(editing?.description || "") + '</textarea></label><p class="form-error hidden"></p><button class="button primary" type="submit">' + (editing ? "Guardar cambios" : "＋ Agregar plan") + '</button></form>';
    } else {
      rows = workShifts.map((row) => hrCatalogRecord(row, "shifts", hrShiftCatalogSummary(row),
        hrCatalogUsage("work_shift_id", row.id))).join("");
      form = '<form id="hr-shift-form" class="hr-catalog-editor hr-shift-editor"><div class="hr-catalog-editor-head"><div><span>' + (editing ? "EDITAR TURNO" : "NUEVO TURNO") + '</span><h3>' + (editing ? escapeHtml(editing.name) : "Configurar turno") + '</h3></div>' + (editing ? '<button type="button" data-cancel-hr-catalog-edit>Cancelar edición</button>' : "") + '</div><div class="hr-shift-form-head"><label>Nombre del turno<input name="name" maxlength="120" required placeholder="Ej. Administrativo con sábado" value="' + escapeAttribute(editing?.name || "") + '" /></label><div><strong>CALENDARIO SEMANAL</strong><small>Agrupa días con el mismo horario y agrega otra jornada cuando sea necesario.</small></div></div><div id="hr-shift-schedule" class="hr-shift-schedule"></div><button class="button ghost hr-add-schedule" type="button" data-add-shift-schedule>＋ Agregar otro horario</button><p class="form-error hidden"></p><button class="button primary" type="submit">' + (editing ? "Guardar cambios" : "＋ Guardar turno") + '</button></form>';
    }
  
    $("#entity-modal-content").innerHTML = '<div class="modal-head"><div><span class="eyebrow">CONFIGURACIÓN DE PERSONAL</span><h2>Catálogos</h2></div><button type="button" data-close-modal>×</button></div>' +
      (confirmation ? '<div class="hr-catalog-confirmation" role="status"><span>✓</span><div><strong>Información actualizada</strong><small>' + escapeHtml(confirmation) + '</small></div></div>' : "") +
      '<div class="hr-catalog-workspace"><nav class="hr-catalog-submenu" aria-label="Catálogos laborales">' + submenu + '</nav><section class="hr-catalog-stage"><header><div><span class="eyebrow">' + active.number + ' · CATÁLOGO</span><h3>' + active.label + '</h3><p>' + active.hint + '. Los cambios se reflejan en los expedientes relacionados.</p></div><strong>' + active.records.length + ' registro(s)</strong></header>' + (section === "policies" ? form : '<ul class="hr-catalog-list">' + (rows || '<li class="empty-row">Aún no hay registros en este catálogo.</li>') + '</ul>' + form) + '</section></div><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cerrar</button></div>';
  
    $$("[data-hr-catalog-section]").forEach((button) => button.onclick = () =>
      openHrCatalogsModal(button.dataset.hrCatalogSection)
    );
    $$("[data-edit-hr-catalog]").forEach((button) => button.onclick = () =>
      openHrCatalogsModal(button.dataset.editHrCatalog, "", Number(button.dataset.recordId))
    );
    $$("[data-print-catalog-position]").forEach((button) => button.onclick = () =>
      printHrPositionProfile(jobPositions.find((row) => row.id === Number(button.dataset.printCatalogPosition)),
        null, button.dataset.positionDocument)
    );
    $("[data-cancel-hr-catalog-edit]")?.addEventListener("click", () => openHrCatalogsModal(section));
  
    if (section === "holidays") {
      $("#hr-holiday-form").onsubmit = async (event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); try { await api("/api/hr/holidays", { method: "POST", body: { date: formData.get("date"), name: formData.get("name") } }); toast("Fecha feriada agregada."); await openHrCatalogsModal("holidays", "El calendario laboral ya considera esta fecha."); } catch (error) { toast(error.message, "error"); } };
      $$('[data-delete-holiday]').forEach((button) => button.onclick = async () => { try { await api("/api/hr/holidays/" + button.dataset.deleteHoliday, { method: "DELETE" }); toast("Fecha feriada retirada."); await openHrCatalogsModal("holidays"); } catch (error) { toast(error.message, "error"); } });
    } else if (section === "policies") {
      $("#hr-policy-settings").onsubmit = async (event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); try { await api("/api/hr/portal/settings", { method: "PATCH", body: { managerApprovalRequired: formData.get("managerApprovalRequired") === "on", sessionHours: Number(formData.get("sessionHours")), activationHours: Number(formData.get("activationHours")), minimumAdvanceDays: Number(formData.get("minimumAdvanceDays")), minimumCoveragePercent: Number(formData.get("minimumCoveragePercent")), excludeWeekends: formData.get("excludeWeekends") === "on", excludeHolidays: formData.get("excludeHolidays") === "on" } }); toast("Políticas de RH actualizadas."); await openHrCatalogsModal("policies", "Las reglas de solicitudes ya están vigentes."); } catch (error) { toast(error.message, "error"); } };
      $$('[data-absence-limit]').forEach((formNode) => formNode.onsubmit = async (event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); try { await api("/api/hr/absence-limits/" + event.currentTarget.dataset.absenceLimit, { method: "PATCH", body: { maximumAbsent: Number(formData.get("maximumAbsent")), minimumAvailable: Number(formData.get("minimumAvailable")) } }); toast("Cobertura actualizada."); await openHrCatalogsModal("policies"); } catch (error) { toast(error.message, "error"); } });
    } else if (section === "areas") {
      if (canManageAreas) bindHrCatalogForm("#hr-area-form", "/api/areas", "Área", section, (catalogForm, body) => {
        if (editing) body.isActive = body.isActive === "true";
      }, editing?.id);
    } else if (section === "positions") {
      bindHrCatalogForm("#hr-position-form", "/api/hr/job-positions", "Puesto", section, null, editing?.id);
    } else if (section === "vacations") {
      bindHrCatalogForm("#hr-vacation-plan-form", "/api/hr/vacation-plans", "Plan", section, null, editing?.id);
    } else {
      const shiftSchedule = $("#hr-shift-schedule");
      const groups = editing ? hrShiftScheduleGroups(editing) : [{ days: ["mon", "tue", "wed", "thu", "fri"], periods: [] }];
      groups.forEach((group) => addHrShiftScheduleGroup(shiftSchedule, group.days, group.periods));
      $("[data-add-shift-schedule]").onclick = () => addHrShiftScheduleGroup(shiftSchedule);
      bindHrCatalogForm("#hr-shift-form", "/api/hr/work-shifts", "Turno", section, (catalogForm, body) => {
        body.scheduleGroups = readHrShiftSchedule(catalogForm);
      }, editing?.id);
    }
    if (!entityDialog.open) entityDialog.showModal();
  }
  
  function bindHrCatalogForm(selector, endpoint, label, section, prepare, recordId = null) {
    $(selector).onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form));
      const submit = $('button[type="submit"]', form);
      prepare?.(form, body);
      submit.disabled = true;
      try {
        const result = await api(endpoint + (recordId ? "/" + recordId : ""), {
          method: recordId ? "PATCH" : "POST",
          body,
        });
        const [options, control] = await Promise.all([api("/api/hr/options"), api("/api/hr/control")]);
        state.hrOptions = options;
        state.hrControl = control;
        toast(label + " " + result.folio + (recordId ? " actualizado." : " guardado."));
        openHrCatalogsModal(section, label + " " + result.folio + " ya está integrado con Recursos Humanos.");
      } catch (error) {
        submit.disabled = false;
        box.textContent = error.message;
        box.classList.remove("hidden");
      }
    };
  }
  
  function showHrPersonConfirmation(result, fullName, editing = false) {
    const card = $("#entity-modal-content");
    card.classList.remove("wide", "hr-person-modal");
    card.classList.add("compact");
    card.innerHTML = '<section class="hr-save-confirmation" role="status"><span class="hr-save-check" aria-hidden="true">✓</span><span class="eyebrow">' + (editing ? "EXPEDIENTE ACTUALIZADO" : "EXPEDIENTE GUARDADO") + '</span><h2>' + (editing ? "Cambios guardados" : "Personal registrado") + '</h2><p><strong>' + escapeHtml(fullName) + '</strong> ' + (editing ? "ya tiene sus datos actualizados en Recursos Humanos." : "ya está disponible en Recursos Humanos.") + '</p><div class="hr-save-folio"><span>FOLIO DEL TRABAJADOR</span><strong>' + escapeHtml(result.folio) + '</strong></div><button class="button primary wide" type="button" data-close-modal>Continuar en Recursos Humanos <span>→</span></button></section>';
  }
  
  function openHrDeactivateModal(employeeId) {
    const person = state.hrControl?.people?.find((row) => row.id === Number(employeeId));
    if (!person) return toast("No se encontró el expediente del trabajador.", "error");
    const card = $("#entity-modal-content");
    card.classList.remove("wide", "hr-person-modal");
    card.classList.add("compact");
    card.innerHTML = '<section class="hr-deactivate-confirmation"><span class="hr-deactivate-symbol" aria-hidden="true">!</span><span class="eyebrow">BAJA DE PERSONAL</span><h2>¿Dar de baja al trabajador?</h2><p><strong>' + escapeHtml(person.full_name) + '</strong> dejará de aparecer como personal activo. Su expediente, movimientos e historial no se eliminarán.</p><div class="hr-save-folio"><span>FOLIO DEL TRABAJADOR</span><strong>' + escapeHtml(person.employee_number) + '</strong></div><div class="form-grid"><label>Fecha de baja<input name="terminationDate" type="date" value="' + todayInput() + '" required /></label><label>Motivo de baja<textarea name="terminationReason" rows="3" maxlength="500" required></textarea></label></div><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button danger" type="button" data-confirm-deactivate>Confirmar baja</button></div></section>';
    $("[data-confirm-deactivate]").onclick = async (event) => {
      const button = event.currentTarget;
      const box = $(".form-error", card);
      button.disabled = true;
      try {
        const terminationDate = $('[name="terminationDate"]', card).value;
        const reason = $('[name="terminationReason"]', card).value.trim();
        if (!terminationDate || !reason) throw new Error("Captura la fecha y el motivo de baja.");
        const result = await api("/api/hr/people/" + person.id + "/action", { method: "POST", body: { action: "deactivate", terminationDate, reason } });
        await renderHr();
        toast("Baja de " + result.folio + " registrada.");
        card.innerHTML = '<section class="hr-save-confirmation" role="status"><span class="hr-save-check" aria-hidden="true">✓</span><span class="eyebrow">BAJA REGISTRADA</span><h2>Trabajador inactivo</h2><p><strong>' + escapeHtml(result.fullName) + '</strong> fue dado de baja correctamente. El expediente y su historial permanecen disponibles.</p><div class="hr-save-folio"><span>FOLIO DEL TRABAJADOR</span><strong>' + escapeHtml(result.folio) + '</strong></div><button class="button primary wide" type="button" data-close-modal>Continuar en Recursos Humanos <span>→</span></button></section>';
      } catch (error) {
        button.disabled = false;
        box.textContent = error.message;
        box.classList.remove("hidden");
      }
    };
    entityDialog.showModal();
  }
  
  function hrDigitalFileMarkup(person = {}, options = {}) {
    const selectedOptions = (records, selectedId, emptyLabel, label, attributes = () => "") =>
      '<option value="">' + emptyLabel + '</option>' + records.map((row) => '<option value="' + row.id + '" ' +
        attributes(row) + ' ' + (Number(row.id) === Number(selectedId) ? "selected" : "") + '>' +
        escapeHtml(label(row)) + '</option>').join("");
    const automaticCompanyId = person.company_id || ((options.companies || []).length === 1 ? options.companies[0].id : null);
    const companies = selectedOptions(options.companies || [], automaticCompanyId, "Selecciona empresa", (row) => row.code + " · " + (row.trade_name || row.legal_name));
    const centers = selectedOptions(options.workCenters || [], person.work_center_id, "Selecciona centro", (row) => row.code + " · " + row.name, (row) => 'data-company="' + row.company_id + '"');
    const departments = selectedOptions(options.departments || [], person.department_id, "Selecciona departamento", (row) => row.code + " · " + row.name, (row) => 'data-company="' + row.company_id + '" data-center="' + (row.work_center_id || "") + '"');
    const managers = selectedOptions((options.employees || []).filter((row) => Number(row.id) !== Number(person.id)), person.manager_employee_id, "Sin responsable asignado", (row) => row.employee_number + " · " + row.full_name);
    const value = (key, fallback = "") => escapeAttribute(person[key] ?? fallback);
    const selected = (key, expected) => String(person[key] || "") === expected ? "selected" : "";
    const salaryAllowed = !state.user?.laborIdentity || state.user.laborIdentity.canViewSalary;
    const completion = person.id ? '<div class="hr-file-completion ' + (person.file_complete ? "complete" : "pending") + '"><div><span>INTEGRIDAD DEL EXPEDIENTE</span><strong>' + Number(person.file_completion_percent || 0) + '% completo</strong></div><small>' + (person.file_complete ? "Todos los datos y documentos obligatorios están registrados." : "Pendiente: " + escapeHtml([...(person.missing_file_fields || []), ...(person.missing_file_documents || [])].slice(0, 8).join(", "))) + '</small></div>' : "";
    const salary = salaryAllowed ? '<div class="hr-registration-section hr-sensitive-section"><span>SALARIO · ACCESO RESTRINGIDO</span><div class="form-grid"><label>Salario base<input name="baseSalary" type="number" min="0" step="0.01" value="' + value("base_salary", 0) + '" /></label><label>Moneda<input name="currencyCode" maxlength="8" value="' + value("currency_code", "MXN") + '" /></label><label>Método de pago<input name="paymentMethod" maxlength="80" value="' + value("payment_method") + '" /></label><label>Referencia bancaria<input name="bankReference" maxlength="120" value="' + value("bank_reference") + '" /></label></div><small class="field-help">Estos datos sólo se entregan a usuarios con permiso salarial especial.</small></div>' : "";
    return completion +
      '<div class="hr-registration-section"><span>IDENTIDAD PERSONAL Y FISCAL</span><div class="form-grid"><label>CURP<input name="curp" maxlength="18" required value="' + value("curp") + '" /></label><label>RFC<input name="rfc" maxlength="13" required value="' + value("rfc") + '" /></label><label>NSS<input name="nss" maxlength="11" required value="' + value("nss") + '" /></label><label>Fecha de nacimiento<input name="birthDate" type="date" required value="' + value("birth_date") + '" /></label><label>Género<select name="gender"><option value="">No especificado</option><option value="female" ' + selected("gender", "female") + '>Mujer</option><option value="male" ' + selected("gender", "male") + '>Hombre</option><option value="non_binary" ' + selected("gender", "non_binary") + '>No binario</option><option value="prefer_not" ' + selected("gender", "prefer_not") + '>Prefiere no indicar</option></select></label><label>Nacionalidad<input name="nationality" maxlength="80" value="' + value("nationality", "Mexicana") + '" /></label><label>Estado civil<input name="maritalStatus" maxlength="40" value="' + value("marital_status") + '" /></label><label>Régimen fiscal<input name="taxRegime" maxlength="120" value="' + value("tax_regime") + '" /></label><label>Código postal fiscal<input name="fiscalPostalCode" maxlength="10" value="' + value("fiscal_postal_code") + '" /></label></div></div>' +
      '<div class="hr-registration-section"><span>DOMICILIO</span><div class="form-grid"><label>Calle<input name="street" maxlength="180" required value="' + value("street") + '" /></label><label>Número exterior<input name="exteriorNumber" maxlength="30" value="' + value("exterior_number") + '" /></label><label>Número interior<input name="interiorNumber" maxlength="30" value="' + value("interior_number") + '" /></label><label>Colonia<input name="neighborhood" maxlength="120" required value="' + value("neighborhood") + '" /></label><label>Municipio / alcaldía<input name="municipality" maxlength="120" required value="' + value("municipality") + '" /></label><label>Estado<input name="addressState" maxlength="120" required value="' + value("address_state") + '" /></label><label>Código postal<input name="postalCode" maxlength="10" required value="' + value("postal_code") + '" /></label><label>País<input name="country" maxlength="80" value="' + value("country", "México") + '" /></label></div></div>' +
      '<div class="hr-registration-section"><span>ADSCRIPCIÓN LABORAL</span><div class="form-grid"><label>Empresa<select name="companyId" data-hr-company required>' + companies + '</select></label><label>Centro de trabajo<select name="workCenterId" data-hr-center required>' + centers + '</select></label><label>Departamento<select name="departmentId" data-hr-department required>' + departments + '</select></label><label>Administrador responsable<select name="managerEmployeeId">' + managers + '</select></label></div></div>' +
      '<div class="hr-registration-section"><span>CONTRATO Y NÓMINA</span><div class="form-grid"><label>Tipo de contrato<input name="contractType" maxlength="80" required value="' + value("contract_type", person.employment_type || "permanent") + '" /></label><label>Número de contrato<input name="contractNumber" maxlength="80" value="' + value("contract_number") + '" /></label><label>Inicio de contrato<input name="contractStartDate" type="date" value="' + value("contract_start_date", person.hire_date || "") + '" /></label><label>Periodicidad de nómina<select name="payrollFrequency" required><option value="">Selecciona</option><option value="weekly" ' + selected("payroll_frequency", "weekly") + '>Semanal</option><option value="biweekly" ' + selected("payroll_frequency", "biweekly") + '>Quincenal</option><option value="monthly" ' + selected("payroll_frequency", "monthly") + '>Mensual</option><option value="other" ' + selected("payroll_frequency", "other") + '>Otra</option></select></label><label>Condición sindical<input name="unionStatus" maxlength="80" value="' + value("union_status") + '" /></label></div></div>' + salary;
  }
  
  function bindHrDigitalFileRules(form) {
    const company = $("[data-hr-company]", form), center = $("[data-hr-center]", form), department = $("[data-hr-department]", form);
    const sync = () => {
      const companyId = company.value, centerId = center.value;
      [...center.options].forEach((option) => { if (!option.value) return; option.hidden = option.dataset.company !== companyId; option.disabled = option.hidden; });
      if (center.selectedOptions[0]?.disabled) center.value = "";
      [...department.options].forEach((option) => { if (!option.value) return; option.hidden = option.dataset.company !== companyId || (option.dataset.center && option.dataset.center !== centerId); option.disabled = option.hidden; });
      if (department.selectedOptions[0]?.disabled) department.value = "";
    };
    company.onchange = () => { center.value = ""; department.value = ""; sync(); };
    center.onchange = () => { department.value = ""; sync(); };
    sync();
    const area = $('[name="areaId"]', form), position = $('[name="positionId"]', form), hireDate = $('[name="hireDate"]', form);
    if (area) area.required = true;
    if (position) position.required = true;
    if (hireDate) hireDate.required = true;
    const emergencyContact = $('[name="emergencyContact"]', form), emergencyPhone = $('[name="emergencyPhone"]', form);
    if (emergencyContact) emergencyContact.required = true;
    if (emergencyPhone) emergencyPhone.required = true;
  }
  
  async function openHrEditPersonModal(employeeId, initialTab = "general") {
    const person = state.hrControl?.people?.find((row) => row.id === Number(employeeId));
    if (!person) return toast("No se encontró el expediente del trabajador.", "error");
    let portalAccess = null;
    let documentData = { documents: [], documentTypes: [] };
    const [portalResult, documentResult] = await Promise.allSettled([
      api("/api/hr/portal/employees/" + person.id, { cache: false }),
      hasPermission("documents.view")
        ? api("/api/documents?employeeId=" + encodeURIComponent(person.id), { cache: false })
        : Promise.resolve(documentData),
    ]);
    if (portalResult.status === "fulfilled") portalAccess = portalResult.value.access;
    else toast("No fue posible consultar el acceso del colaborador: " + portalResult.reason.message, "error");
    if (documentResult.status === "fulfilled") documentData = documentResult.value;
    else toast("No fue posible consultar los documentos: " + documentResult.reason.message, "error");
    const o = state.hrOptions || {};
    const assignedPosition = (o.jobPositions || []).find((row) => Number(row.id) === Number(person.position_id));
    const selectedOptions = (records, selectedId, emptyLabel, label) => '<option value="">' + emptyLabel + '</option>' + records.map((row) => '<option value="' + row.id + '" ' + (row.id === Number(selectedId) ? "selected" : "") + '>' + escapeHtml(label(row)) + '</option>').join("");
    const areas = selectedOptions(o.areas || [], person.area_id, "Sin área", (row) => row.code + " · " + row.name);
    const positions = selectedOptions(o.jobPositions || [], person.position_id, "Sin puesto asignado", (row) => row.name);
    const shifts = selectedOptions(o.workShifts || [], person.work_shift_id, "Sin turno asignado", (row) => row.name);
    const photoUrl = person.photo_filename ? API_BASE + "/api/hr/people/" + person.id + "/photo?v=" + encodeURIComponent(person.updated_at || Date.now()) : "";
    const selected = (value, expected) => value === expected ? "selected" : "";
    const card = $("#entity-modal-content");
    card.classList.add("wide", "hr-person-modal");
    card.innerHTML = '<form id="hr-edit-form" class="hr-person-form"><div class="modal-head hr-collaborator-head"><div><h2>Colaborador</h2><strong class="hr-collaborator-folio">' + escapeHtml(person.employee_number) + '</strong></div><button type="button" data-close-modal aria-label="Cerrar">×</button></div>' +
      '<div class="hr-person-registration"><aside class="hr-photo-column"><span class="eyebrow">FOTOGRAFÍA</span><label class="hr-photo-picker" for="hr-edit-photo-input"><img id="hr-edit-photo-preview" class="' + (photoUrl ? "" : "hidden") + '" src="' + escapeAttribute(photoUrl) + '" alt="Fotografía de ' + escapeAttribute(person.full_name) + '" /><span id="hr-edit-photo-placeholder" class="' + (photoUrl ? "hidden" : "") + '"><b>＋</b><strong>' + (photoUrl ? "Reemplazar fotografía" : "Agregar fotografía") + '</strong><small>JPG, PNG o WebP · Máximo 3 MB</small></span><input id="hr-edit-photo-input" type="file" accept="image/jpeg,image/png,image/webp" /></label><p>Haz clic sobre la imagen para seleccionar una fotografía nueva.</p><label class="check-option hr-remove-photo"><input name="removePhoto" type="checkbox" ' + (photoUrl ? "" : "disabled") + ' /><span><strong>Quitar fotografía</strong><small>El expediente conservará sus demás datos.</small></span></label></aside><section class="hr-registration-fields"><div class="hr-registration-section"><span>INFORMACIÓN GENERAL</span><div class="form-grid"><label>Nombre completo<input name="fullName" maxlength="180" required value="' + escapeAttribute(person.full_name) + '" /></label><label>Puesto<select name="positionId">' + positions + '</select></label><label>Área<select name="areaId">' + areas + '</select></label><label>Fecha de alta<input id="hr-edit-hire-date" name="hireDate" type="date" value="' + escapeAttribute(person.hire_date || "") + '" /></label><label>Teléfono<input name="phone" maxlength="40" value="' + escapeAttribute(person.phone || "") + '" /></label><label>Correo electrónico<input name="email" type="email" maxlength="180" value="' + escapeAttribute(person.email || "") + '" /></label><div class="hr-derived-field"><span>Plan de vacaciones</span><strong id="hr-edit-vacation-plan">Asignación automática</strong><small>No se edita: depende de la antigüedad.</small></div><div class="hr-derived-field"><span>Antigüedad</span><strong id="hr-edit-seniority">0 años</strong><small>Calculada desde la fecha de alta.</small></div></div></div><div class="hr-registration-section"><span>CONDICIONES LABORALES</span><div class="form-grid hr-labor-grid"><label>Tipo de contratación<select name="employmentType"><option value="permanent" ' + selected(person.employment_type, "permanent") + '>Permanente</option><option value="temporary" ' + selected(person.employment_type, "temporary") + '>Temporal</option><option value="contractor" ' + selected(person.employment_type, "contractor") + '>Contratista</option><option value="intern" ' + selected(person.employment_type, "intern") + '>Practicante</option></select><small class="field-help">Define la relación laboral del trabajador.</small></label><label>Estado<select name="status"><option value="active" ' + selected(person.status, "active") + '>Activo</option><option value="leave" ' + selected(person.status, "leave") + '>Ausente</option><option value="inactive" ' + selected(person.status, "inactive") + '>Inactivo</option></select><small class="field-help">Controla si aparece disponible para operar.</small></label><label>Turno<select name="workShiftId" id="hr-edit-work-shift">' + shifts + '</select><small class="field-help">Selecciona un turno configurado.</small></label><div class="hr-derived-field"><span>Horario asignado</span><strong id="hr-edit-shift-summary">Sin turno seleccionado</strong><small>Días, entradas y salidas del turno.</small></div></div></div><div class="hr-registration-section"><span>CONTACTO DE EMERGENCIA</span><div class="form-grid"><label>Nombre del contacto<input name="emergencyContact" maxlength="180" value="' + escapeAttribute(person.emergency_contact || "") + '" /></label><label>Teléfono de emergencia<input name="emergencyPhone" maxlength="40" value="' + escapeAttribute(person.emergency_phone || "") + '" /></label><label class="span-two">Notas<textarea name="notes" rows="3" placeholder="Información adicional del expediente">' + escapeHtml(person.profile_notes || "") + '</textarea></label></div></div></section></div><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar cambios</button></div></form>';
    const editForm = $("#hr-edit-form", card);
    const profileHeader = $(".hr-collaborator-head", editForm);
    const modalClose = $("[data-close-modal]", profileHeader);
    modalClose.className = "hr-person-modal-close";
    profileHeader.innerHTML = '<div><span>EXPEDIENTE</span><strong class="hr-collaborator-folio">' + escapeHtml(person.employee_number) + '</strong></div>';
    $(".hr-photo-column", editForm).prepend(profileHeader);
    editForm.append(modalClose);
    const profileSections = $$(".hr-registration-section", card);
    profileSections.at(-1)?.insertAdjacentHTML("beforebegin", hrEmployeePortalAccessMarkup(person, portalAccess));
    $(".hr-registration-fields", card).insertAdjacentHTML("beforeend", hrDigitalFileMarkup(person, o));
    $(".hr-registration-fields", card).insertAdjacentHTML("beforeend", hrPositionProfileMarkup(person, assignedPosition));
    if (hasPermission("documents.view")) $(".hr-registration-fields", card).insertAdjacentHTML("beforeend", hrEmployeeDocumentsMarkup(person, documentData));
    if (person.status !== "inactive") $('[name="status"] option[value="inactive"]', card).disabled = true;
    $('[name="notes"]', card).closest("label").insertAdjacentHTML("beforebegin", '<label>Parentesco<input name="emergencyRelationship" maxlength="80" value="' + escapeAttribute(person.emergency_relationship || "") + '" /></label>');
    $(".hr-labor-grid", card).insertAdjacentHTML("beforeend", hrEmploymentDetailsMarkup(person));
    setupHrProfileTabs(card, initialTab);
    const photoInput = $("#hr-edit-photo-input");
    const photoPreview = $("#hr-edit-photo-preview");
    const photoPlaceholder = $("#hr-edit-photo-placeholder");
    const removePhoto = $('[name="removePhoto"]', card);
    bindHrEmploymentRules($("#hr-edit-form"), o.vacationPlans || [], o.workShifts || []);
    bindHrDigitalFileRules($("#hr-edit-form"));
    bindHrEmployeePortalProfile(person);
    bindHrPositionProfile(person, assignedPosition);
    bindHrEmployeeDocuments(person);
    photoInput.onchange = () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
        photoInput.value = "";
        return toast("La fotografía debe ser JPG, PNG o WebP y pesar menos de 3 MB.", "error");
      }
      photoPreview.src = URL.createObjectURL(file);
      photoPreview.classList.remove("hidden");
      photoPlaceholder.classList.add("hidden");
      removePhoto.checked = false;
    };
    removePhoto.onchange = () => {
      if (removePhoto.checked) {
        photoInput.value = "";
        photoPreview.classList.add("hidden");
        photoPlaceholder.classList.remove("hidden");
      } else if (photoUrl) {
        photoPreview.src = photoUrl;
        photoPreview.classList.remove("hidden");
        photoPlaceholder.classList.add("hidden");
      }
    };
    $("#hr-edit-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const box = $(".form-error", form);
      const submit = $('button[type="submit"]', form);
      const body = Object.fromEntries(new FormData(form));
      body.removePhoto = removePhoto.checked;
      body.portalAccess = readHrEmployeePortalAccess();
      const file = photoInput.files?.[0];
      box.classList.add("hidden");
      submit.disabled = true;
      try {
        if (file) {
          body.photoBase64 = await fileToBase64(file);
          body.photoName = file.name;
          body.photoMime = file.type;
        }
        const result = await api("/api/hr/people/" + person.id, { method: "PATCH", body });
        state.hrOptions = null;
        toast("Expediente " + result.folio + " actualizado.");
        showHrPersonConfirmation(result, body.fullName, true);
        try { await renderHr(); } catch { toast("El expediente se guardó, pero el tablero no pudo actualizarse.", "error"); }
      } catch (error) {
        submit.disabled = false;
        box.textContent = error.message;
        box.classList.remove("hidden");
      }
    };
    entityDialog.showModal();
  }
  
  function openHrModal(type, employeeId = null) {
    if (type === "edit") return openHrEditPersonModal(employeeId);
    const o = state.hrOptions || {};
    const employeeRecords = Array.isArray(o.employees) ? o.employees : [];
    const areaRecords = Array.isArray(o.areas) ? o.areas : [];
    const positionRecords = Array.isArray(o.jobPositions) ? o.jobPositions : [];
    const shiftRecords = Array.isArray(o.workShifts) ? o.workShifts : [];
    const vacationRecords = Array.isArray(o.vacationPlans) ? o.vacationPlans : [];
    const areas = '<option value="">Sin área</option>' + areaRecords.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code + " · " + r.name) + '</option>').join("");
    const positions = '<option value="">Sin puesto asignado</option>' + positionRecords.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.name) + '</option>').join("");
    const shifts = '<option value="">Sin turno asignado</option>' + shiftRecords.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.name) + '</option>').join("");
    if (type === "person") {
      $("#entity-modal-content").classList.add("wide", "hr-person-modal");
      $("#entity-modal-content").innerHTML = '<form id="hr-form" class="hr-person-form"><div class="modal-head"><div><span class="eyebrow">RECURSOS HUMANOS</span><h2>Nuevo personal</h2><p class="muted">Crea una ficha completa con fotografía y datos laborales.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("E-00000", true) + '<div class="hr-person-registration"><aside class="hr-photo-column"><span class="eyebrow">FOTOGRAFÍA</span><label class="hr-photo-picker" for="hr-photo-input"><img id="hr-photo-preview" class="hidden" alt="Vista previa de la fotografía" /><span id="hr-photo-placeholder"><b>＋</b><strong>Agregar fotografía</strong><small>JPG, PNG o WebP · Máximo 3 MB</small></span><input id="hr-photo-input" type="file" accept="image/jpeg,image/png,image/webp" /></label><p>Utiliza una fotografía frontal con fondo claro para identificar fácilmente al trabajador.</p></aside><section class="hr-registration-fields"><div class="hr-registration-section"><span>INFORMACIÓN GENERAL</span><div class="form-grid"><label>Nombre completo<input name="fullName" maxlength="180" required /></label><label>Puesto<select name="positionId">' + positions + '</select></label><label>Área<select name="areaId">' + areas + '</select></label><label>Fecha de alta<input id="hr-hire-date" name="hireDate" type="date" /></label><label>Teléfono<input name="phone" maxlength="40" /></label><label>Correo electrónico<input name="email" type="email" maxlength="180" /></label><div class="hr-derived-field"><span>Plan de vacaciones</span><strong id="hr-vacation-plan-preview">Asignación automática</strong><small>No se captura: depende de la antigüedad.</small></div><div class="hr-derived-field"><span>Antigüedad</span><strong id="hr-seniority-preview">0 años</strong><small>Calculada desde la fecha de alta.</small></div></div></div><div class="hr-registration-section"><span>CONDICIONES LABORALES</span><div class="form-grid hr-labor-grid"><label>Tipo de contratación<select name="employmentType"><option value="permanent">Permanente</option><option value="temporary">Temporal</option><option value="contractor">Contratista</option><option value="intern">Practicante</option></select><small class="field-help">Define la relación laboral del trabajador.</small></label><label>Turno<select name="workShiftId" id="hr-work-shift">' + shifts + '</select><small class="field-help">Selecciona un turno configurado.</small></label><div class="hr-derived-field"><span>Horario asignado</span><strong id="hr-shift-summary">Sin turno seleccionado</strong><small>Días, entrada, salida y descanso.</small></div></div></div><div class="hr-registration-section"><span>CONTACTO DE EMERGENCIA</span><div class="form-grid"><label>Nombre del contacto<input name="emergencyContact" maxlength="180" /></label><label>Teléfono de emergencia<input name="emergencyPhone" maxlength="40" /></label><label class="span-two">Notas<textarea name="notes" rows="3" placeholder="Información adicional del expediente"></textarea></label></div></div></section></div><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar expediente</button></div></form>';
      $(".hr-registration-fields", $("#hr-form")).insertAdjacentHTML("beforeend", hrDigitalFileMarkup({}, o));
      $('[name="notes"]', $("#hr-form")).closest("label").insertAdjacentHTML("beforebegin", '<label>Parentesco<input name="emergencyRelationship" maxlength="80" /></label>');
      $(".hr-labor-grid", $("#hr-form")).insertAdjacentHTML("beforeend", hrEmploymentDetailsMarkup());
      setupHrProfileTabs($("#hr-form"));
      const photoInput = $("#hr-photo-input");
      bindHrEmploymentRules($("#hr-form"), vacationRecords, shiftRecords);
      bindHrDigitalFileRules($("#hr-form"));
      photoInput.onchange = () => {
        const file = photoInput.files?.[0], preview = $("#hr-photo-preview"), placeholder = $("#hr-photo-placeholder");
        if (!file) { preview.classList.add("hidden"); placeholder.classList.remove("hidden"); return; }
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
          photoInput.value = ""; toast("La fotografía debe ser JPG, PNG o WebP y pesar menos de 3 MB.", "error"); return;
        }
        preview.src = URL.createObjectURL(file);
        preview.classList.remove("hidden");
        placeholder.classList.add("hidden");
      };
      $("#hr-form").onsubmit = async (event) => {
        event.preventDefault();
        const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form));
        const submit = $('button[type="submit"]', form);
        delete body[""];
        const file = photoInput.files?.[0];
        box.classList.add("hidden");
        submit.disabled = true;
        try {
          if (file) {
            body.photoBase64 = await fileToBase64(file);
            body.photoName = file.name;
            body.photoMime = file.type;
          }
          const result = await api("/api/hr/people", { method: "POST", body });
          state.hrOptions = null;
          toast("Personal " + result.folio + " guardado.");
          showHrPersonConfirmation(result, body.fullName);
          try { await renderHr(); } catch { toast("El expediente se guardó, pero el tablero no pudo actualizarse.", "error"); }
        } catch (error) {
          submit.disabled = false;
          box.textContent = error.message;
          box.classList.remove("hidden");
        }
      };
      entityDialog.showModal(); return;
    }
    const leaveType = type;
    const selectedEmployee = employeeRecords.find((row) => Number(row.id) === Number(employeeId))
      || state.hrControl?.people?.find((row) => Number(row.id) === Number(employeeId));
    if (!selectedEmployee || selectedEmployee.status === "inactive") {
      toast("Selecciona la solicitud desde la fila de un colaborador activo.", "error");
      return;
    }
    const title = { permission: "Nuevo permiso", vacation: "Nuevas vacaciones", incapacity: "Nueva incapacidad" }[leaveType];
    const leaveSubtypeOptions = {
      permission: ["Asunto personal", "Cita médica", "Comisión laboral", "Trámite oficial", "Evento familiar", "Permiso con goce", "Permiso sin goce", "Otro"],
      vacation: ["Periodo ordinario", "Día de vacaciones", "Vacaciones anticipadas", "Vacaciones pendientes", "Otro"],
      incapacity: ["Enfermedad general", "Riesgo de trabajo", "Accidente de trabajo", "Accidente en trayecto", "Enfermedad de trabajo", "Maternidad", "Otro"],
    }[leaveType] || [];
    const subtypeOptions = '<option value="">Selecciona un subtipo</option>'
      + leaveSubtypeOptions.map((option) => '<option value="' + escapeAttribute(option) + '">' + escapeHtml(option) + '</option>').join("");
    const hoursHelpText = {
      permission: "Captura horas únicamente cuando el permiso cubra una parte de la jornada, por ejemplo 2.5 horas. Si corresponde a días completos, conserva el valor en 0.",
      vacation: "Las vacaciones se calculan automáticamente por los días indicados entre Inicio y Fin. En este tipo de solicitud conserva el valor en 0.",
      incapacity: "La incapacidad se calcula por fechas. Captura horas solamente si el documento médico especifica una ausencia parcial; de lo contrario conserva el valor en 0.",
    }[leaveType];
    const certificateField = leaveType === "incapacity"
      ? '<label class="hr-hours-field hr-certificate-field"><span class="hr-hours-label">Certificado<button class="hr-hours-help-button" type="button" data-hr-field-help data-hr-certificate-help aria-label="Explicar qué certificado capturar" aria-expanded="false">?</button></span><input name="certificateNumber" maxlength="120" /><span class="hr-hours-help-popover" data-hr-field-popover role="note" hidden><strong>¿Qué debo capturar?</strong><small>Ingresa el número o folio del certificado de incapacidad que aparece en el documento médico. Si el documento no incluye un identificador, puedes dejar este campo vacío.</small></span></label>'
      : "";
    const employeeReference = '<div class="hr-selected-employee"><div><small>COLABORADOR DE LA SOLICITUD</small><strong>' + escapeHtml(selectedEmployee.full_name) + '</strong></div><span>' + escapeHtml(selectedEmployee.employee_number) + '</span><input type="hidden" name="employeeId" value="' + selectedEmployee.id + '" /></div>';
    const vacationBalancePanel = leaveType === "vacation" ? '<section class="hr-vacation-balance-card" data-vacation-balance><header><div><span>SALDO DE VACACIONES</span><strong>Proyección de la solicitud</strong></div><small>El descuento se realiza al autorizar.</small></header><div class="hr-vacation-balance-metrics"><div><span>Disponible hoy</span><strong data-vacation-available>' + inventoryNumber(selectedEmployee.vacation_available || 0) + '</strong><small>días</small></div><div><span>Días solicitados</span><strong data-vacation-requested>—</strong><small>hábiles</small></div><div><span>Restantes</span><strong data-vacation-remaining>—</strong><small>proyectados</small></div></div><p data-vacation-message>Selecciona las fechas para calcular fines de semana y días festivos.</p></section>' : "";
    $("#entity-modal-content").innerHTML = '<form id="hr-form"><div class="modal-head"><div><span class="eyebrow">SOLICITUD DE PERSONAL</span><h2>' + title + '</h2></div><button type="button" data-close-modal>×</button></div><input type="hidden" name="leaveType" value="' + leaveType + '" />' + employeeReference + '<div class="form-grid"><label>Subtipo<select name="subtype" required>' + subtypeOptions + '</select></label><label>Inicio<input name="startDate" type="date" required /></label><label>Fin<input name="endDate" type="date" required /></label><label class="hr-hours-field"><span class="hr-hours-label">Horas (si aplica)<button class="hr-hours-help-button" type="button" data-hr-field-help data-hr-hours-help aria-label="Explicar cuándo aplicar horas" aria-expanded="false">?</button></span><input name="totalHours" type="number" min="0" step="0.5" value="0" /><span class="hr-hours-help-popover" data-hr-field-popover data-hr-hours-popover role="note" hidden><strong>¿Cuándo se aplica?</strong><small>' + escapeHtml(hoursHelpText) + '</small></span></label>' + certificateField + '</div><label>Motivo<textarea name="reason" rows="3" required></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Enviar solicitud</button></div></form>';
    const leaveForm = $("#hr-form");
    if (vacationBalancePanel) $(".hr-selected-employee", leaveForm).insertAdjacentHTML("afterend", vacationBalancePanel);
    if (leaveType === "vacation") $(".hr-hours-field", leaveForm)?.remove();
    const fieldHelpButtons = $$("[data-hr-field-help]", leaveForm);
    const closeFieldHelp = (except = null) => fieldHelpButtons.forEach((button) => {
      if (button === except) return;
      $("[data-hr-field-popover]", button.closest(".hr-hours-field")).hidden = true;
      button.setAttribute("aria-expanded", "false");
    });
    fieldHelpButtons.forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const popover = $("[data-hr-field-popover]", button.closest(".hr-hours-field"));
        const opening = popover.hidden;
        closeFieldHelp(button);
        popover.hidden = !opening;
        button.setAttribute("aria-expanded", String(opening));
      };
    });
    leaveForm.addEventListener("click", (event) => {
      if (!event.target.closest(".hr-hours-field")) {
        closeFieldHelp();
      }
    });
    if (leaveType === "vacation") {
      let previewSequence = 0;
      const refreshVacationProjection = async () => {
        const sequence = ++previewSequence;
        const startDate = leaveForm.elements.startDate.value, endDate = leaveForm.elements.endDate.value;
        const card = $("[data-vacation-balance]", leaveForm), message = $("[data-vacation-message]", card);
        card.classList.remove("warning", "ready", "error");
        if (!startDate || !endDate) {
          $("[data-vacation-requested]", card).textContent = "—";
          $("[data-vacation-remaining]", card).textContent = "—";
          message.textContent = "Selecciona las fechas para calcular fines de semana y días festivos.";
          return;
        }
        message.textContent = "Calculando saldo con la política vigente…";
        try {
          const preview = await api("/api/hr/leaves/preview", { method: "POST", body: { employeeId: selectedEmployee.id, leaveType, startDate, endDate } });
          if (sequence !== previewSequence) return;
          const balance = preview.balance;
          $("[data-vacation-available]", card).textContent = inventoryNumber(balance.availableBefore);
          $("[data-vacation-requested]", card).textContent = inventoryNumber(balance.requestedDays);
          $("[data-vacation-remaining]", card).textContent = inventoryNumber(balance.availableAfter);
          card.classList.add(balance.advanceDays > 0 ? "warning" : "ready");
          if (preview.overlap) {
            card.classList.add("error");
            message.textContent = "Las fechas coinciden con " + preview.overlap.folio + ". Ajusta el periodo antes de enviar.";
          } else if (balance.advanceDays > 0) {
            message.textContent = "Requiere autorización de " + inventoryNumber(balance.advanceDays) + " día(s) anticipado(s). Deuda proyectada: " + inventoryNumber(balance.debtAfter) + " día(s).";
          } else {
            message.textContent = inventoryNumber(preview.workingDays) + " día(s) hábil(es). Después de autorizar quedarían " + inventoryNumber(balance.availableAfter) + " día(s).";
          }
        } catch (error) {
          if (sequence !== previewSequence) return;
          card.classList.add("error");
          message.textContent = error.message;
        }
      };
      leaveForm.elements.startDate.addEventListener("change", refreshVacationProjection);
      leaveForm.elements.endDate.addEventListener("change", refreshVacationProjection);
    }
    leaveForm.onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget, box = $(".form-error", form), submit = $('button[type="submit"]', form);
      const body = Object.fromEntries(new FormData(form));
      box.classList.add("hidden");
      submit.disabled = true;
      submit.textContent = "Registrando solicitud…";
      try {
        const result = await api("/api/hr/leaves", { method: "POST", body });
        state.hrOptions = null;
        toast("Solicitud " + result.folio + " registrada.");
        try { await renderHr(); } catch { toast("La solicitud se guardó, pero el tablero no pudo actualizarse.", "error"); }
        showHrLeaveConfirmation(result);
      } catch (error) {
        submit.disabled = false;
        submit.textContent = "Enviar solicitud";
        box.textContent = error.message;
        box.classList.remove("hidden");
      }
    };
    if (!entityDialog.open) entityDialog.showModal();
  }

  async function openCatalogs(section = "areas") {
    if (!state.hrOptions) {
      const [options, control] = await Promise.all([api("/api/hr/options"), api("/api/hr/control")]);
      state.hrOptions = options;
      state.hrControl = control;
    }
    return openHrCatalogsModal(section);
  }

  async function openOrganizationStructure(section = "companies", confirmation = "", editingId = null) {
    const structure = await api("/api/hr/structure", { cache: false });
    const managedFromControl = Boolean(structure.managedCompany);
    const managedLaborCompany = (structure.companies || [])[0] || null;
    const sections = {
      companies: { number: "01", label: "Empresa", hint: "", records: structure.companies || [] },
      work_centers: { number: "02", label: "Centros de trabajo", hint: "Plantas, oficinas y ubicaciones", records: structure.workCenters || [] },
      departments: { number: "03", label: "Departamentos", hint: "Unidades y equipos de trabajo", records: structure.departments || [] },
    };
    if (!sections[section]) section = "companies";
    const active = sections[section], editing = editingId == null ? null : active.records.find((row) => Number(row.id) === Number(editingId));
    const companyOptions = (selected) => (structure.companies || []).map((row) => '<option value="' + row.id + '" ' + (Number(selected) === Number(row.id) ? "selected" : "") + '>' + escapeHtml(row.code + " · " + row.legal_name) + '</option>').join("");
    const centerOptions = (selected) => (structure.workCenters || []).map((row) => '<option value="' + row.id + '" data-company="' + row.company_id + '" ' + (Number(selected) === Number(row.id) ? "selected" : "") + '>' + escapeHtml(row.code + " · " + row.name + " · " + row.company_name) + '</option>').join("");
    const departmentOptions = (selected) => (structure.departments || []).filter((row) => Number(row.id) !== Number(editing?.id || 0)).map((row) => '<option value="' + row.id + '" data-company="' + row.company_id + '" ' + (Number(selected) === Number(row.id) ? "selected" : "") + '>' + escapeHtml(row.code + " · " + row.name) + '</option>').join("");
    const areaOptions = (structure.areas || []).map((row) => '<option value="' + row.id + '" ' + (Number(editing?.area_id) === Number(row.id) ? "selected" : "") + '>' + escapeHtml(row.code + " · " + row.name) + '</option>').join("");
    const companyField = (selected, structureAttribute = "") => managedFromControl && managedLaborCompany
      ? '<label>Empresa administrada<input type="text" value="' + escapeAttribute(managedLaborCompany.trade_name || managedLaborCompany.legal_name) + '" readonly><input type="hidden" name="companyId" value="' + managedLaborCompany.id + '" ' + structureAttribute + '></label>'
      : '<label>Empresa<select name="companyId" ' + structureAttribute + ' required><option value="">Selecciona empresa</option>' + companyOptions(selected) + '</select></label>';
    const submenu = Object.entries(sections).map(([key, item]) => '<button type="button" class="' + (section === key ? "active" : "") + '" data-structure-section="' + key + '"><span>' + item.number + '</span><div><strong>' + item.label + '</strong><small>' + item.hint + '</small></div><b>' + item.records.length + '</b></button>').join("");
    const rows = active.records.map((row) => {
      const name = section === "companies" ? row.legal_name : row.name;
      const detail = section === "companies"
        ? (row.trade_name || "Sin nombre comercial") + (row.tax_id ? " · " + row.tax_id : "")
        : section === "work_centers"
          ? row.company_name + " · " + organizationCenterType(row.center_type)
          : row.company_name + " · " + (row.work_center_name || "Sin centro específico") + (row.area_name ? " · " + row.area_name : "");
      return '<li class="hr-catalog-record"><div><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(detail) + '</small></div><div class="hr-catalog-record-meta"><span>' + escapeHtml(row.code) + '</span><small>' + (row.is_active ? "Activo" : "Inactivo") + '</small>' + (hasPermission("hr.manage") && section !== "companies" ? '<button type="button" data-edit-structure="' + section + '" data-record-id="' + row.id + '">Editar</button>' : "") + '</div></li>';
    }).join("");

    let form = '<div class="hr-catalog-editor"><p class="muted">La administración de esta estructura está reservada al Administrador de RH.</p></div>';
    if (managedFromControl && section === "companies") {
      form = '<div class="hr-catalog-editor managed-structure-company"><h3>' + escapeHtml(managedLaborCompany?.trade_name || managedLaborCompany?.legal_name || "Empresa") + '</h3></div>';
    } else if (hasPermission("hr.manage") && section === "companies") {
      form = '<form id="organization-company-form" class="hr-catalog-editor"><div class="hr-catalog-editor-head"><div><span>' + (editing ? "EDITAR EMPRESA" : "NUEVA EMPRESA") + '</span><h3>' + (editing ? escapeHtml(editing.legal_name) : "Agregar empresa") + '</h3></div>' + (editing ? '<button type="button" data-cancel-structure-edit>Cancelar edición</button>' : "") + '</div><div class="form-grid compact"><label>Razón social<input name="legalName" required maxlength="180" value="' + escapeAttribute(editing?.legal_name || "") + '" placeholder="Ej. Empresa Industrial del Norte, S.A. de C.V."></label><label>Nombre comercial<input name="tradeName" maxlength="180" value="' + escapeAttribute(editing?.trade_name || "") + '" placeholder="Ej. Industrial Norte"></label><label>RFC / identificación fiscal<input name="taxId" maxlength="30" value="' + escapeAttribute(editing?.tax_id || "") + '"></label>' + (editing ? '<label>Estado<select name="isActive"><option value="true" ' + (editing.is_active ? "selected" : "") + '>Activa</option><option value="false" ' + (!editing.is_active ? "selected" : "") + '>Inactiva</option></select></label>' : "") + '</div><p class="form-error hidden"></p><button class="button primary" type="submit">' + (editing ? "Guardar cambios" : "＋ Agregar empresa") + '</button></form>';
    } else if (hasPermission("hr.manage") && section === "work_centers") {
      form = '<form id="organization-center-form" class="hr-catalog-editor"><div class="hr-catalog-editor-head"><div><span>' + (editing ? "EDITAR CENTRO" : "NUEVO CENTRO") + '</span><h3>' + (editing ? escapeHtml(editing.name) : "Agregar centro de trabajo") + '</h3></div>' + (editing ? '<button type="button" data-cancel-structure-edit>Cancelar edición</button>' : "") + '</div><div class="form-grid compact">' + companyField(editing?.company_id) + '<label>Nombre<input name="name" required maxlength="180" value="' + escapeAttribute(editing?.name || "") + '" placeholder="Ej. Planta Monterrey"></label><label>Tipo<select name="centerType"><option value="plant" ' + (editing?.center_type === "plant" ? "selected" : "") + '>Planta</option><option value="branch" ' + (editing?.center_type === "branch" ? "selected" : "") + '>Sucursal</option><option value="work_center" ' + (!editing || editing.center_type === "work_center" ? "selected" : "") + '>Centro de trabajo</option><option value="office" ' + (editing?.center_type === "office" ? "selected" : "") + '>Oficina</option><option value="other" ' + (editing?.center_type === "other" ? "selected" : "") + '>Otro</option></select></label><label class="span-two">Dirección<textarea name="address" rows="2" maxlength="500">' + escapeHtml(editing?.address || "") + '</textarea></label>' + (editing ? '<label>Estado<select name="isActive"><option value="true" ' + (editing.is_active ? "selected" : "") + '>Activo</option><option value="false" ' + (!editing.is_active ? "selected" : "") + '>Inactivo</option></select></label>' : "") + '</div><p class="form-error hidden"></p><button class="button primary" type="submit">' + (editing ? "Guardar cambios" : "＋ Agregar centro") + '</button></form>';
    } else if (hasPermission("hr.manage") && section === "departments") {
      form = '<form id="organization-department-form" class="hr-catalog-editor"><div class="hr-catalog-editor-head"><div><span>' + (editing ? "EDITAR DEPARTAMENTO" : "NUEVO DEPARTAMENTO") + '</span><h3>' + (editing ? escapeHtml(editing.name) : "Agregar departamento") + '</h3></div>' + (editing ? '<button type="button" data-cancel-structure-edit>Cancelar edición</button>' : "") + '</div><div class="form-grid compact">' + companyField(editing?.company_id, 'data-structure-company') + '<label>Centro de trabajo<select name="workCenterId" data-structure-center><option value="">General para la empresa</option>' + centerOptions(editing?.work_center_id) + '</select></label><label>Nombre<input name="name" required maxlength="180" value="' + escapeAttribute(editing?.name || "") + '" placeholder="Ej. Recursos Humanos"></label><label>Departamento superior<select name="parentDepartmentId" data-structure-parent><option value="">Sin departamento superior</option>' + departmentOptions(editing?.parent_department_id) + '</select></label><label>Área funcional<select name="areaId"><option value="">Sin área vinculada</option>' + areaOptions + '</select></label>' + (editing ? '<label>Estado<select name="isActive"><option value="true" ' + (editing.is_active ? "selected" : "") + '>Activo</option><option value="false" ' + (!editing.is_active ? "selected" : "") + '>Inactivo</option></select></label>' : "") + '</div><p class="form-error hidden"></p><button class="button primary" type="submit">' + (editing ? "Guardar cambios" : "＋ Agregar departamento") + '</button></form>';
    }

    $("#entity-modal-content").classList.add("wide", "hr-catalog-modal", "organization-structure-modal");
    $("#entity-modal-content").innerHTML = '<div class="modal-head"><div><span class="eyebrow">DATOS GENERALES</span><h2>Estructura organizacional</h2><p class="muted">Información compartida por Recursos Humanos, Nómina y Seguridad.</p></div><button type="button" data-close-modal>×</button></div>' + (confirmation ? '<div class="hr-catalog-confirmation" role="status"><span>✓</span><div><strong>Información actualizada</strong><small>' + escapeHtml(confirmation) + '</small></div></div>' : "") + '<div class="hr-catalog-workspace"><nav class="hr-catalog-submenu" aria-label="Estructura organizacional">' + submenu + '</nav><section class="hr-catalog-stage"><header><div><span class="eyebrow">' + active.number + ' · DATOS GENERALES</span><h3>' + active.label + '</h3><p>' + active.hint + '.</p></div><strong>' + active.records.length + ' registro(s)</strong></header><ul class="hr-catalog-list">' + (rows || '<li class="empty-row">Aún no hay registros en esta sección.</li>') + '</ul>' + form + '</section></div><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cerrar</button></div>';
    $$('[data-structure-section]').forEach((button) => button.onclick = () => openOrganizationStructure(button.dataset.structureSection));
    $$('[data-edit-structure]').forEach((button) => button.onclick = () => openOrganizationStructure(button.dataset.editStructure, "", Number(button.dataset.recordId)));
    $('[data-cancel-structure-edit]')?.addEventListener("click", () => openOrganizationStructure(section));
    bindOrganizationStructureForm("#organization-company-form", "/api/hr/structure/companies", "Empresa", section, editing?.id);
    bindOrganizationStructureForm("#organization-center-form", "/api/hr/structure/work-centers", "Centro de trabajo", section, editing?.id);
    bindOrganizationStructureForm("#organization-department-form", "/api/hr/structure/departments", "Departamento", section, editing?.id);
    const companySelect = $('[data-structure-company]');
    if (companySelect) {
      const filterRelations = () => {
        const companyId = companySelect.value;
        for (const selector of ['[data-structure-center]', '[data-structure-parent]']) {
          const select = $(selector);
          $$('option[data-company]', select).forEach((option) => option.hidden = Boolean(companyId) && option.dataset.company !== companyId);
          if (select.selectedOptions[0]?.hidden) select.value = "";
        }
      };
      companySelect.onchange = filterRelations;
      filterRelations();
    }
    if (!entityDialog.open) entityDialog.showModal();
  }

  function organizationCenterType(type) {
    return ({ plant: "Planta", branch: "Sucursal", work_center: "Centro de trabajo", office: "Oficina", other: "Otro" })[type] || "Centro de trabajo";
  }

  function bindOrganizationStructureForm(selector, endpoint, label, section, recordId) {
    const form = $(selector);
    if (!form) return;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form)), box = $(".form-error", form), submit = $('button[type="submit"]', form);
      if (Object.hasOwn(body, "isActive")) body.isActive = body.isActive === "true";
      submit.disabled = true;
      try {
        const result = await api(endpoint + (recordId ? "/" + recordId : ""), { method: recordId ? "PATCH" : "POST", body });
        state.hrOptions = null;
        state.hrControl = null;
        toast(label + " " + result.folio + (recordId ? " actualizado." : " guardado."));
        await openOrganizationStructure(section, label + " " + result.folio + " ya está disponible en los expedientes.");
      } catch (error) {
        submit.disabled = false;
        box.textContent = error.message;
        box.classList.remove("hidden");
      }
    };
  }

  return { render: renderHr, openCatalogs, openStructure: openOrganizationStructure };
}
