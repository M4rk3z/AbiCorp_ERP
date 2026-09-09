import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHrModule } from "../public/modules/hr.js";

test("Recursos Humanos se carga como módulo independiente y puede renderizar su estado inicial", async () => {
  const pageContent = { innerHTML: "", onclick: null };
  const state = { hrControl: null, hrOptions: null, user: { fullName: "Usuario de prueba", permissions: [] } };
  const options = { employees: [], areas: [], areaCatalog: [], companies: [], workCenters: [],
    departments: [], jobPositions: [], workShifts: [], vacationPlans: [] };
  const control = { people: [], leaves: [], attendance: [], options,
    indicators: { activePeople: 0, awayToday: 0, pendingRequests: 0, staffEntriesMonth: 0,
      staffExitsMonth: 0, turnoverRate: 0 }, _controlVersion: 1 };
  const escape = (value) => String(value ?? "");
  const module = createHrModule({
    $: () => null,
    $$: () => [],
    API_BASE: "",
    HR_CONTROL_CACHE_MS: 60_000,
    state,
    api: async () => control,
    hasPermission: () => false,
    pageContent,
    entityDialog: { open: false, showModal() {}, close() {} },
    confirmAction: async () => true,
    requestActionText: async () => "Motivo de prueba",
    beginPageRender: () => 1,
    renderIsCurrent: () => true,
    escapeHtml: escape,
    escapeAttribute: escape,
    toast() {},
    formatDate: escape,
    formatDateOnly: escape,
    todayInput: () => "2026-08-06",
    inventoryNumber: (value) => String(Number(value || 0)),
    emptyMarkup: (title, detail) => `<div>${title}${detail}</div>`,
    workforceStatus: (status) => `<span>${status}</span>`,
    hrEmployment: escape,
    hrShift: escape,
    hrShiftCatalogSummary: escape,
    hrParsedShiftSchedule: () => [],
    hrShiftSchedule: escape,
    hrVacationSeniority: escape,
    hrServiceYears: () => 0,
    hrAutomaticVacationPlan: () => null,
    fileToBase64: async () => "",
    downloadAuthenticatedFile: async () => {},
    automaticCodeBanner: () => "",
    checkbox: () => "",
    initials: () => "UP",
  });

  await module.render();
  assert.match(pageContent.innerHTML, /Organiza a tu equipo/);
  assert.match(pageContent.innerHTML, /Pulso de Recursos Humanos/);
  assert.equal(state.hrControl, control);
  assert.equal(state.hrOptions, options);
});

test("la portada de Recursos Humanos prioriza acciones y métricas legibles", () => {
  const source = readFileSync(new URL("../public/modules/hr.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(source, /function hrCommandActions/);
  assert.match(source, /data-hr-new="person">＋ Agregar personal/);
  assert.match(source, /aria-label="Herramientas de Recursos Humanos"/);
  assert.match(source, /aria-label="Resumen operativo de Recursos Humanos"/);
  assert.match(source, /MOVIMIENTOS DEL MES/);
  assert.match(styles, /\.hr-overview-grid/);
  assert.match(styles, /\.hr-command-links/);
  assert.match(styles, /@media \(max-width: 680px\)[^]*\.hr-overview-grid \{ grid-template-columns: 1fr; \}/);
});
