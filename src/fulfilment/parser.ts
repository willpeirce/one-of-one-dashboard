export const columns = ['Despatched','Reference','Boxed Weight','Postage Method','Postage Charge','Line Total','Fulfilment Centre','Carrier','Country','Customer Postage Cost'] as const;
export type Warehouse = 'uk' | 'us' | 'unknown';
export interface ParcelRow {
  orderNumber: string; despatchedAt: string; warehouse: Warehouse; centre: string;
  service: string; carrier: string; country: string; boxedGrams: number;
  currency: 'GBP' | 'USD' | null; postageMinor: number; pickPackMinor: number; customerPaidPence: number;
}
export class ImportError extends Error {
  readonly statusCode = 400;
  constructor(message = 'Check the ExportOrders CSV format.') { super(message); }
}
// Discard unrecognised column cells during scanning, before projecting any parcel.
function records(text: string): {cells:string[];line:number}[] {
  let allowed: Set<number> | null = null;
  const result: {cells:string[];line:number}[] = []; let line=1, startLine=1; let row: string[] = [], cell = '', quoted = false, closed = false;
  const invalid = () => new ImportError(`Row ${startLine}, ${result[0]?.cells[row.length] && columns.includes(result[0].cells[row.length] as typeof columns[number]) ? result[0].cells[row.length] : 'column '+(row.length+1)}: invalid CSV quoting.`);
  for (let i = 0; i <= text.length; i++) {
    const c = text[i] ?? '\n';
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { if (!allowed || allowed.has(row.length)) cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else if (i === text.length) throw invalid();
      else { if (c === '\n' || (c === '\r' && text[i+1] !== '\n')) line++; if (!allowed || allowed.has(row.length)) cell += c; }
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (c !== ',') {
        if (row.some(v => v !== '')) { result.push({cells:row,line:startLine}); if (!allowed) allowed = new Set(row.flatMap((name,i) => columns.some(c => c === name) ? [i] : [])); }
        row = []; if (c === '\r' && text[i+1] === '\n') i++; line++; startLine=line;
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (closed && c.trim()) throw invalid();
    else if (!allowed || allowed.has(row.length)) cell += c;
  }
  return result;
}
function decimal(text: string, dp: number): number {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${dp}})?$`).test(text)) throw new ImportError();
  const [whole, fraction = ''] = text.split('.');
  const value = Number(whole) * 10 ** dp + Number(fraction.padEnd(dp,'0'));
  if (!Number.isSafeInteger(value) || value > 1e10) throw new ImportError();
  return value;
}
function label(value: string): string {
  if (!value || value.length > 100 || !/^[\p{L}\p{N} .&()+/_-]+$/u.test(value)) throw new ImportError();
  return value;
}
export function parseExport(csv: string): ParcelRow[] {
  if (typeof csv !== 'string' || csv.length > 2_000_000) throw new ImportError('Choose a CSV smaller than 2 MB.');
  const rows = records(csv.replace(/^(\s*)\uFEFF/,'$1'));
  const header = rows.shift()?.cells;
  if (!header || columns.some(c => header.filter(h => h === c).length !== 1)) throw new ImportError('The ten ExportOrders columns are required.');
  if (!rows.length || rows.length > 10_000) throw new ImportError('Choose an export with 1–10,000 parcel rows.');
  return rows.map(({cells:row,line}) => {
    const invalid = (column:string, reason='invalid format') => new ImportError(`Row ${line}, ${column}: ${reason}.`);
    if (row.length !== header.length) throw invalid('columns', 'expected the same number of columns as the header');
    const value = (column:typeof columns[number]) => row[header.indexOf(column)]!;
    const checked = <T>(column:typeof columns[number], parse:(text:string)=>T):T => {
      try { return parse(value(column)); } catch (error) { if (error instanceof ImportError) throw invalid(column); throw error; }
    };
    const orderNumber=checked('Reference',text=>{if (!/^\d{1,20}$/.test(text)) throw new ImportError(); return text.replace(/^0+(?=\d)/,'');});
    const despatchedAt=checked('Despatched',text=>{
      if (!/^20\d{2}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d$/.test(text)) throw new ImportError();
      const date=new Date(text.replace(' ','T')+'Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,19).replace('T',' ') !== text) throw new ImportError();
      return text;
    });
    const boxedGrams=checked('Boxed Weight',text=>{
      const w=/^(\d+(?:\.\d{1,3})?)\s*(kg|g)$/.exec(text);
      if (!w) throw new ImportError();
      const grams=Math.round(Number(w[1])*(w[2]==='kg'?1000:1));
      if (grams>1_000_000) throw new ImportError(); return grams;
    });
    const postageMinor=checked('Postage Charge',text=>decimal(text,2)), totalFour=checked('Line Total',text=>decimal(text,4));
    if (totalFour<postageMinor*100) throw invalid('Line Total','must cover Postage Charge');
    const centre=checked('Fulfilment Centre',label), service=checked('Postage Method',label), carrier=checked('Carrier',label), country=checked('Country',label);
    const warehouse: Warehouse=centre==='Northampton 2'?'uk':centre==='Columbus'?'us':'unknown';
    return {orderNumber,despatchedAt,warehouse,centre,service,carrier,country,boxedGrams,
      currency:warehouse==='uk'?'GBP':warehouse==='us'?'USD':null,
      postageMinor,pickPackMinor:Math.round((totalFour-postageMinor*100)/100),customerPaidPence:checked('Customer Postage Cost',text=>decimal(text,2))};
  });
}
