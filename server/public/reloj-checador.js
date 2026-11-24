'use strict';

const labels = {
  CHECK_IN: 'Entrada',
  MEAL_OUT: 'Salida a comida',
  MEAL_IN: 'Regreso de comida',
  CHECK_OUT: 'Salida',
};
const publicKey = location.hash.slice(1);
const form = document.getElementById('identify');
const keyField = form.elements.namedItem('punchKey');
const submitButton = form.querySelector('button');
const actionPanel = document.getElementById('actions-panel');
const actionList = document.getElementById('actions');
const cancelButton = document.getElementById('cancel');
const employeeName = document.getElementById('employee-name');
const success = document.getElementById('success');
const errorBox = document.getElementById('error');

let identity = null;
let activePunch = null;
let pending = false;
let idleTimeout;

async function send(path, body) {
  const response = await fetch('/api/reloj-checador/' + path, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(result.message || 'No se pudo completar la solicitud.'), { status: response.status });
  }
  return result;
}

function showIdentify(message = '') {
  clearTimeout(idleTimeout);
  identity = null;
  activePunch = null;
  form.reset();
  actionList.replaceChildren();
  employeeName.textContent = '';
  actionPanel.hidden = true;
  form.hidden = false;
  errorBox.textContent = message;
  keyField.focus();
}

function armIdleTimeout() {
  clearTimeout(idleTimeout);
  idleTimeout = setTimeout(() => showIdentify('Vuelve a identificarte para checar.'), 30_000);
}

async function record(type, button) {
  if (pending || !identity) return;
  if (!activePunch) activePunch = { type, requestId: crypto.randomUUID() };
  if (activePunch.type !== type) return;
  pending = true;
  clearTimeout(idleTimeout);
  errorBox.textContent = '';
  for (const action of actionList.children) action.disabled = true;
  cancelButton.disabled = true;
  try {
    const punch = await send('marcar', { ...identity, ...activePunch });
    const time = new Intl.DateTimeFormat('es-MX', {
      timeZone: punch.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(punch.recordedAt));
    success.textContent = labels[punch.type] + ' · ' + time + ' · Checada registrada';
    success.hidden = false;
    showIdentify();
  } catch (error) {
    if (error.status === 401 || error.status === 409) showIdentify(error.message);
    else {
      errorBox.textContent = error.status ? error.message : 'No pudimos confirmar la checada. Reintenta la misma acción.';
      button.disabled = false;
      button.textContent = 'Reintentar ' + labels[type].toLowerCase();
      armIdleTimeout();
    }
  } finally {
    pending = false;
    cancelButton.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending) return;
  pending = true;
  submitButton.disabled = true;
  success.hidden = true;
  success.textContent = '';
  errorBox.textContent = '';
  const credentials = { punchKey: keyField.value };
  keyField.value = '';
  try {
    const employee = await send('identificar', credentials);
    identity = { ...credentials, revision: employee.revision };
    employeeName.textContent = employee.fullName;
    actionList.replaceChildren(...employee.actions.map((type, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = labels[type];
      if (index) button.className = 'secondary';
      button.addEventListener('click', () => record(type, button));
      return button;
    }));
    form.hidden = true;
    actionPanel.hidden = false;
    employeeName.focus();
    armIdleTimeout();
  } catch (error) {
    errorBox.textContent = error.status ? error.message : 'No pudimos conectar. Intenta de nuevo.';
    keyField.focus();
  } finally {
    pending = false;
    submitButton.disabled = false;
  }
});

cancelButton.addEventListener('click', () => {
  if (!pending) showIdentify();
});

window.addEventListener('hashchange', () => location.reload());
if (window.isSecureContext && /^[A-Za-z0-9_-]{32}$/.test(publicKey)) showIdentify();
else document.getElementById('invalid-link').hidden = false;
