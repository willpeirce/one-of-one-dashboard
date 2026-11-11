import { HQ_ITEM_LIMIT, HQ_ITEM_TEXT_LIMIT, hqCut, hqDate, type HQBriefEntry, type HQBriefItem } from './model.js';

const heading = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]+\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\),[ \t]+((?:re-run|run)[ \t]+\d{1,2}[ \t]+[A-Za-z]{3}[ \t]+(?:[01]\d|2[0-3]):[0-5]\d)[ \t]*$/;
const statusPrefix = '**Needs Will:**';

function item(line: string): HQBriefItem {
  const body = line.replace(/^\d+\. /,'');
  const bold = /^\*\*(.*?)\*\*/.exec(body);
  const text = hqCut((bold ? bold[1]! : line).trim(),HQ_ITEM_TEXT_LIMIT);
  const beforeColon = text.includes(':') ? text.slice(0,text.indexOf(':')).trim() : '';
  return {text,...(beforeColon && beforeColon.split(/\s+/).length <= 3 ? {label:beforeColon} : {})};
}

/** Keep only the final run for each report day, while resolving pointers against earlier runs. */
export function parseMonth(text: string): HQBriefEntry[] {
  const lines = text.replaceAll('\0','\uFFFD').split(/\r?\n/);
  const earlierRuns = new Map<string,HQBriefEntry>(), latest = new Map<string,HQBriefEntry>();
  for (let index=0;index<lines.length;index++) {
    const match = heading.exec(lines[index]!);
    if (!match || !hqDate(match[1]!)) continue;
    let end=index+1;
    while (end<lines.length && !/^##(?:[ \t]|$)/.test(lines[end]!)) end++;
    const body=lines.slice(index+1,end), day=match[1]!, runLabel=hqCut(match[2]!,HQ_ITEM_TEXT_LIMIT);
    const entry: HQBriefEntry={day,runLabel,status:'unreadable',count:0,items:[],
      firstLines:lines.slice(index,Math.min(index+3,end)).map(line=>hqCut(line,HQ_ITEM_TEXT_LIMIT))};
    const at=body.findIndex(line=>line.startsWith(statusPrefix));
    if (at>=0) {
      const status=body[at]!.slice(statusPrefix.length).trim();
      const clean=status.replace(/^["'“”‘’]+|["'“”‘’.]+$/g,'').trim();
      const same=/^same[ \t]+(\d+)[ \t]+items?[ \t]+as[ \t]+the[ \t]+((?:[01]\d|2[0-3]):[0-5]\d)[ \t]+entry[ \t]+above\b/i.exec(status);
      const count=/^(\d+)\b(?!\.\d)/.exec(status);
      if (/^nothing$/i.test(clean)) { entry.status='ok'; entry.firstLines=[]; }
      else if (same && Number.isSafeInteger(Number(same[1]))) {
        const previous=earlierRuns.get(`${day}|${same[2]}`);
        if (previous && previous.status!=='unreadable') {
          entry.status='needs';entry.count=Number(same[1]);
          entry.items=previous.items.map(value=>({...value}));entry.firstLines=[];
        }
      } else if (count && Number.isSafeInteger(Number(count[1]))) {
        entry.status='needs';entry.count=Number(count[1]);entry.firstLines=[];
        for (const line of body.slice(at+1)) {
          if (!line.trim()) break;
          if (/^[ \t]/.test(line)) continue;
          if (!/^\d+\. /.test(line)) break;
          if (entry.items.length<HQ_ITEM_LIMIT) entry.items.push(item(line));
        }
      }
    }
    earlierRuns.set(`${day}|${runLabel.slice(-5)}`,entry);latest.set(day,entry);index=end-1;
  }
  return [...latest.values()];
}
