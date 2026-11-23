import { scorecardShellStart } from '../scorecard/shell.js';
import { askExamples } from './protocol.js';

export function askPage(mode: 'sample' | 'live'): string {
  return `${scorecardShellStart('Ask', '<link rel="stylesheet" href="/assets/ask.css"><script type="module" src="/assets/ask.js"></script>')}
    <main class="wrap settings-wrap score-wrap ask-page" id="main">
      <section class="chapter">
        <header class="chapter-heading"><div class="chapter-copy"><h1 class="chapter-title">Ask</h1></div></header>
        ${mode === 'sample' ? '<p class="sample-banner">Sample data · invented answers</p>' : ''}
        <form class="glass ask-form" id="ask-form">
          <label for="ask-question">Question about your dashboard</label>
          <textarea id="ask-question" name="question" rows="3" maxlength="300" aria-describedby="ask-hint" required></textarea>
          <p id="ask-hint">Up to 300 characters. Leave customer details out.</p>
          <button class="btn" type="submit">Ask</button>
          <div class="ask-examples" aria-label="Example questions">${askExamples.map(question => `<button class="btn" type="button" data-ask-example>${question}</button>`).join('')}</div>
        </form>
      </section>
      <article class="glass ask-result" id="ask-result" aria-live="polite" hidden>
        <h2>Answer</h2><p id="ask-answer"></p><p id="ask-sources"></p>
      </article>
      <p id="ask-status" role="status"></p><p id="auth-message" role="status"></p>
    </main></body></html>`;
}
