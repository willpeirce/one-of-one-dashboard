import {WAITING_CONTACT_LIMIT, WAITING_SUBJECT_LIMIT, WAITING_FILE_ROW_LIMIT, validWaitingDate, waitingTextSafe} from '../waiting-on/model.js';

export interface HQWaitingRow {contact: string; subject: string; since: string}
export interface HQWaitingResult {
  readable: boolean;
  /** Source wall-clock label, deliberately not an invented UTC instant. */
  updatedLabel: string | null;
  rows: HQWaitingRow[];
  skippedRows: number;
  cappedRows: number;
}

/** Independent of the test-register parser, including when its carry fixes are reverted. */
function cells(line: string): string[] {
  const result: string[] = [], finalFence = new Map<number, number>();
  for (const match of line.matchAll(/`+/g)) finalFence.set(match[0].length, match.index);
  let cell = '', fence = 0;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '\\' && !fence && index + 1 < line.length) {
      const next = line[++index]!;
      cell += next === '|' ? next : `\\${next}`;
    } else if (character === '`') {
      let end = index; while (line[end] === '`') end++;
      const width = end - index;
      if (!fence && (finalFence.get(width) ?? -1) >= end) fence = width;
      else if (fence === width) fence = 0;
      cell += line.slice(index, end); index = end - 1;
    } else if (character === '|' && !fence) {result.push(cell.trim()); cell = '';}
    else cell += character;
  }
  result.push(cell.trim());
  if (line.startsWith('|')) result.shift();
  if (line.endsWith('|') && result.at(-1) === '') result.pop();
  return result;
}
const columns = (values: string[]) => values.length === 3 && values.every((value, index) => value.toLowerCase() === ['contact', 'subject', 'since'][index]);
const unreadable = (): HQWaitingResult => ({readable: false, updatedLabel: null, rows: [], skippedRows: 0, cappedRows: 0});

/** One explicitly dated table; malformed rows are counted without retaining their private contents. */
export function parseWaiting(text: string): HQWaitingResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim());
  let cursor = 0;
  const next = () => {while (cursor < lines.length && !lines[cursor]) cursor++; return lines[cursor++] ?? '';};
  if (!/^#{1,6}[ \t]+\S/.test(next())) return unreadable();
  const stamp = /^Updated:[ \t]+(\d{4}-\d{2}-\d{2})[ \t]+((?:[01]\d|2[0-3]):[0-5]\d)[ \t]+UK$/.exec(next());
  if (!stamp || !validWaitingDate(stamp[1])) return unreadable();
  if (!columns(cells(next()))) return unreadable();
  const separator = cells(next());
  if (separator.length !== 3 || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) return unreadable();
  const result: HQWaitingResult = {readable: true, updatedLabel: `${stamp[1]} ${stamp[2]} UK`, rows: [], skippedRows: 0, cappedRows: 0};
  const seen = new Set<string>();
  let ended = false;
  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor]!;
    if (!line) {ended = true; continue;}
    // A second table or body section is a format change, not evidence that old items disappeared.
    if (ended || /^#{1,6}[ \t]+/.test(line) || /^Updated:/.test(line)) return unreadable();
    const values = cells(line);
    if (columns(values)) return unreadable();
    const [contact = '', subject = '', since = ''] = values;
    if (values.length !== 3 || !contact || !subject || !validWaitingDate(since)
      || Array.from(contact).length > WAITING_CONTACT_LIMIT || Array.from(subject).length > WAITING_SUBJECT_LIMIT
      || !waitingTextSafe(contact) || !waitingTextSafe(subject)) {result.skippedRows++; continue;}
    const key = JSON.stringify([contact, subject, since]);
    if (seen.has(key)) {result.skippedRows++; continue;}
    seen.add(key);
    if (result.rows.length >= WAITING_FILE_ROW_LIMIT) {result.cappedRows++; continue;}
    result.rows.push({contact, subject, since});
  }
  return result;
}
