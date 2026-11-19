/**
 * Kurze Meldung unten am Bildschirm, optional mit Aktion (z. B. „Rückgängig“).
 * Ersetzt Rückfragen: Löschen passiert sofort und lässt sich ein paar Sekunden lang zurücknehmen.
 */
import { L } from '../i18n.js';
let box = null;
let timer = 0;

export function toast(text, { action, onAction, duration = 6000 } = {}) {
  if (!box) {
    box = document.createElement('div');
    box.className = 'toast';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  clearTimeout(timer);
  box.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  box.append(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.onclick = () => {
      hide();
      onAction?.();
    };
    box.append(b);
  }
  box.classList.add('show');
  timer = setTimeout(hide, duration);
}

function hide() {
  box?.classList.remove('show');
}

/** Löschen mit Rückgängig: doIt() sofort, undo() wenn angetippt */
export function undoable(text, doIt, undo) {
  doIt();
  toast(text, { action: L('Rückgängig', 'Undo'), onAction: undo });
}
