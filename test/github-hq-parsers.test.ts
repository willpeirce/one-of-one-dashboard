import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseMonth } from '../src/github-hq/parse-month.js';
import { parseRegister } from '../src/github-hq/parse-register.js';
import { readTest, strictReading } from '../src/github-hq/reading.js';
import { HQ_CELL_LIMIT, HQ_ITEM_LIMIT, HQ_ITEM_LINES_LIMIT, HQ_ITEM_TEXT_LIMIT, HQ_SECTION_ROW_LIMIT, HQ_TRUNCATED_STATUS_MARKER } from '../src/github-hq/model.js';

const fixture=(name:string)=>readFile(new URL(`fixtures/github-hq/${name}`,import.meta.url),'utf8');
const heading='## 2032-04-20 (Tue), run 21 Apr 07:41';
const register=(section:string,rows:string[])=>`## ${section}\n${rows.join('\n')}`;
const liveRow=(id:string,status='No reading yet')=>`| ${id} Invented row | Site | Invented question | A: one; B: two | Invented bar | 2032-04-10 | Waiting | Invented report | ${status} |`;

test('month parser keeps the last run for each report day, follows same-day pointers, and stores only bounded item content',async()=>{
  const parsed=parseMonth(await fixture('2032-04.md'));
  assert.equal(parsed.length,5);
  const current=parsed.find(row=>row.day==='2032-04-20')!;
  assert.equal(current.runLabel,'re-run 21 Apr 08:10');assert.equal(current.status,'needs');assert.equal(current.count,2);
  assert.deepEqual(current.items,[{text:'Follow up: sample stock window.',label:'Follow up',lines:['Indented invented stock window detail.']},
    {text:'2. Review the sample label: confirm its artwork.',lines:['Another invented artwork detail.']}]);
  assert.deepEqual(current.firstLines,[]);
  const stored=JSON.stringify(parsed);
  for (const excluded of ['DO_NOT_STORE','continuation','deliberately long invented status'])
    assert.ok(!stored.includes(excluded),`discard ${excluded}`);
  const okay=parsed.find(row=>row.day==='2032-04-16')!;
  assert.equal(okay.status,'ok');assert.equal(okay.count,0);assert.deepEqual(okay.items,[]);
  const noItems=parsed.find(row=>row.day==='2032-04-17')!;
  assert.equal(noItems.status,'needs');assert.equal(noItems.count,1);assert.deepEqual(noItems.items,[]);
  const unreadable=parsed.find(row=>row.day==='2032-04-18')!;
  assert.equal(unreadable.status,'unreadable');
  assert.deepEqual(unreadable.firstLines,['## 2032-04-18 (Sun), run 19 Apr 07:43','Invented first line.','Unrecognized status words.']);
});

test('month absence is distinct from an unreadable entry and pointers use only the latest earlier matching time on the same day',()=>{
  assert.deepEqual(parseMonth('# Invented empty month\nNo entries.'),[]);
  assert.deepEqual(parseMonth('## 2032-02-30 (Mon), run 1 Mar 07:41\n**Needs Will:** nothing'),[]);
  for (const status of ['','**Needs Will:** unclear','**Needs Will:** 2.5 items','**Needs Will:** same 1 item as the 09:00 entry above']) {
    const entry=parseMonth(`${heading}\n${status}`)[0]!;
    assert.equal(entry.status,'unreadable');assert.equal(entry.count,0);assert.deepEqual(entry.items,[]);
  }
  const repeated=`${heading}\n**Needs Will:** 1 item\n1. **Check: first invented answer.**\n\n${heading}\n**Needs Will:** 1 item\n1. **Check: latest invented answer.**\n\n## 2032-04-20 (Tue), re-run 21 Apr 08:10\n**Needs Will:** same 1 item as the 07:41 entry above`;
  assert.equal(parseMonth(repeated)[0]!.items[0]!.text,'Check: latest invented answer.');
  const otherDay=`${heading}\n**Needs Will:** 1 item\n1. **Check: invented answer.**\n\n## 2032-04-21 (Wed), run 22 Apr 08:10\n**Needs Will:** same 1 item as the 07:41 entry above`;
  assert.equal(parseMonth(otherDay)[1]!.status,'unreadable');
  const brokenLatest=`${heading}\n**Needs Will:** nothing\n\n${heading}\nMissing status\n\n## 2032-04-20 (Tue), re-run 21 Apr 08:10\n**Needs Will:** same 1 item as the 07:41 entry above`;
  assert.equal(parseMonth(brokenLatest)[0]!.status,'unreadable');
});

test('month items stop at blank or other unindented lines, retain indented detail, and cap text by code point',()=>{
  const words='𐐀'.repeat(350);
  const text=`${heading}\nInvented context\nAnother context\n**Needs Will:** 99 items. Ignore the rest.\n${Array.from({length:15},(_,i)=>`${i+1}. **Check: ${words}** More text.\n   ignored detail`).join('\n')}\n\n16. Ignored after blank`;
  const entry=parseMonth(text)[0]!;
  assert.equal(entry.count,99);assert.equal(entry.items.length,HQ_ITEM_LIMIT);
  for (const item of entry.items) assert.equal(Array.from(item.text).length,HQ_ITEM_TEXT_LIMIT);
  assert.ok(!entry.items[0]!.text.endsWith('\uD801'),'a character is not split');
  const stopped=parseMonth(`${heading}\n**Needs Will:** 4 items\n1. Bare invented row\n  ignored\n### Google\n2. Not an item`)[0]!;
  assert.deepEqual(stopped.items,[{text:'1. Bare invented row',lines:['ignored']}]);
  const unknown=parseMonth(`${heading}\n${words}\n\0short\nnot stored`)[0]!;
  assert.equal(unknown.firstLines.length,3);assert.equal(Array.from(unknown.firstLines[1]!).length,HQ_ITEM_TEXT_LIMIT);
  assert.equal(unknown.firstLines[2],'\uFFFDshort');
});

test('month item lines flatten nesting and markup, keep only eight lines and cap by code point',()=>{
  const long='𐐀'.repeat(HQ_ITEM_TEXT_LIMIT+20);
  const details=['   - **Life** £80.00 / `2` = £40.00.', '      1. - Nested invented detail.',
    '      * [Invented source](https://example.test/check)', `   + ${long}`,
    ...Array.from({length:7},(_,index)=>`   - Invented detail ${index+1}.`)];
  const entry=parseMonth(`${heading}\n**Needs Will:** 1 item\n1. **Check: invented totals.**\n${details.join('\n')}`)[0]!;
  assert.equal(entry.items[0]!.lines!.length,HQ_ITEM_LINES_LIMIT);
  assert.deepEqual(entry.items[0]!.lines!.slice(0,3),['Life £80.00 / 2 = £40.00.','Nested invented detail.','Invented source']);
  assert.equal(Array.from(entry.items[0]!.lines![3]!).length,HQ_ITEM_TEXT_LIMIT);
  assert.ok(!entry.items[0]!.lines!.some(line=>line.includes('detail 7')));
  assert.equal(entry.malformedCardTags,0);
});

test('month card tags parse every exact terminal type with 5 to 25 digit ad-set IDs and stay out of lines',()=>{
  const tags=[['pause 12000',{type:'pause',adSetId:'12000'}],['hold 1200000000000000000000001',{type:'hold',adSetId:'1200000000000000000000001'}],
    ['freelancer',{type:'freelancer'}],['dated',{type:'dated'}],['info',{type:'info'}]] as const;
  for(const [text,tag] of tags){
    const entry=parseMonth(`${heading}\n**Needs Will:** 1 item\n1. **Check: invented tag.**\n   - Invented detail.\n   - Card: ${text}`)[0]!;
    assert.deepEqual(entry.items[0]!.tag,tag,text);assert.deepEqual(entry.items[0]!.lines,['Invented detail.']);
    assert.equal(entry.malformedCardTags,0);
  }
  const capped=parseMonth(`${heading}\n**Needs Will:** 1 item\n1. **Check: capped invented details.**\n${Array.from({length:12},(_,i)=>`   - Detail ${i}.`).join('\n')}\n   - Card: pause 120000000000000001`)[0]!;
  assert.equal(capped.items[0]!.lines!.length,8);assert.deepEqual(capped.items[0]!.tag,{type:'pause',adSetId:'120000000000000001'});
});

test('malformed, duplicate and nonterminal Card lines are dropped and diagnosed without failing the report',()=>{
  const bad=['pause','pause 1234','pause 12000000000000000000000001','hold abcde','dated 12000','info extra','other','Pause 12000'];
  for(const text of bad){
    const entry=parseMonth(`${heading}\n**Needs Will:** 1 item\n1. **Check: malformed invented tag.**\n   - Card: ${text}`)[0]!;
    assert.equal(entry.status,'needs');assert.equal(entry.malformedCardTags,1,text);
    assert.equal(entry.items[0]!.tag,undefined);assert.deepEqual(entry.items[0]!.lines,[]);
  }
  for(const [details,count] of [['   - Card: info\n   - More detail.',1],['   - Card: info\n   - Card: dated',2],['   Card: info',1],['   - card: info',1]] as const){
    const entry=parseMonth(`${heading}\n**Needs Will:** 1 item\n1. **Check: ambiguous invented tag.**\n${details}`)[0]!;
    assert.equal(entry.malformedCardTags,count);assert.equal(entry.items[0]!.tag,undefined);
    assert.ok(entry.items[0]!.lines!.every(line=>!/^card:/i.test(line)));
  }
  const overflow=parseMonth(`${heading}\n**Needs Will:** 13 items\n${Array.from({length:13},(_,i)=>`${i+1}. **Check: invented item ${i}.**\n   - Card: unknown`).join('\n')}`)[0]!;
  assert.equal(overflow.items.length,12);assert.equal(overflow.malformedCardTags,13,'diagnostics include items beyond the retained cap');
});

test('same-day pointers preserve lines, valid tags and malformed-tag diagnostics from their chosen entry',()=>{
  const entry=parseMonth(`${heading}\n**Needs Will:** 2 items\n1. **Check: invented hold.**\n   - Invented detail.\n   - Card: hold 12000\n2. **Check: invented note.**\n   - Card: broken\n\n## 2032-04-20 (Tue), re-run 21 Apr 08:10\n**Needs Will:** same 2 items as the 07:41 entry above`)[0]!;
  assert.equal(entry.runLabel,'re-run 21 Apr 08:10');assert.equal(entry.malformedCardTags,1);
  assert.deepEqual(entry.items[0]!.lines,['Invented detail.']);assert.deepEqual(entry.items[0]!.tag,{type:'hold',adSetId:'12000'});
});

test('month-turn fixtures keep the report day rather than the run day',async()=>{
  const previous=parseMonth(await fixture('2032-04.md')),next=parseMonth(await fixture('2032-05.md'));
  assert.equal(previous.at(-1)!.day,'2032-04-30');assert.match(previous.at(-1)!.runLabel,/1 May/);
  assert.equal(next[0]!.day,'2032-05-01');assert.equal(next[0]!.status,'ok');
});

test('register parser keeps section order and raw trimmed cells, ignores Watches, and skips an odd row',async()=>{
  const result=parseRegister(await fixture('register.md'));
  assert.equal(result.readable,true);assert.equal(result.skippedRows,1);
  assert.deepEqual(result.rows.map(row=>[row.id,row.section]),[['T1','live'],['T2','live'],['T3','live'],['Q1','queue'],['H1','history'],['H2','history']]);
  assert.equal(result.rows.find(row=>row.id==='T3')!.cells[2]!.length,HQ_CELL_LIMIT);
  assert.match(result.rows.find(row=>row.id==='T3')!.cells[7]!,/`report` with £123456\.78/);
  assert.equal(strictReading(result.rows[0]!.cells[8]!)?.ahead,'b');
  assert.equal(strictReading(result.rows[1]!.cells[8]!),null);
  assert.deepEqual(parseRegister('# Invented file\n## Rules\n- No table'),{readable:false,rows:[],skippedRows:0,cappedRows:0,complete:false,skippedCells:[]});
  assert.deepEqual(parseRegister('## Watches (kill rules, not tests)\n| malformed |'),{readable:true,rows:[],skippedRows:0,cappedRows:0,complete:false,skippedCells:[]});
});

test('register caps each section, deduplicates IDs with Live priority and removes unsupported NUL before JSONB',()=>{
  const rows=Array.from({length:HQ_SECTION_ROW_LIMIT+2},(_,i)=>liveRow(`T${i}`));
  const result=parseRegister(register('Live',rows));
  assert.equal(result.rows.length,HQ_SECTION_ROW_LIMIT);assert.equal(result.skippedRows,0);assert.equal(result.cappedRows,2);
  const duplicate=parseRegister(`## History\n| T1 Earlier copy | Invented question | Draw | Invented rule | Invented evidence |\n## Queue\n| T1 Queued copy | Site | Q | Arms | Bar | Plan | Need |\n${register('Live',[liveRow('T1'),liveRow('T1')])}`);
  assert.equal(duplicate.rows.length,1);assert.equal(duplicate.rows[0]!.section,'live');assert.equal(duplicate.skippedRows,3);
  const nul=parseRegister(register('Live',[liveRow('T8','Invented\0status')]));
  assert.equal(nul.rows[0]!.cells[8],'Invented\uFFFDstatus');
  const unicode=parseRegister(register('History',[`| H1 Sample | ${'𐐀'.repeat(700)} | Draw | Rule | Evidence |`]));
  assert.equal(Array.from(unicode.rows[0]!.cells[1]!).length,HQ_CELL_LIMIT);
});

test('truncating Status preserves an explicit marker and cannot lose a late Leaning cap to enable an A/B call',()=>{
  const reading='Reading 2032-04-20: A 12% n=40; B 17% n=43; ahead B; sure 96%; mornings 2';
  const raw=`${reading}. ${'Invented explanation. '.repeat(40)} CAPPED AT LEANING`;
  const parsed=parseRegister(register('Live',[liveRow('T1',raw)])).rows[0]!;
  assert.equal(Array.from(parsed.cells[8]!).length,HQ_CELL_LIMIT);
  assert.ok(parsed.cells[8]!.endsWith(HQ_TRUNCATED_STATUS_MARKER));
  assert.match(parsed.cells[8]!,/^Reading/);assert.equal(strictReading(parsed.cells[8]!),null);
  const stored={...parsed,firstSeenAt:'2032-04-10T10:00:00Z',sectionFirstSeenAt:'2032-04-10T10:00:00Z',initiallySeen:false};
  assert.equal(readTest(stored,new Date('2032-04-20T10:00:00Z')).answer,null);
  assert.equal(readTest(stored,new Date('2032-05-10T10:00:00Z')).answer,'draw');
});

test('register splits escaped pipes and matching backtick spans and reports malformed and overflow separately', () => {
  const valid = liveRow('T1').replace('Invented question', 'Invented \\| choice with `a|b` and ``a`|b``');
  const result = parseRegister(`## Watches (kill rules, not tests)\n## Queue\n## History\n## Live\n${valid}\n| malformed |\n${Array.from({length: 41}, (_, i) => liveRow(`T${i + 2}`)).join('\n')}`);
  assert.equal(result.complete, true); assert.equal(result.rows[0]!.cells[2], 'Invented | choice with `a|b` and ``a`|b``');
  assert.equal(result.rows.length, 40); assert.equal(result.skippedRows, 1); assert.equal(result.cappedRows, 2);
});


test('unmatched backtick runs are literal, while a matching run protects interior pipes', () => {
  const line = (question: string) => `| T1 Invented | Site | ${question} | A vs B | Bar | 2032-04-01 | Later | Source | Waiting |`;
  for (const question of ['Invented ` literal', 'Invented `` literal `', 'Invented `one | two` code', 'Invented ``one ` | two`` code']) {
    const result = parseRegister(`## Live\n${line(question)}`);
    assert.equal(result.rows.length, 1, question); assert.equal(result.skippedRows, 0, question);
    assert.equal(result.rows[0]!.cells[2], question);
  }
});
