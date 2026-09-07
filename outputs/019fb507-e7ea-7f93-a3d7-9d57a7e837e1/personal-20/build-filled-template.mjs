import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/Shadow/Downloads/plantilla-carga-personal (1).xlsx";
const outputPath = "C:/Users/Shadow/Documents/Abicorp/outputs/019fb507-e7ea-7f93-a3d7-9d57a7e837e1/personal-20/plantilla-carga-personal-20-trabajadores.xlsx";
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const personal = workbook.worksheets.getItem("Personal");
const catalogos = workbook.worksheets.getItem("Catalogos");
const instrucciones = workbook.worksheets.getItem("Instrucciones");

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

const areaCatalog = [
  ["ARE-00001", "Dirección y Administración"],
  ["ARE-00002", "Recursos Humanos"],
  ["ARE-00003", "Operaciones y Producción"],
  ["ARE-00004", "Almacén y Logística"],
  ["ARE-00005", "Comercial y Finanzas"],
];

const positionCatalog = [
  ["PUE-00001", "Dirección General"],
  ["PUE-00002", "Auxiliar de Recursos Humanos"],
  ["PUE-00003", "Supervisión de Producción"],
  ["PUE-00004", "Operación de Producción"],
  ["PUE-00005", "Almacén y Logística"],
  ["PUE-00006", "Administración Comercial"],
];

const departmentCatalog = [
  ["DEP-00001", "Dirección y Administración"],
  ["DEP-00002", "Recursos Humanos"],
  ["DEP-00003", "Producción"],
  ["DEP-00004", "Almacén y Logística"],
  ["DEP-00005", "Comercial y Finanzas"],
];

const people = [
  ["Andrea Morales Ruiz", "1988-02-14", "M", "DEP-00001", "ARE-00001", "PUE-00001", "TUR-00001", 45000],
  ["Luis Herrera Soto", "1990-06-21", "H", "DEP-00002", "ARE-00002", "PUE-00002", "TUR-00001", 19000],
  ["Karla Navarro Díaz", "1992-11-05", "M", "DEP-00002", "ARE-00002", "PUE-00002", "TUR-00001", 18500],
  ["Miguel Castillo León", "1987-03-18", "H", "DEP-00003", "ARE-00003", "PUE-00003", "TUR-00001", 26000],
  ["Fernanda Vega Cruz", "1994-07-09", "M", "DEP-00003", "ARE-00003", "PUE-00003", "TUR-00002", 25000],
  ["Jorge Ramírez Silva", "1991-01-27", "H", "DEP-00003", "ARE-00003", "PUE-00004", "TUR-00001", 15500],
  ["Daniela Ortega Luna", "1996-04-12", "M", "DEP-00003", "ARE-00003", "PUE-00004", "TUR-00001", 15000],
  ["Ricardo Flores Peña", "1989-09-30", "H", "DEP-00003", "ARE-00003", "PUE-00004", "TUR-00002", 15800],
  ["Paola Mendoza Ríos", "1995-12-16", "M", "DEP-00003", "ARE-00003", "PUE-00004", "TUR-00002", 15000],
  ["Sergio Campos Lara", "1986-05-23", "H", "DEP-00003", "ARE-00003", "PUE-00004", "TUR-00003", 16500],
  ["Valeria Guerrero Solís", "1993-08-08", "M", "DEP-00003", "ARE-00003", "PUE-00004", "TUR-00003", 15700],
  ["Héctor Salgado Mora", "1985-10-19", "H", "DEP-00003", "ARE-00003", "PUE-00004", "TUR-00004", 16800],
  ["Mariana Cabrera Núñez", "1997-02-25", "M", "DEP-00003", "ARE-00003", "PUE-00004", "TUR-00004", 14800],
  ["Óscar Fuentes Rocha", "1990-12-03", "H", "DEP-00004", "ARE-00004", "PUE-00005", "TUR-00001", 17000],
  ["Natalia Paredes Gil", "1998-06-14", "M", "DEP-00004", "ARE-00004", "PUE-00005", "TUR-00002", 16500],
  ["Eduardo Lozano Reyes", "1988-11-29", "H", "DEP-00004", "ARE-00004", "PUE-00005", "TUR-00003", 17500],
  ["Gabriela Rojas Méndez", "1992-04-07", "M", "DEP-00005", "ARE-00005", "PUE-00006", "TUR-00001", 22000],
  ["Iván Sandoval Ortiz", "1994-09-11", "H", "DEP-00005", "ARE-00005", "PUE-00006", "TUR-00001", 21000],
  ["Cecilia Torres Acosta", "1996-01-20", "M", "DEP-00005", "ARE-00005", "PUE-00006", "TUR-00001", 20500],
  ["Arturo Medina Bravo", "1987-07-26", "H", "DEP-00005", "ARE-00005", "PUE-00006", "TUR-00001", 23000],
];

const rows = people.map((person, index) => {
  const [fullName, birthDate, gender, departmentCode, areaCode, positionCode, shiftCode, salary] = person;
  const number = String(index + 1).padStart(2, "0");
  const compactBirth = birthDate.slice(2).replaceAll("-", "");
  const temporary = [5, 10, 15, 20].includes(index + 1);
  const hireYear = 2022 + (index % 5);
  const hireDate = `${hireYear}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 20) + 1).padStart(2, "0")}`;
  const record = {
    nombre_completo: fullName,
    curp: `XEXX${compactBirth}${gender}NEXXX${number}`,
    rfc: `XEXX${compactBirth}A${number}`,
    nss: String(90000000000 + index + 1),
    fecha_nacimiento: birthDate,
    correo: `colaborador${number}@example.com`,
    telefono: String(5551000000 + index + 1),
    calle: `Avenida Industrial ${100 + index + 1}`,
    numero_exterior: String(100 + index + 1),
    numero_interior: index % 4 === 0 ? `Int ${index + 1}` : "",
    colonia: "Parque Empresarial",
    municipio: "Monterrey",
    estado: "Nuevo León",
    codigo_postal: "64000",
    pais: "México",
    contacto_emergencia: `Contacto Ficticio ${number}`,
    telefono_emergencia: String(5552000000 + index + 1),
    parentesco_emergencia: index % 3 === 0 ? "Cónyuge" : index % 3 === 1 ? "Madre/Padre" : "Hermano(a)",
    empresa_codigo: "BEC_0004",
    centro_codigo: "CTR-00001",
    departamento_codigo: departmentCode,
    area_codigo: areaCode,
    puesto_codigo: positionCode,
    jefe_id_laboral: "",
    fecha_ingreso: hireDate,
    tipo_contratacion: temporary ? "temporary" : "permanent",
    turno_codigo: shiftCode,
    tipo_contrato: temporary ? "temporary" : "permanent",
    numero_contrato: `CT-2026-${String(index + 1).padStart(3, "0")}`,
    inicio_contrato: hireDate,
    fin_contrato: temporary ? "2027-12-31" : "",
    periodicidad_nomina: "biweekly",
    condicion_sindical: "No sindicalizado",
    salario_base: salary,
    moneda: "MXN",
    metodo_pago: "Transferencia",
    referencia_bancaria: `REFERENCIA-DEMO-${number}`,
    organizacion: "",
    detalle_organizacion: "",
    contacto_organizacion: "",
    telefono_organizacion: "",
    correo_organizacion: "",
    asesor: "",
    telefono_asesor: "",
    correo_asesor: "",
    inicio_servicio: "",
    fin_servicio: "",
    horas_requeridas: "",
    notas: "Registro ficticio generado para pruebas de carga masiva.",
  };
  return headers.map((header) => record[header] ?? "");
});

personal.getRange("A2:AW501").clear({ applyTo: "contents" });
personal.getRange("A2:AW21").values = rows;
personal.getRange("A1:AW1").format = {
  fill: "#0F4D3A",
  font: { bold: true, color: "#FFFFFF", fontSize: 9 },
  wrapText: true,
  rowHeight: 34,
  verticalAlignment: "center",
};
personal.getRange("A2:AW21").format = {
  font: { fontSize: 9 },
  verticalAlignment: "center",
};
personal.getRange("B2:D21").format.numberFormat = "@";
personal.getRange("F2:G21").format.numberFormat = "@";
personal.getRange("N2:N21").format.numberFormat = "@";
personal.getRange("Q2:Q21").format.numberFormat = "@";
personal.getRange("E2:E21").format.numberFormat = "yyyy-mm-dd";
personal.getRange("Y2:Y21").format.numberFormat = "yyyy-mm-dd";
personal.getRange("AD2:AE21").format.numberFormat = "yyyy-mm-dd";
personal.getRange("AH2:AH21").format.numberFormat = "#,##0";
personal.freezePanes.freezeRows(1);
personal.freezePanes.freezeColumns(1);

const columnWidths = [
  24, 21, 17, 15, 15, 29, 15, 24, 15, 15, 21, 18, 18, 14, 13, 24, 18, 21,
  17, 16, 20, 16, 16, 17, 15, 19, 15, 15, 19, 15, 15, 20, 20, 15, 12, 17, 24,
  20, 24, 27, 22, 27, 22, 18, 27, 15, 15, 17, 38,
];
function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}
columnWidths.forEach((width, index) => {
  const column = columnName(index);
  personal.getRange(`${column}1:${column}21`).format.columnWidth = width;
});

const catalogRows = [
  ["tipo", "codigo", "nombre"],
  ["empresa", "BEC_0004", "Flors1899084JVSC"],
  ["centro", "CTR-00001", "Centro de trabajo principal"],
  ...departmentCatalog.map(([code, name]) => ["departamento", code, name]),
  ...areaCatalog.map(([code, name]) => ["área", code, name]),
  ...positionCatalog.map(([code, name]) => ["puesto", code, name]),
  ["turno", "TUR-00001", "Diurno"],
  ["turno", "TUR-00002", "Vespertino"],
  ["turno", "TUR-00003", "Nocturno"],
  ["turno", "TUR-00004", "Mixto"],
];
catalogos.getRange("A1:C200").clear({ applyTo: "contents" });
catalogos.getRange(`A1:C${catalogRows.length}`).values = catalogRows;
catalogos.getRange("A1:C1").format = {
  fill: "#0F4D3A",
  font: { bold: true, color: "#FFFFFF" },
  rowHeight: 26,
};
catalogos.getRange(`A2:C${catalogRows.length}`).format.font = { fontSize: 10 };
catalogos.getRange(`A1:A${catalogRows.length}`).format.columnWidth = 18;
catalogos.getRange(`B1:B${catalogRows.length}`).format.columnWidth = 19;
catalogos.getRange(`C1:C${catalogRows.length}`).format.columnWidth = 38;
catalogos.freezePanes.freezeRows(1);

const instructionRows = [
  ["CARGA MASIVA DE PERSONAL", ""],
  ["1", "La hoja Personal contiene 20 registros completamente ficticios."],
  ["2", "No cambies los encabezados. Usa fechas con formato yyyy-mm-dd."],
  ["3", "Registra previamente los códigos organizacionales incluidos en la hoja Catalogos."],
  ["4", "Tipos de contratación: permanent, temporary, contractor o intern."],
  ["5", "Periodicidad: weekly, biweekly, monthly u other."],
  ["6", "La vista previa no guarda colaboradores; debes confirmar el lote."],
  ["7", "Los datos organizacionales faltantes generan advertencias y requieren confirmación expresa."],
  ["8", "Si una fila tiene un error bloqueante, no se importará ninguna."],
  ["9", "Empresa utilizada: BEC_0004. Centro propuesto: CTR-00001."],
  ["10", "Correos, CURP, RFC, NSS, teléfonos, domicilios y referencias son datos sintéticos de prueba."],
];
instrucciones.getRange("A1:B30").clear({ applyTo: "contents" });
instrucciones.getRange(`A1:B${instructionRows.length}`).values = instructionRows;
instrucciones.getRange("A1:B1").format = {
  fill: "#0F4D3A",
  font: { bold: true, color: "#FFFFFF", fontSize: 12 },
  rowHeight: 28,
};
instrucciones.getRange(`A2:B${instructionRows.length}`).format = { font: { fontSize: 10 }, wrapText: true };
instrucciones.getRange(`A1:A${instructionRows.length}`).format.columnWidth = 10;
instrucciones.getRange(`B1:B${instructionRows.length}`).format.columnWidth = 95;
instrucciones.freezePanes.freezeRows(1);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const personalCheck = await workbook.inspect({
  kind: "table",
  sheetId: "Personal",
  range: "A1:AW21",
  include: "values,formulas",
  tableMaxRows: 22,
  tableMaxCols: 49,
  maxChars: 30000,
});
console.log(personalCheck.ndjson);
const catalogCheck = await workbook.inspect({
  kind: "table",
  sheetId: "Catalogos",
  range: `A1:C${catalogRows.length}`,
  include: "values,formulas",
  tableMaxRows: 30,
  tableMaxCols: 4,
  maxChars: 10000,
});
console.log(catalogCheck.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

for (const [sheetName, range, fileName] of [
  ["Personal", "A1:AW21", "final-personal.png"],
  ["Catalogos", `A1:C${catalogRows.length}`, "final-catalogos.png"],
  ["Instrucciones", `A1:B${instructionRows.length}`, "final-instrucciones.png"],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(`C:/Users/Shadow/Documents/Abicorp/outputs/019fb507-e7ea-7f93-a3d7-9d57a7e837e1/personal-20/${fileName}`,
    new Uint8Array(await preview.arrayBuffer()));
}
