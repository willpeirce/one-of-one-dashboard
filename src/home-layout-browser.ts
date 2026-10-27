import { homeDialOrder } from './home-layout.js';

export function arrangeHomeDials(root: ParentNode = document): void {
  for (const panel of Array.from(root.querySelectorAll<HTMLElement>('#dials .panel'))) {
    const primary = panel.querySelector<HTMLElement>('[data-primary-dials]');
    if (!primary) continue;
    let more = panel.querySelector<HTMLDetailsElement>('.sample-dials');
    if (!more) {
      more = document.createElement('details'); more.className = 'sample-dials';
      more.innerHTML = '<summary></summary><div class="grid" data-sample-dials></div>';
      primary.after(more);
    }
    const sample = more.querySelector<HTMLElement>('[data-sample-dials]')!;
    const tiles = [...Array.from(primary.children), ...Array.from(sample.children)].filter((tile): tile is HTMLElement => tile instanceof HTMLElement);
    const live = tiles.filter(tile => tile.dataset.mode === 'live').sort((a, b) => homeDialOrder(a.dataset.modelId ?? '') - homeDialOrder(b.dataset.modelId ?? ''));
    const examples = tiles.filter(tile => tile.dataset.mode !== 'live');
    live.forEach(tile => primary.append(tile)); examples.forEach(tile => sample.append(tile));
    more.querySelector('summary')!.textContent = `Show ${examples.length} sample dials`;
    more.hidden = examples.length === 0;
  }
}
