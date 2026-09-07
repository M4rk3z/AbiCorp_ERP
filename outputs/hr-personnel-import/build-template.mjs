import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL("./", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const workbook = Workbook.create();
const personal = workbook.worksheets.add("Personal");
const catalogs = workbook.worksheets.add("Catalogos");
const instructions = workbook.worksheets.add("Instrucciones");

const headers = [
  "nombre_completo", "curp", "rfc", "nss", "fecha_nacimiento", "correo", "telefono",
  "calle", "numero_exterior", "numero_interior", "colonia", "municipio", "estado",
  "codigo_postal", "pais", "contacto_emergencia", "telefono_emergencia",
  "parentesco_emergencia", "empresa_codigo", "centro_codigo", "departamento_codigo",
  "area_codigo", "puesto_codigo", "jefe_id_laboral", "fecha_ingreso", "tipo_contratacion",
  "turno_codigo", "tipo_contrato", "numero_contrato", "inicio_contrato", "fin_contrato",
  "periodicidad_nomina", "condicion_sindical", "salario_base", "moneda", "metodo_pago",
  "referencia_bancaria", "organizacion", "detalle_organizacion", "contacto_organizacion",
  "telefono_organizacion", "correo_organizacion", "asesor", "telefono_asesor",
  "correo_asesor", "inicio_servicio", "fin_servicio", "horas_requeridas", "notas",
];
const example = [
  "EJEMPLO - BORRAR ESTA FILA", "XEXX010101HNEXXXA4", "XAXX010101000", "12345678901",
  new Date(Date.UTC(2001, 0, 1)), "persona@example.com", "5555555555", "Calle ejemplo", "10", "",
  "Centro", "Municipio", "Estado", "00000", "México", "Contacto ejemplo", "5555555556",
  "Familiar", "EMP-00001", "CTR-00001", "DEP-00001", "ARE-00001", "PUE-00001", "",
  new Date(Date.UTC(2026, 7, 4)), "permanent", "", "permanent", "", new Date(Date.UTC(2026, 7, 4)),
  null, "biweekly", "", 0, "MXN", "transferencia", "", "", "", "", "", "", "", "", "",
  null, null, 0, "Borra esta fila antes de importar.",
];
personal.getRange("A1:AW2").values = [headers, example];
personal.showGridLines = false;
personal.freezePanes.freezeRows(1);
personal.getRange("A1:AW1").format = {
  fill: "#0F4938", font: { bold: true, color: "#FFFFFF", size: 10 },
  wrapText: true, verticalAlignment: "center",
  borders: { preset: "outside", style: "medium", color: "#0A3529" },
};
personal.getRange("A1:AW1").format.rowHeight = 42;
personal.getRange("A2:AW2").format = { fill: "#FFF4C2", font: { color: "#5F4A00", italic: true }, wrapText: true };
personal.getRange("E2:E501").format.numberFormat = "yyyy-mm-dd";
personal.getRange("Y2:Y501").format.numberFormat = "yyyy-mm-dd";
personal.getRange("AD2:AE501").format.numberFormat = "yyyy-mm-dd";
personal.getRange("AT2:AU501").format.numberFormat = "yyyy-mm-dd";
for (const range of ["B2:D501", "G2:G501", "I2:J501", "N2:N501", "Q2:Q501", "S2:X501", "AA2:AC501", "AI2:AI501", "AK2:AK501", "AO2:AO501", "AR2:AR501"]) {
  personal.getRange(range).format.numberFormat = "@";
}
personal.getRange("Z2:Z501").dataValidation = { rule: { type: "list", values: ["permanent", "temporary", "contractor", "intern"] } };
personal.getRange("AF2:AF501").dataValidation = { rule: { type: "list", values: ["weekly", "biweekly", "monthly", "other"] } };
personal.getRange("B2:B501").conditionalFormats.add("duplicateValues", { format: { fill: "#FFE4E1", font: { color: "#A12F2A" } } });
personal.getRange("C2:C501").conditionalFormats.add("duplicateValues", { format: { fill: "#FFE4E1", font: { color: "#A12F2A" } } });
personal.getRange("D2:D501").conditionalFormats.add("duplicateValues", { format: { fill: "#FFE4E1", font: { color: "#A12F2A" } } });
for (let col = 0; col < headers.length; col += 1) {
  personal.getRangeByIndexes(0, col, 501, 1).format.columnWidth = Math.min(28, Math.max(14, headers[col].length + 2));
}

const catalogRows = [
  ["tipo", "codigo", "nombre"], ["empresa", "EMP-00001", "Empresa configurada"],
  ["centro", "CTR-00001", "Centro configurado"], ["departamento", "DEP-00001", "Departamento configurado"],
  ["área", "ARE-00001", "Área configurada"], ["puesto", "PUE-00001", "Puesto configurado"],
  ["turno", "TUR-00001", "Turno configurado"],
];
catalogs.getRange("A1:C7").values = catalogRows;
catalogs.showGridLines = false; catalogs.freezePanes.freezeRows(1);
catalogs.getRange("A1:C1").format = { fill: "#0F4938", font: { bold: true, color: "#FFFFFF" } };
catalogs.getRange("A2:C7").format.borders = { preset: "inside", style: "thin", color: "#DCE5E0" };
catalogs.getRange("A1:A7").format.columnWidth = 20;
catalogs.getRange("B1:B7").format.columnWidth = 22;
catalogs.getRange("C1:C7").format.columnWidth = 38;

instructions.getRange("A1:F2").merge();
instructions.getRange("A1:F2").values = [["CARGA MASIVA DE PERSONAL"]];
instructions.getRange("A1:F2").format = { fill: "#0F4938", font: { bold: true, color: "#FFFFFF", size: 18 }, verticalAlignment: "center" };
instructions.getRange("A4:F4").merge();
instructions.getRange("A4:F4").values = [["Antes de importar"]];
instructions.getRange("A4:F4").format = { fill: "#C8F56A", font: { bold: true, color: "#163E31" } };
const rules = [
  ["01", "Borra la fila de ejemplo de la hoja Personal."],
  ["02", "No cambies los encabezados y usa fechas yyyy-mm-dd."],
  ["03", "Usa los códigos exactos de la hoja Catalogos que descarga el ERP."],
  ["04", "Tipos: permanent, temporary, contractor o intern."],
  ["05", "Periodicidad: weekly, biweekly, monthly u other."],
  ["06", "La vista previa no guarda colaboradores. Debes confirmar el lote."],
  ["07", "Si existe un error, no se importará ninguna fila."],
];
instructions.getRange("A6:B12").values = rules;
instructions.getRange("A6:A12").format = { fill: "#E8F2EC", font: { bold: true, color: "#0F4938" }, horizontalAlignment: "center" };
instructions.getRange("B6:B12").format = { wrapText: true, borders: { preset: "inside", style: "thin", color: "#DCE5E0" } };
instructions.getRange("A1:A12").format.columnWidth = 10;
instructions.getRange("B1:B12").format.columnWidth = 78;
instructions.showGridLines = false;

await fs.mkdir(outputDir, { recursive: true });
const file = await SpreadsheetFile.exportXlsx(workbook);
await file.save(`${outputDir}/plantilla-carga-personal.xlsx`);
for (const sheetName of ["Personal", "Catalogos", "Instrucciones"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/preview-${sheetName.toLowerCase()}.png`, new Uint8Array(await preview.arrayBuffer()));
}
const inspection = await workbook.inspect({ kind: "table", range: "Personal!A1:AW2", include: "values,formulas", tableMaxRows: 3, tableMaxCols: 49, maxChars: 8000 });
await fs.writeFile(`${outputDir}/inspection.ndjson`, inspection.ndjson, "utf8");
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
await fs.writeFile(`${outputDir}/errors.ndjson`, errors.ndjson, "utf8");
