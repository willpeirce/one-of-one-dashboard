import type { AskAnswer } from './protocol.js';

const form = document.querySelector<HTMLFormElement>('#ask-form');
if (form) {
  const input = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const answer = document.querySelector<HTMLElement>('#ask-answer')!;
  const sources = document.querySelector<HTMLElement>('#ask-sources')!;
  const result = document.querySelector<HTMLElement>('#ask-result')!;
  const status = document.querySelector<HTMLElement>('#ask-status')!;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  for (const chip of Array.from(form.querySelectorAll<HTMLButtonElement>('[data-ask-example]'))) {
    chip.addEventListener('click', () => { input.value = chip.textContent ?? ''; input.focus(); });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const question = input.value.trim();
    if (!question) { status.textContent = 'Enter a question.'; input.focus(); return; }
    submit.disabled = true;
    status.textContent = 'Reading your dashboard…';
    result.hidden = true;
    try {
      const response = await fetch('/api/ask', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) throw new Error('Ask request failed');
      const data = await response.json() as AskAnswer;
      answer.textContent = data.answer;
      sources.textContent = data.sources.length
        ? `Sources · ${data.sources.map(source => source.name + (source.asOf ? ` · as of ${time.format(new Date(source.asOf))} UK` : ' · as-of time unavailable')).join(' | ')}`
        : 'Sources · None';
      result.hidden = false;
      status.textContent = '';
    } catch {
      status.textContent = 'Ask is unavailable';
    } finally {
      submit.disabled = false;
    }
  });
}
