import type { CreativeData, MediaGroup } from './model.js';
import { attributesForKind, resolveAttributes, type AttributeDefinition, type AttributeRow } from './attributes.js';
import { aggregateCreativeGroups } from './ranking.js';
import type { GroupPerformance } from './presentation-types.js';

export interface TaggingQueueEntry { groupId: string; title: string; picture: string; unsure: boolean }

export function creativeAttributeOptions(kind: MediaGroup['kind'] | 'all' = 'all'): AttributeDefinition[] {
  const combined = new Map<string, AttributeDefinition>();
  for (const type of kind === 'all' ? ['video', 'image'] as const : [kind]) {
    for (const attribute of attributesForKind(type)) {
      const previous = combined.get(attribute.key);
      combined.set(attribute.key, previous ? { ...previous, values: [
        ...previous.values, ...attribute.values.filter(value => !previous.values.some(option => option.value === value.value)),
      ] } : attribute);
    }
  }
  return [...combined.values()];
}

export function creativeTaggingQueue(data: CreativeData, rows: readonly AttributeRow[], floor: number, today: string): TaggingQueueEntry[] {
  return aggregateCreativeGroups(data, { to: today }).filter(group => group.totals.spend > floor
    && !rows.some(row => row.groupId === group.group.id && row.source === 'will')).map(group => ({
      group, unsure: resolveAttributes(group.group.kind, rows.filter(row => row.groupId === group.group.id)).some(attribute => attribute.unsure),
    })).sort((a, b) => Number(b.unsure) - Number(a.unsure)
      || b.group.group.firstSeen.localeCompare(a.group.group.firstSeen) || a.group.group.id.localeCompare(b.group.group.id))
    .map(({ group, unsure }) => ({ groupId: group.group.id, title: group.group.title, picture: group.group.thumbnailUrl, unsure }));
}

export function filterCreativeAttributes(groups: GroupPerformance[], rows: readonly AttributeRow[], key?: string, value?: string): GroupPerformance[] {
  if (!key || !value) return groups;
  return groups.filter(group => resolveAttributes(group.group.kind, rows.filter(row => row.groupId === group.group.id))
    .some(attribute => attribute.key === key && attribute.value === value));
}
