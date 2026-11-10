import { HQ_CELL_LIMIT, HQ_SECTION_ROW_LIMIT, HQ_TRUNCATED_STATUS_MARKER, hqCut, type HQRegisterResult, type HQTestRow, type HQTestSection } from './model.js';

const widths: Record<HQTestSection,number>={live:9,queue:7,history:5};
const sections=['live','queue','history'] as const;

/** Split Markdown table cells without treating escaped pipes or code spans as separators. */
function tableCells(line: string): string[] {
  const cells: string[] = []; let cell = '', fence = 0;
  const runs = new Map<number, number>();
  for (const match of line.matchAll(/`+/g)) {
    const length = match[0].length;
    runs.set(length, match.index);
  }
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '\\' && !fence && index + 1 < line.length) {
      const next = line[++index]!;
      cell += next === '|' ? next : `\\${next}`;
    } else if (character === '`') {
      let end = index; while (line[end] === '`') end++;
      const count = end - index;
      if (!fence && (runs.get(count) ?? -1) >= end) fence = count;
      else if (fence === count) fence = 0;
      cell += line.slice(index, end); index = end - 1;
    } else if (character === '|' && !fence) { cells.push(cell.trim()); cell = ''; }
    else cell += character;
  }
  cells.push(cell.trim());
  if (line.startsWith('|')) cells.shift();
  if (cells.at(-1) === '' && line.endsWith('|')) cells.pop();
  return cells;
}

/** This bounded pipe-table reader skips individual malformed rows, not the whole register. */
export function parseRegister(text: string): HQRegisterResult {
  const collected: Record<HQTestSection,HQTestRow[]>={live:[],queue:[],history:[]};
  let section: HQTestSection | 'watches' | null=null, readable=false, skippedRows=0, cappedRows=0;
  const headings = new Set<string>(), skippedCells = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line=raw.trim();
    const heading=/^##[ \t]+(.+?)\s*$/.exec(line);
    if (heading) {
      const name=heading[1]!.toLowerCase();
      section=name==='live'?'live':name==='queue'?'queue':name==='history'?'history':/^watches(?:\s|$)/.test(name)?'watches':null;
      if (section) { readable=true; headings.add(section); }
      continue;
    }
    if (!section || section==='watches' || !line.includes('|')) continue;
    const rawCells=tableCells(line);
    const cells=rawCells.map(cell=>hqCut(cell,HQ_CELL_LIMIT));
    if (cells.every(cell=>/^:?-{2,}:?$/.test(cell.replaceAll(' ',''))) || cells[0]?.toLowerCase()==='id') continue;
    if (cells.length!==widths[section] || !cells[0]) {skippedRows++;if (cells[0]) skippedCells.add(cells[0]);continue;}
    if (collected[section].length>=HQ_SECTION_ROW_LIMIT) {cappedRows++;skippedCells.add(cells[0]);continue;}
    // A cut Status could otherwise lose a later qualification such as "capped at Leaning".
    if (section==='live' && Array.from(rawCells[8]!).length>HQ_CELL_LIMIT)
      cells[8]=hqCut(rawCells[8]!,HQ_CELL_LIMIT-HQ_TRUNCATED_STATUS_MARKER.length)+HQ_TRUNCATED_STATUS_MARKER;
    const id=cells[0].split(/\s+/)[0]!;
    collected[section].push({id,section,cells});
  }
  const rows: HQTestRow[]=[], seen=new Set<string>();
  for (const section of sections) for (const row of collected[section]) {
    if (seen.has(row.id)) {skippedRows++;skippedCells.add(row.cells[0]!);continue;}
    seen.add(row.id);rows.push(row);
  }
  return {readable,rows,skippedRows,cappedRows,complete:headings.size===4,skippedCells:[...skippedCells]};
}
