import { escapeCreative as e } from './html.js';

export interface CreativeScanView { enabled: boolean; line: string; message: string | null; skippedGroupIds?: string[]; groupSkipped?: boolean }

export function creativeScanStatusHtml(scan: CreativeScanView): string {
  return `<div class="creative-scan-status" data-creative-scan-status><p>${e(scan.line)}</p>${scan.message && !scan.line.includes(scan.message) ? `<p class="note">${e(scan.message)}</p>` : ''}</div>`;
}

export function creativeScanControlHtml(scan: CreativeScanView): string {
  return `<div id="creative-scan-control">${creativeScanStatusHtml(scan)}${scan.groupSkipped ? '<p class="note" data-creative-scan-skipped>↷ Skipped · repeated output limit; a changed image or ad gets a fresh try.</p>' : ''}${scan.enabled && !scan.groupSkipped ? `<button class="btn" type="button" data-creative-scan ${scan.message ? 'disabled' : ''}>Scan now</button>` : ''}<p id="creative-scan-result" role="status" aria-live="polite"></p></div>`;
}
