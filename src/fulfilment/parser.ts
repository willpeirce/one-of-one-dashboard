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
function records(text: string): string[][] {
  let allowed: Set<number> | null = null;
  const result: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i] ?? '\n';
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { if (!allowed || allowed.has(row.length)) cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else if (i === text.length) throw new ImportError();
      else if (!allowed || allowed.has(row.length)) cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (c !== ',') {
        if (row.some(v => v !== '')) { result.push(row); if (!allowed) allowed = new Set(row.flatMap((name,i) => columns.some(c => c === name) ? [i] : [])); }
        row = []; if (c === '\r' && text[i+1] === '\n') i++;
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (closed && c.trim()) throw new ImportError();
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
  const rows = records(csv.replace(/^\uFEFF/, '').replace(/^\s*\uFEFF/,''));
  const header = rows.shift();
  if (!header || columns.some(c => header.filter(h => h === c).length !== 1)) throw new ImportError('The ten ExportOrders columns are required.');
  if (!rows.length || rows.length > 10_000) throw new ImportError('Choose an export with 1–10,000 parcel rows.');
  const indices = columns.map(c => header.indexOf(c));
  return rows.map(row => {
    if (row.length !== header.length) throw new ImportError();
    const [despatchedAt, orderNumber, weight, service, postage, total, centre, carrier, country, paid] = indices.map(i => row[i]!) as [string,string,string,string,string,string,string,string,string,string];
    if (!/^\d{1,20}$/.test(orderNumber) || !/^20\d{2}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d$/.test(despatchedAt)) throw new ImportError();
    const date = new Date(despatchedAt.replace(' ','T') + 'Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,19).replace('T',' ') !== despatchedAt) throw new ImportError();
    const w = /^(\d+(?:\.\d{1,3})?)\s*(kg|g)$/.exec(weight);
    if (!w) throw new ImportError();
    const boxedGrams = Math.round(Number(w[1]) * (w[2] === 'kg' ? 1000 : 1));
    if (boxedGrams > 1_000_000) throw new ImportError();
    const postageMinor = decimal(postage,2), totalFour = decimal(total,4);
    if (totalFour < postageMinor * 100) throw new ImportError('Line Total must cover Postage Charge.');
    const warehouse: Warehouse = centre === 'Northampton 2' ? 'uk' : centre === 'Columbus' ? 'us' : 'unknown';
    return { orderNumber: orderNumber.replace(/^0+(?=\d)/,''), despatchedAt, warehouse, centre: label(centre), service: label(service), carrier: label(carrier), country: label(country), boxedGrams,
      currency: warehouse === 'uk' ? 'GBP' : warehouse === 'us' ? 'USD' : null,
      postageMinor, pickPackMinor: Math.round((totalFour - postageMinor * 100)/100), customerPaidPence: decimal(paid,2) };
  });
}
