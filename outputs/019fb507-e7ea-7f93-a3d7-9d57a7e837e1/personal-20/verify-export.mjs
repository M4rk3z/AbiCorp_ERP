import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "C:/Users/Shadow/Documents/Abicorp/outputs/019fb507-e7ea-7f93-a3d7-9d57a7e837e1/personal-20/plantilla-carga-personal-20-trabajadores.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));

const personal = await workbook.inspect({
  kind: "table",
  sheetId: "Personal",
  range: "A1:AW21",
  include: "values,formulas",
  tableMaxRows: 22,
  tableMaxCols: 49,
  maxChars: 120000,
});
const catalogos = await workbook.inspect({
  kind: "table",
  sheetId: "Catalogos",
  range: "A1:C23",
  include: "values,formulas",
  tableMaxRows: 24,
  tableMaxCols: 3,
  maxChars: 20000,
});
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "formula error scan",
});

const personalData = JSON.parse(personal.ndjson.trim().split("\n").at(-1));
const catalogData = JSON.parse(catalogos.ndjson.trim().split("\n").at(-1));
const errorData = errors.ndjson.trim() ? JSON.parse(errors.ndjson.trim().split("\n").at(-1)) : {};
const personalRows = personalData.values ?? personalData.data?.values ?? [];
const catalogRows = catalogData.values ?? catalogData.data?.values ?? [];
const names = personalRows.slice(1).map((row) => row?.[0]).filter(Boolean);
const areaRows = catalogRows.filter((row) => row?.[0] === "área");
const positionRows = catalogRows.filter((row) => row?.[0] === "puesto");

console.log(JSON.stringify({
  sheets: workbook.worksheets.items.map((sheet) => sheet.name),
  workerCount: names.length,
  uniqueWorkerNames: new Set(names).size,
  areaCount: areaRows.length,
  positionCount: positionRows.length,
  catalogRowCount: catalogRows.length - 1,
  formulaErrorMatches: errorData.matches?.length ?? errorData.results?.length ?? 0,
}, null, 2));

if (names.length !== 20 || new Set(names).size !== 20 || areaRows.length !== 5 || positionRows.length !== 6) {
  throw new Error("La validación final no coincide con las cantidades solicitadas.");
}
