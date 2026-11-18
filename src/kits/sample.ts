import {addDays, ukToday} from '../hero-range.js';
import {parseKits, parseKitOrders, type KitFacts} from './model.js';

/** Six invented kits, dated from the same sample clock as their Home display. */
export function sampleKitFacts(now: Date): KitFacts {
  const today = ukToday(now), readAt = now.toISOString();
  const kits = parseKits(JSON.stringify({updated: readAt, rows: [
    {id: 'box-a', name: 'Box A', series: 'The first collection', status: 'live', gate: 5,
      launch_target: addDays(today, -21), launch_label: 'Now available', next_action: 'Review the first month', owner: 'Will'},
    {id: 'box-b', name: 'Box B', series: 'The second collection', status: 'in flight', gate: 2,
      launch_target: addDays(today, 84), launch_label: 'Spring launch', brief_due: addDays(today, 7), milestone: 'Compliance check',
      next_action: 'Approve the printed sample', owner: 'the kit maker', with: 'the kit maker', waiting_since: addDays(today, -6),
      note: 'An invented sample kit. The full print proof is the next checkpoint.'},
    {id: 'box-c', name: 'Box C', series: 'A new collection', status: 'in flight', gate: 1,
      launch_target: addDays(today, 112), milestone: 'Choose the design', next_action: 'Choose the artwork for the next proof', owner: 'Will'},
    {id: 'box-d', name: 'Box D', series: 'A later collection', status: 'planned', gate: 0,
      launch_target: addDays(today, 168), next_action: 'Write the first brief', owner: 'Will'},
    {id: 'box-e', name: 'Box E', series: 'A possible collection', status: 'proposed', gate: 0,
      launch_target: addDays(today, 224), next_action: 'Consider the theme', owner: 'Will'},
    {id: 'box-f', name: 'Box F', series: 'An optional collection', status: 'optional', gate: 0,
      launch_target: null, next_action: 'Keep the idea on file', owner: 'Will'},
  ]}));
  const orders = parseKitOrders(JSON.stringify({updated: readAt, rows: Array.from({length: 8}, (_, index) => ({
    id: `order-${index + 1}`, kit: index < 5 ? 'Box B' : index === 5 ? 'Box A' : 'Box C', supplier: 'a supplier',
    item: ['Printed sample', 'Inner trays', 'Outer cartons', 'Label sheets', 'Packing sleeves', 'Refill packs', 'Design proofs', 'Sample inserts'][index],
    qty: [4, 2400, 1200, 6000, 2400, 300, 3, 12][index], date: addDays(today, -12 + index),
    eta: addDays(today, 5 + index * 2), status: index < 2 ? 'In production' : 'Awaiting confirmation',
  }))}));
  return {mode: 'sample', kits: {...kits, status: 'ready', readAt}, orders: {...orders, status: 'ready', readAt}};
}
