import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPage } from '../src/dashboard-view.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { fulfilmentPage, type Summary } from '../src/fulfilment/view.js';
import { emptyModel } from '../src/fulfilment/model.js';

test('Home has four neutral chapter headings while the hero stays without a chapter', () => {
  const html = dashboardPage(getSampleDashboard()).split('<div id="dashboard-state"')[0]!;
  const chapters = [['table', '1', 'Decisions', 'On the table'], ['reviews', '2', 'Customers', 'New reviews'],
    ['tests', '3', 'Experiments', 'Tests'], ['dials', '4', 'By source', 'Dials']];
  for (const [id, number, category, title] of chapters) {
    const section = html.match(new RegExp(`<section class="([^"]*)" id="${id}"[^>]*>([\\s\\S]*?)<\\/section>`));
    assert.ok(section, `${id} section is present`);
    assert.ok(section[1]!.split(' ').includes('chapter'));
    assert.ok(!section[1]!.split(' ').includes('glass'));
    assert.match(section[2]!, new RegExp(`class="chapter-number" aria-hidden="true">${number}<`));
    assert.match(section[2]!, new RegExp(`class="chapter-eyebrow">${category}<`));
    assert.match(section[2]!, new RegExp(`class="chapter-title" id="${id}-title">[\\s\\S]*?${title}`));
  }
  assert.equal((html.match(/class="chapter-number"/g) ?? []).length, 4);
  const hero = html.match(/<section class="hero" id="hero">([\s\S]*?)<\/section>/)![1]!;
  assert.doesNotMatch(hero, /chapter-heading|chapter-number/);
});

test('Fulfilment has chapter five above its existing glass panels', () => {
  const summary: Summary = { mode: 'sample', averages: [], lastUpload: null, needs: [], unmatched: [], recent: [],
    model: emptyModel(), orderCount: 0 };
  const html = fulfilmentPage(summary, .75);
  assert.match(html, /<section class="chapter fulfilment-chapter" id="fulfilment" aria-labelledby="fulfilment-title">/);
  assert.match(html, /class="chapter-number" aria-hidden="true">5<\/span>/);
  assert.match(html, /class="chapter-eyebrow">Fulfilment<\/p>/);
  assert.match(html, /<h1 class="chapter-title" id="fulfilment-title">Fulfilment costs<\/h1>/);
  assert.match(html, /<section class="glass fulfilment-glance"/);
  assert.match(html, /<section class="glass fulfilment-upload"/);
});
