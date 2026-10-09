import { ukToday } from './hero-range.js';
import { monthlyOverheadTotal, type OverheadItem } from './overheads.js';
import { installPullToRefresh, reloadPageForRefresh } from './pull-refresh.js';

type SettingInput = HTMLInputElement | HTMLSelectElement;
type JsonObject = { [key: string]: unknown };

function enhanceMonthInputs(root: HTMLElement | DocumentFragment): void {
  root.querySelectorAll<HTMLInputElement>('[data-month-input]').forEach((input) => {
    const probe = document.createElement('input');
    probe.type = 'month';
    probe.value = 'not-a-month';
    if (probe.type !== 'month' || probe.value !== '') {
      input.type = 'text';
      input.placeholder = 'YYYY-MM';
      input.pattern = '[0-9]{4}-(0[1-9]|1[0-2])';
      input.maxLength = 7;
    }
  });
}

function inputValue(input: SettingInput): string | number | boolean | null {
  if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked;
  if (input.dataset.nullable === 'true' && input.value === '') return null;
  if (input instanceof HTMLInputElement && input.type === 'number') return input.valueAsNumber;
  return input.value;
}

function setPath(target: JsonObject, path: string, value: unknown): void {
  const keys = path.split('.');
  let object = target;
  for (const key of keys.slice(0, -1)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
    object[key] ??= {};
    object = object[key] as JsonObject;
  }
  const last = keys.at(-1);
  if (last && last !== '__proto__' && last !== 'constructor' && last !== 'prototype') object[last] = value;
}

function getPath(target: JsonObject, path: string): unknown {
  let value: unknown = target;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as JsonObject)[key];
  }
  return value;
}

function reveal(input: HTMLElement): void {
  let ancestor = input.parentElement;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
}

function initializeSettings(form: HTMLFormElement): void {
  const save = document.querySelector<HTMLButtonElement>('#settings-save')!;
  const fieldset = document.querySelector<HTMLFieldSetElement>('#settings-fields')!;
  const message = document.querySelector<HTMLElement>('#settings-message')!;
  const lists = Array.from(form.querySelectorAll<HTMLElement>('[data-settings-list]'));
  let pending = false;
  let dirty = false;
  function showOverheadsTotal(): void {
    const list = form.querySelector<HTMLElement>('[data-settings-list="overheads"]');
    const total = list?.querySelector<HTMLElement>('[data-overheads-total]');
    if (!list || !total) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>('[data-list-rows] > .setting-row')).flatMap((row): OverheadItem[] => {
      const value = (key: string) => row.querySelector<HTMLInputElement>(`[data-setting-path$=".${key}"]`)?.value ?? '';
      const monthlyGbp = Number(value('monthlyGbp'));
      const startMonth = value('startMonth');
      const endMonth = value('endMonth');
      const monthIsValid = (month: string) => month === '' || /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month);
      if (!Number.isFinite(monthlyGbp) || monthlyGbp < 0 || monthlyGbp > 1_000_000 || !monthIsValid(startMonth) || !monthIsValid(endMonth)) return [];
      return [{ name: value('name'), monthlyGbp, startMonth, endMonth }];
    });
    total.textContent = `Total this month: £${monthlyOverheadTotal(items, ukToday().slice(0, 7)).toFixed(2)}`;
  }

  function showShopifyCosts(): void {
    const list = form.querySelector<HTMLElement>('[data-shopify-cost-map]');
    if (!list) return;
    const labels = JSON.parse(list.dataset.shopifyCostMap!) as Record<string,string>;
    for (const row of Array.from(list.querySelectorAll<HTMLElement>('.setting-row'))) {
      const sku = row.querySelector<HTMLInputElement>('[data-setting-path$=".sku"]')?.value ?? '';
      const label = row.querySelector<HTMLElement>('[data-shopify-cost]');
      if (label) label.textContent = Object.hasOwn(labels, sku) ? labels[sku]! : 'Not in Shopify';
    }
  }

  function markDirty(): void {
    if (pending) return;
    dirty = true;
    showShopifyCosts();
    showOverheadsTotal();
    message.textContent = 'You have unsaved changes.';
    message.removeAttribute('data-error');
  }

  function numberRows(list: HTMLElement): void {
    const key = list.dataset.settingsList!;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-list-rows] > .setting-row'));
    rows.forEach((row, index) => {
      row.querySelector('[data-row-number]')!.textContent = String(index + 1);
      row.querySelectorAll<SettingInput>('[data-setting-path]').forEach((input) => {
        const oldId = input.id;
        const leaf = input.dataset.settingPath!.split('.').at(-1)!;
        const path = `${key}.${index}.${leaf}`;
        input.name = path;
        input.dataset.settingPath = path;
        input.id = `setting-${path.replaceAll('.', '-')}`;
        row.querySelector<HTMLLabelElement>(`label[for="${oldId}"]`)?.setAttribute('for', input.id);
      });
      enhanceMonthInputs(row);
    });
    list.querySelector('[data-list-count]')!.textContent = String(rows.length);
    list.querySelector<HTMLElement>('[data-list-empty]')!.hidden = rows.length > 0;
    const maxRows = list.dataset.listMax;
    if (maxRows) list.querySelector<HTMLButtonElement>('[data-add-row]')!.disabled = rows.length >= Number(maxRows);
  }

  function addRow(list: HTMLElement): boolean {
    const maxRows = list.dataset.listMax;
    if (maxRows && list.querySelector('[data-list-rows]')!.children.length >= Number(maxRows)) return false;
    const template = list.querySelector<HTMLTemplateElement>('[data-list-template]')!;
    list.querySelector('[data-list-rows]')!.append(template.content.cloneNode(true));
    numberRows(list);
    return true;
  }

  form.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const add = target.closest<HTMLButtonElement>('[data-add-row]');
    const remove = target.closest<HTMLButtonElement>('[data-remove-row]');
    if (add) {
      const list = add.closest<HTMLElement>('[data-settings-list]')!;
      if (!addRow(list)) return;
      list.querySelector<HTMLElement>('[data-list-rows] > .setting-row:last-child input, [data-list-rows] > .setting-row:last-child select')?.focus();
      markDirty();
    } else if (remove) {
      const list = remove.closest<HTMLElement>('[data-settings-list]')!;
      remove.closest('.setting-row')!.remove();
      numberRows(list);
      list.querySelector<HTMLButtonElement>('[data-add-row]')!.focus();
      markDirty();
    }
  });
  form.addEventListener('input', (event) => {
    if (event.target instanceof HTMLElement) event.target.removeAttribute('aria-invalid');
    markDirty();
  });
  form.addEventListener('change', markDirty);
  form.addEventListener('invalid', (event) => {
    if (event.target instanceof HTMLElement) reveal(event.target);
  }, true);

  function readValues(): JsonObject {
    const values: JsonObject = {};
    form.querySelectorAll<SettingInput>('[data-setting-path]').forEach((input) => {
      if (!input.closest('[data-settings-list]')) setPath(values, input.dataset.settingPath!, inputValue(input));
    });
    lists.forEach((list) => {
      values[list.dataset.settingsList!] = Array.from(list.querySelectorAll<HTMLElement>('[data-list-rows] > .setting-row')).map((row) => {
        const value: JsonObject = {};
        row.querySelectorAll<SettingInput>('[data-setting-path]').forEach((input) => {
          value[input.dataset.settingPath!.split('.').at(-1)!] = inputValue(input);
        });
        return value;
      });
    });
    return values;
  }

  function showValues(values: JsonObject): void {
    lists.forEach((list) => {
      const rows = values[list.dataset.settingsList!];
      if (!Array.isArray(rows)) return;
      list.querySelector('[data-list-rows]')!.replaceChildren();
      rows.forEach(() => addRow(list));
      numberRows(list);
    });
    form.querySelectorAll<SettingInput>('[data-setting-path]').forEach((input) => {
      const value = getPath(values, input.dataset.settingPath!);
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value === true;
      else input.value = value === null || value === undefined ? '' : String(value);
    });
    showShopifyCosts();
    showOverheadsTotal();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) return;
    const values = readValues();
    const version = Number(form.dataset.version);
    pending = true;
    save.disabled = true;
    fieldset.disabled = true;
    message.textContent = 'Saving settings…';
    message.removeAttribute('data-error');
    form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    void (async () => {
      try {
        const response = await fetch('/api/settings', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version, values }),
        });
        if (response.status === 401) {
          message.textContent = 'Your session has ended. Sign in again before saving.';
        } else if (response.status === 409) {
          message.textContent = 'Settings changed on another device. Your edits are still here. Reload this page to see the latest values before editing and saving again.';
        } else if (response.status === 400) {
          const result = await response.json() as { fields?: unknown };
          const paths = Array.isArray(result.fields) ? result.fields.filter((path): path is string => typeof path === 'string') : [];
          const invalid = Array.from(form.querySelectorAll<SettingInput>('[data-setting-path]')).filter((input) => paths.some((path) => input.dataset.settingPath === path || input.dataset.settingPath!.startsWith(`${path}.`)));
          invalid.forEach((input) => { input.setAttribute('aria-invalid', 'true'); reveal(input); });
          fieldset.disabled = false;
          invalid[0]?.focus();
          message.textContent = invalid.length
            ? 'Check the highlighted settings, then save again. Targets must be at or below break-even; payment shares must total 100%; dates and campaign mappings must be valid.'
            : 'Settings could not be validated. Check the form and try saving again.';
        } else if (!response.ok) {
          message.textContent = 'Settings could not be saved. Your edits are still here. Try again.';
        } else {
          const result = await response.json() as { version: number; values: JsonObject };
          form.dataset.version = String(result.version);
          showValues(result.values);
          dirty = false;
          message.textContent = 'Settings saved.';
          return;
        }
        message.dataset.error = 'true';
      } catch {
        message.textContent = 'Could not connect to Pulse. Your edits are still here. Try saving again.';
        message.dataset.error = 'true';
      } finally {
        pending = false;
        save.disabled = false;
        fieldset.disabled = false;
      }
    })();
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
  });

  enhanceMonthInputs(form);
  lists.forEach((list) => {
    enhanceMonthInputs(list.querySelector<HTMLTemplateElement>('[data-list-template]')!.content);
    numberRows(list);
  });
  showOverheadsTotal();
  const canRefresh = () => dirty || pending ? 'Save or discard your changes first' : true;
  installPullToRefresh({
    status: message,
    refresh: (signal) => reloadPageForRefresh(signal, canRefresh),
    canRefresh,
  });
  save.disabled = false;
}

const settingsForm = document.querySelector<HTMLFormElement>('#settings-form');
if (settingsForm) initializeSettings(settingsForm);
