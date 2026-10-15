/*
 * Copyright © 2023-2026, Yurii Kadirov. All rights reserved.
 * See [LICENSE.md] in the project root for more details.
 */

import * as cheerio from 'cheerio';
import { ParsedCell } from './types.js';

export interface RawTableRow {
  cells: ParsedCell[];
}

export interface RawTable {
  rows: RawTableRow[];
}

export function parseHtmlTable(html: string): RawTable {
  const $ = cheerio.load(html);
  const table = $('table').first();
  const rows: RawTableRow[] = [];

  table.find('tr').each((_, tr) => {
    const cells: ParsedCell[] = [];
    $(tr).find('td').each((_, td) => {
      const $td = $(td);
      const text = $td.text().trim();
      const rowspan = parseInt($td.attr('rowspan') || '1', 10);
      const colspan = parseInt($td.attr('colspan') || '1', 10);
      cells.push({ text, rowspan, colspan });
    });
    if (cells.length > 0) {
      rows.push({ cells });
    }
  });

  return { rows };
}

export function expandTable(table: RawTable): string[][] {
  if (table.rows.length === 0) return [];

  const maxCols = Math.max(
    ...table.rows.map(row => row.cells.reduce((sum, cell) => sum + cell.colspan, 0))
  );

  const grid: (string | null)[][] = [];
  const occupied: boolean[][] = [];

  for (let i = 0; i < table.rows.length; i++) {
    if (!grid[i]) grid[i] = new Array(maxCols).fill(null);
    if (!occupied[i]) occupied[i] = new Array(maxCols).fill(false);

    let colIndex = 0;
    for (const cell of table.rows[i].cells) {
      while (colIndex < maxCols && occupied[i][colIndex]) {
        colIndex++;
      }
      if (colIndex >= maxCols) break;

      for (let r = 0; r < cell.rowspan; r++) {
        for (let c = 0; c < cell.colspan; c++) {
          const rowIdx = i + r;
          const colIdx = colIndex + c;
          if (!grid[rowIdx]) grid[rowIdx] = new Array(maxCols).fill(null);
          if (!occupied[rowIdx]) occupied[rowIdx] = new Array(maxCols).fill(false);
          grid[rowIdx][colIdx] = cell.text;
          occupied[rowIdx][colIdx] = true;
        }
      }
      colIndex += cell.colspan;
    }
  }

  return grid.map(row => row.map(cell => cell ?? ''));
}
