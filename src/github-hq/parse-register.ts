import { HQ_CELL_LIMIT, HQ_SECTION_ROW_LIMIT, HQ_TRUNCATED_STATUS_MARKER, hqCut, type HQRegisterResult, type HQTestRow, type HQTestSection } from './model.js';

const widths: Record<HQTestSection,number>={live:9,queue:7,history:5};
const sections=['live','queue','history'] as const;

/** This bounded pipe-table reader skips individual malformed rows, not the whole register. */
export function parseRegister(text: string): HQRegisterResult {
  const collected: Record<HQTestSection,HQTestRow[]>={live:[],queue:[],history:[]};
  let section: HQTestSection | 'watches' | null=null, readable=false, skippedRows=0;
  for (const raw of text.split(/\r?\n/)) {
    const line=raw.trim();
    const heading=/^##[ \t]+(.+?)\s*$/.exec(line);
    if (heading) {
      const name=heading[1]!.toLowerCase();
      section=name==='live'?'live':name==='queue'?'queue':name==='history'?'history':/^watches(?:\s|$)/.test(name)?'watches':null;
      if (section) readable=true;
      continue;
    }
    if (!section || section==='watches' || !line.includes('|')) continue;
    const rawCells=line.replace(/^\|/,'').replace(/\|$/,'').split('|').map(cell=>cell.trim());
    const cells=rawCells.map(cell=>hqCut(cell,HQ_CELL_LIMIT));
    if (cells.every(cell=>/^:?-{2,}:?$/.test(cell.replaceAll(' ',''))) || cells[0]?.toLowerCase()==='id') continue;
    if (cells.length!==widths[section] || !cells[0] || collected[section].length>=HQ_SECTION_ROW_LIMIT) {skippedRows++;continue;}
    // A cut Status could otherwise lose a later qualification such as "capped at Leaning".
    if (section==='live' && Array.from(rawCells[8]!).length>HQ_CELL_LIMIT)
      cells[8]=hqCut(rawCells[8]!,HQ_CELL_LIMIT-HQ_TRUNCATED_STATUS_MARKER.length)+HQ_TRUNCATED_STATUS_MARKER;
    const id=cells[0].split(/\s+/)[0]!;
    collected[section].push({id,section,cells});
  }
  const rows: HQTestRow[]=[], seen=new Set<string>();
  for (const section of sections) for (const row of collected[section]) {
    if (seen.has(row.id)) {skippedRows++;continue;}
    seen.add(row.id);rows.push(row);
  }
  return {readable,rows,skippedRows};
}
