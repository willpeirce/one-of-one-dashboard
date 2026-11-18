import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import type { GorgiasFacts } from '../src/gorgias/model.js';
import { gorgiasSectionHtml } from '../src/handover/gorgias-view.js';
import { handoverPage } from '../src/handover/view.js';
import { assertHandoverLayout } from './browser-handover-base.js';

export async function checkHandoverGorgias(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({width, height: 900});
      await page.goto('/handover');
      await page.getByRole('heading', {name: 'Customer service', exact: true}).waitFor();
      assert.equal(await page.locator('[data-handover-section]').first().getAttribute('data-handover-section'), 'customer-service');
      assert.match(await page.locator('[data-gorgias-mode="sample"]').innerText(), /Sample data.*invented/);
      const rows = page.locator('[data-gorgias-ticket]');
      assert.equal(await rows.count(), 4);
      const starts = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-wait-start')));
      assert.deepEqual(starts, [...starts].sort(), 'Oldest customer wait is first');
      const boxes = await rows.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect(); return {x: box.x, y: box.y, bottom: box.bottom, width: box.width};
      }));
      for (let index = 1; index < boxes.length; index++) {
        assert.equal(boxes[index]!.x, boxes[0]!.x, 'Ticket cards share one full-width column');
        assert.ok(boxes[index]!.y >= boxes[index - 1]!.bottom, 'One card follows the next without overlap');
      }
      await rows.first().locator('summary').click();
      assert.match(await rows.first().locator('.handover-detail').innerText(), /Waiting since.*UK/);
      assert.equal(await rows.first().getByRole('button', {name: 'Sample ticket', exact: true}).isDisabled(), true);
      assert.equal(await page.locator('[data-gorgias-ticket] a[href^="https:"]').count(), 0);
      await assertHandoverLayout(page, width);
      assert.match(await page.locator('[data-gorgias-summary]').innerText(), /Opened this week.*Closed this week.*Oldest wait/s);
      const closed = page.locator('[data-gorgias-summary] dt:text-is("Closed this week") + dd');
      assert.match(await closed.innerText(), /^At least \d+$/);
      assert.match((await closed.getAttribute('title'))!, /Observed minimum.*reopened or deleted.*closure history is not retained/);
    }
    const fixture: GorgiasFacts = {mode: 'live', status: 'live', domain: 'invented-helpdesk', checkedAt: '2032-04-07T12:00:00.000Z',
      asOf: '2032-04-07T12:00:00.000Z', weekStart: '2032-04-04T23:00:00.000Z', openedThisWeek: 5, closedThisWeek: 2,
      tickets: [{id: '53001', status: 'open', channel: 'chat', tags: ['ai_handover'], inHandover: true, viewId: null,
        customer: 'Mira P.', subject: 'An invented missing item', createdAt: '2032-04-06T08:00:00.000Z',
        updatedAt: '2032-04-07T09:00:00.000Z', lastCustomerMessageAt: '2032-04-06T10:00:00.000Z'}]};
    await page.route('**/handover', route => route.fulfill({contentType: 'text/html', body: handoverPage([
      {id: 'customer-service', title: 'Customer service', html: gorgiasSectionHtml(fixture), available: true},
    ])}));
    await page.setViewportSize({width: 390, height: 900}); await page.goto('/handover');
    assert.equal(await page.locator('[data-gorgias-mode="sample"]').count(), 0);
    await page.locator('[data-gorgias-ticket] > summary').click();
    const link = page.getByRole('link', {name: 'Open in Gorgias'});
    assert.equal(await link.getAttribute('href'), 'https://invented-helpdesk.gorgias.com/app/ticket/53001');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.match(await page.locator('.handover-state').innerText(), /◆ Reply/);
    assert.equal(await page.locator('[data-gorgias-summary] dt:text-is("Closed this week") + dd').innerText(), 'At least 2');
    assert.equal(await page.locator('.handover-person').innerText(), 'Mira P.');
    await assertHandoverLayout(page, 390);
  } finally {await page.close();}
}
