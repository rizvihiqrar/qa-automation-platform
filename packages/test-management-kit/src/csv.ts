export interface CsvOptions {
  /** Quote every field (TestRail's own exports do) instead of only those that need it. */
  quoteAll: boolean;
  bom: boolean;
  eol: '\r\n' | '\n';
}

function field(value: string, quoteAll: boolean): string {
  const needsQuotes = quoteAll || /[",\r\n]/.test(value) || value !== value.trim();
  return needsQuotes ? '"' + value.replaceAll('"', '""') + '"' : value;
}

export function toCsv(rows: string[][], options: CsvOptions): string {
  const body = rows.map((row) => row.map((value) => field(value, options.quoteAll)).join(',')).join(options.eol) + options.eol;
  return (options.bom ? '﻿' : '') + body;
}
