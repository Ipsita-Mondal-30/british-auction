/** RFC 4180 CSV with spreadsheet formula-injection protection. */

type Cell = string | number | null | undefined;

export function csvCell(value: Cell): string {
  let s = value == null ? '' : String(value);
  // Supplier-typed text (e.g. carrier name) must not run as a formula in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel reads UTF-8 names correctly.
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
