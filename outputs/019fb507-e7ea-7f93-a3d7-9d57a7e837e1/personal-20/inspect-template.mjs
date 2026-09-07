import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import fs from "node:fs/promises";

const inputPath = "C:/Users/Shadow/Downloads/plantilla-carga-personal (1).xlsx";
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 12,
  tableMaxCols: 30,
  tableMaxCellChars: 120,
});
console.log(summary.ndjson);
for (const [sheetId, range] of [["Personal", "A1:AW2"], ["Catalogos", "A1:C6"], ["Instrucciones", "A1:B9"]]) {
  const styles = await workbook.inspect({ kind: "computedStyle", sheetId, range, maxChars: 3000 });
  console.log(styles.ndjson);
}
for (const sheetName of ["Personal", "Catalogos", "Instrucciones"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`original-${sheetName.toLowerCase()}.png`, new Uint8Array(await preview.arrayBuffer()));
}
