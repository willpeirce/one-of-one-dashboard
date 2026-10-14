import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDatabase } from './helpers/database.js';
import { readAttributeRows, readGroupAttributes, readWillNote, recomputeMetaAttributes, replaceSourceAttributes, saveWillNote, toggleWillAttribute } from '../src/creatives/attribute-store.js';
import { saveCatalogue } from '../src/creatives/store.js';
import type { CatalogueEntry } from '../src/creatives/model.js';

const account = 'invented-attribute-account';
const now = new Date('2026-10-14T12:00:00Z');
function entry(id: string, createdAt = '2026-10-10T10:00:00Z', body = 'Invented plain craft copy.'): CatalogueEntry {
  return { ad: { id: `invented-ad-${id}`, accountId: account, name: `Invented ${id} ad`, status: 'ACTIVE', effectiveStatus: 'ACTIVE',
    createdAt, adSetId: 'invented-attribute-set', adSetName: 'Invented UK set', campaignId: 'invented-attribute-campaign',
    campaignName: 'Invented campaign', owner: 'ours', market: 'uk', creativeId: `invented-creative-${id}`, creativeType: 'video',
    body, title: 'Invented craft kit', callToAction: 'SHOP_NOW', linkUrl: null, utmContent: null, lastSeen: now.toISOString(),
    facebookUrl: null, instagramUrl: null, objectStoryId: null, instagramMediaId: null },
  media: { id, kind: 'video', key: `invented-key-${id}`, title: 'Invented craft clip', lengthSeconds: 18, width: 600, height: 800,
    firstSeen: createdAt, alternates: [], thumbnail: new Uint8Array([1, 2, 3]), poster: null, frames: [] } };
}

test('attributes persist on scoped parents; newest merged ad supplies facts and Will survives model/Meta replacement', async () => {
  const db = await createTestDatabase();
  try {
    await saveCatalogue(db, account, [entry('invented-attribute-parent'), entry('invented-attribute-child', '2026-10-12T10:00:00Z', 'Invented price £8. Free stencils and markers.')], now);
    await saveCatalogue(db, account, [entry('invented-sample-attribute-parent')], now, 'sample');
    await recomputeMetaAttributes(db, 'live', account, now);
    let attributes = await readGroupAttributes(db, 'live', account, 'invented-attribute-child');
    assert.equal(attributes.find(attribute => attribute.key === 'copyPrice')!.value, 'yes');
    assert.equal(attributes.find(attribute => attribute.key === 'copyOffer')!.value, 'yes');
    assert.equal(attributes.find(attribute => attribute.key === 'copyStencils')!.value, 'yes');
    assert.equal(attributes.find(attribute => attribute.key === 'copyMarkers')!.value, 'yes');
    const first = await replaceSourceAttributes(db, 'live', account, 'invented-attribute-child', 'model', {
      hookType: { value: 'reveal', confidence: 0.4, reason: 'Invented uncertain picture.' },
      unknown: { value: 'outside-schema', confidence: 1 },
    }, now);
    assert.deepEqual(first, { kept: 1, dropped: 1 });
    attributes = await readGroupAttributes(db, 'live', account, 'invented-attribute-parent');
    assert.equal(attributes.find(attribute => attribute.key === 'hookType')!.unsure, true);
    assert.equal((await toggleWillAttribute(db, 'live', account, 'invented-attribute-child', 'hookType', 'unboxing', now)).source, 'will');
    await replaceSourceAttributes(db, 'live', account, 'invented-attribute-parent', 'model', { hookType: { value: 'reaction', confidence: 0.9 } }, now);
    await recomputeMetaAttributes(db, 'live', account, now);
    assert.equal((await readGroupAttributes(db, 'live', account, 'invented-attribute-child')).find(attribute => attribute.key === 'hookType')!.value, 'unboxing');
    const cleared = await toggleWillAttribute(db, 'live', account, 'invented-attribute-child', 'hookType', 'unboxing', now);
    assert.equal(cleared.value, 'reaction');
    assert.equal(cleared.source, 'model');
    assert.equal(cleared.willValue, null);
    const childRows = (await db.query('SELECT id FROM pulse.media_attributes WHERE media_group_id=$1', ['invented-attribute-child'])).rowCount;
    assert.equal(childRows, 0, 'merged children always use parent tags');

    await toggleWillAttribute(db, 'live', account, 'invented-attribute-parent', 'copyPrice', 'no', now);
    await recomputeMetaAttributes(db, 'live', account, now);
    assert.equal((await readGroupAttributes(db, 'live', account, 'invented-attribute-parent')).find(attribute => attribute.key === 'copyPrice')!.value, 'no');
    assert.equal([...await saveWillNote(db, 'live', account, 'invented-attribute-child', '🟣'.repeat(201), now)].length, 200);
    assert.equal([...await readWillNote(db, 'live', account, 'invented-attribute-parent')].length, 200);

    const liveBefore = await readAttributeRows(db, 'live', account);
    await toggleWillAttribute(db, 'sample', account, 'invented-sample-attribute-parent', 'hookType', 'question', now);
    assert.deepEqual(await readAttributeRows(db, 'live', account), liveBefore, 'sample saves leave live rows untouched');
    await assert.rejects(toggleWillAttribute(db, 'sample', account, 'invented-attribute-parent', 'hookType', 'claim', now));
    await assert.rejects(toggleWillAttribute(db, 'live', 'invented-other-account', 'invented-attribute-parent', 'hookType', 'claim', now));
    await assert.rejects(toggleWillAttribute(db, 'live', account, 'invented-attribute-parent', 'hookType', 'outside-schema', now));
    await db.query(`INSERT INTO pulse.media_attributes(id,mode,account_id,media_group_id,attribute_key,value,source,recorded_at)
      VALUES('invented-invalid-attribute','live',$1,'invented-attribute-parent','setting',$2,'will',$3)`, [account, JSON.stringify({ value: 'outside-schema' }), now]);
    assert.equal((await readAttributeRows(db, 'live', account)).some(attribute => attribute.key === 'setting'), false);
  } finally { await db.close(); }
});
