'use strict';

const labels = {
  CHECK_IN: 'Entrada',
  MEAL_OUT: 'Salida a comida',
  MEAL_IN: 'Regreso de comida',
  CHECK_OUT: 'Salida',
};
const actionIcons = {
  CHECK_IN: 'entry',
  MEAL_OUT: 'meal',
  MEAL_IN: 'return',
  CHECK_OUT: 'exit',
};
const publicKey = location.hash.slice(1);
const organizationName = document.getElementById('organization-name');
const form = document.getElementById('identify');
const keyField = form.elements.namedItem('punchKey');
const submitButton = form.querySelector('button');
const submitLabel = submitButton.querySelector('span');
const actionPanel = document.getElementById('actions-panel');
const actionList = document.getElementById('actions');
const cancelButton = document.getElementById('cancel');
const employeeName = document.getElementById('employee-name');
const success = document.getElementById('success');
const successAction = document.getElementById('success-action');
const successTime = document.getElementById('success-time');
const errorBox = document.getElementById('error');

let identity = null;
let activePunch = null;
let pending = false;
let idleTimeout;

async function send(path, body = {}) {
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

async function showOrganizationName() {
  try {
    const context = await send('contexto');
    const name = context.organizationName?.trim();
    if (name) {
      organizationName.textContent = name;
      organizationName.hidden = false;
    }
  } catch {
    // Si solo falla la consulta del nombre, el formulario sigue disponible.
  }
}

function createActionButton(type, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = index === 0 ? 'button' : 'button secondary';
  const label = document.createElement('span');
  label.textContent = labels[type];
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.classList.add('icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  const use = document.createElementNS(svgNamespace, 'use');
  use.setAttribute('href', '#icon-' + actionIcons[type]);
  icon.append(use);
  button.append(icon, label);
  button.addEventListener('click', () => record(type, button, label));
  return button;
}

function showIdentify(message = '', focus = true) {
  clearTimeout(idleTimeout);
  identity = null;
  activePunch = null;
  form.reset();
  actionList.replaceChildren();
  employeeName.textContent = '';
  actionPanel.hidden = true;
  form.hidden = false;
  errorBox.textContent = message;
  if (focus) keyField.focus({ preventScroll: true });
}

function armIdleTimeout() {
  clearTimeout(idleTimeout);
  idleTimeout = setTimeout(() => showIdentify('Vuelve a identificarte para checar.'), 30_000);
}

async function record(type, button, label) {
  if (pending || !identity) return;
  if (!activePunch) activePunch = { type, requestId: crypto.randomUUID() };
  if (activePunch.type !== type) return;
  pending = true;
  clearTimeout(idleTimeout);
  errorBox.textContent = '';
  label.textContent = 'Registrando…';
  for (const action of actionList.children) action.disabled = true;
  cancelButton.disabled = true;
  try {
    const punch = await send('marcar', { ...identity, ...activePunch });
    const time = new Intl.DateTimeFormat('es-MX', {
      timeZone: punch.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(punch.recordedAt));
    successAction.textContent = labels[punch.type];
    successTime.textContent = time;
    successTime.dateTime = punch.recordedAt;
    success.hidden = false;
    showIdentify('', false);
    success.focus({ preventScroll: true });
  } catch (error) {
    if (error.status === 401 || error.status === 409) showIdentify(error.message);
    else {
      errorBox.textContent = error.status ? error.message : 'No pudimos confirmar la checada. Reintenta la misma acción.';
      button.disabled = false;
      label.textContent = 'Reintentar ' + labels[type].toLowerCase();
      button.focus({ preventScroll: true });
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
  submitLabel.textContent = 'Validando…';
  success.hidden = true;
  errorBox.textContent = '';
  const credentials = { punchKey: keyField.value };
  keyField.value = '';
  try {
    const employee = await send('identificar', credentials);
    identity = { ...credentials, revision: employee.revision };
    employeeName.textContent = employee.fullName;
    actionList.replaceChildren(...employee.actions.map(createActionButton));
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
    submitLabel.textContent = 'Continuar';
  }
});

cancelButton.addEventListener('click', () => {
  if (!pending) showIdentify();
});

keyField.addEventListener('input', () => { success.hidden = true; });
window.addEventListener('hashchange', () => location.reload());
if (window.isSecureContext && /^[A-Za-z0-9_-]{32}$/.test(publicKey)) {
  showIdentify('', false);
  void showOrganizationName();
} else {
  document.getElementById('invalid-link').hidden = false;
}
