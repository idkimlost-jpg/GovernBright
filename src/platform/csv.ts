// RFC 4180 CSV parser: quoted fields, escaped quotes, embedded commas and newlines, CRLF or LF.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== "")) rows.push(row);
  return rows;
}

// Maps each wanted column to the first header that matches one of its aliases.
export function findColumns<K extends string>(header: string[], aliases: Record<K, string[]>): Record<K, number> {
  const normalized = header.map(h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  return Object.fromEntries(Object.entries(aliases).map(([key, names]) =>
    [key, normalized.findIndex(h => (names as string[]).some(n => h === n || h.includes(n)))])) as Record<K, number>;
}
