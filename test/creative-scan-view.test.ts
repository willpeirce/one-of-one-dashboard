import assert from 'node:assert/strict';
import test from 'node:test';
import { creativeScanControlHtml, creativeScanStatusHtml } from '../src/creatives/scan-view.js';

test('scan controls follow enabled state and show the price or cap stop', () => {
  assert.doesNotMatch(creativeScanControlHtml({ enabled: false, line: 'Scan: off', message: null }), /data-creative-scan /);
  assert.match(creativeScanControlHtml({ enabled: true, line: 'Scan: on', message: null }), /data-creative-scan >Scan now/);
  assert.match(creativeScanControlHtml({ enabled: true, line: 'Scan: on', message: 'Set the scan prices in Settings' }), /data-creative-scan disabled/);
  assert.match(creativeScanStatusHtml({ enabled: false, line: 'Scan: off', message: 'Set the scan prices in Settings' }), /Set the scan prices in Settings/);
  assert.doesNotMatch(creativeScanStatusHtml({ enabled: false, line: '<script>invented</script>', message: null }), /<script>/);
});
