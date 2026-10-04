import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

try {
  document.documentElement.dataset.theme = localStorage.getItem('pulse-theme') === 'light' ? 'light' : 'dark';
} catch { document.documentElement.dataset.theme = 'dark'; }

class RequestFailed extends Error {
  constructor(readonly status: number) {
    super('Request failed');
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new RequestFailed(response.status);
  return await response.json() as T;
}

const message = document.querySelector<HTMLElement>('#auth-message');
const signIn = document.querySelector<HTMLButtonElement>('#sign-in');
const register = document.querySelector<HTMLFormElement>('#register-device');
const registerButton = document.querySelector<HTMLButtonElement>('#register-button');
const signOut = document.querySelector<HTMLButtonElement>('#sign-out');
const passkeysAvailable = window.isSecureContext && typeof window.PublicKeyCredential !== 'undefined';

function setMessage(text: string): void {
  if (message) message.textContent = text;
}

function setPending(pending: boolean): void {
  if (signIn) signIn.disabled = pending || !passkeysAvailable;
  if (registerButton) registerButton.disabled = pending || !passkeysAvailable;
  if (signOut) signOut.disabled = pending;
}

async function perform(action: () => Promise<void>, fallback: string): Promise<void> {
  setPending(true);
  setMessage('');
  try {
    await action();
  } catch (error: unknown) {
    setMessage(error instanceof RequestFailed && error.status === 429
      ? 'Too many attempts. Wait a few minutes before trying again.'
      : fallback);
  } finally {
    setPending(false);
  }
}

signIn?.addEventListener('click', () => {
  void perform(async () => {
    const optionsJSON = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/auth/login/options', {});
    const response = await startAuthentication({ optionsJSON });
    await post('/auth/login/verify', { response });
    window.location.assign('/');
  }, 'Sign-in did not complete. Try again with a passkey added to Pulse.');
});

register?.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>('#setup-code');
  if (!input || !passkeysAvailable) return;
  // Never retain the phrase in the form after an attempt, including a failed attempt.
  const setupCode = input.value;
  input.value = '';
  void perform(async () => {
    const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/register/options', { setupCode });
    const response = await startRegistration({ optionsJSON });
    await post('/auth/register/verify', { response });
    window.location.assign('/');
  }, 'Could not add this device. Check the setup phrase and try again.');
});

signOut?.addEventListener('click', () => {
  void perform(async () => {
    await post('/auth/logout', {});
    window.location.assign('/login');
  }, 'Could not sign out. Try again.');
});

setPending(false);
if (signIn && !passkeysAvailable) {
  setMessage('Passkeys need a supported browser and a secure connection. Open Pulse over HTTPS, or localhost for local development.');
}
