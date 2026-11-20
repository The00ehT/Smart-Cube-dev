/**
 * Spielmodi als Liste: neue Modi brauchen hier nur einen Eintrag (plus ihre Aktion in main.js).
 *   kind 'scramble'  bestimmt, welches Scramble kommt (bleibt eingestellt)
 *   kind 'ghost'     Rennen gegen einen gespeicherten Solve (bleibt eingestellt, jede Runde neu)
 *   kind 'link'      springt woanders hin (z. B. Raum), ist kein Dauerzustand
 */
import { L } from './i18n.js';

export function modeGroups() {
  return [
    {
      id: 'practice',
      title: L('Üben', 'Practice'),
      modes: [
        { id: 'wca', kind: 'scramble', icon: '🎲', tone: 'blue', title: L('Standard', 'Standard'), desc: L('Zufälliges WCA-Scramble', 'Random WCA scramble') },
        { id: 'cross2', kind: 'scramble', icon: '✚', tone: 'green', title: L('Leichtes Cross', 'Easy cross'), desc: L('2 Cross-Kanten sind schon gelöst', '2 cross edges already solved') },
        { id: 'xcross', kind: 'scramble', icon: '✖', tone: 'teal', title: 'X-Cross', desc: L('Cross-Kanten + 1 Paar gelöst – X-Cross planen', 'Cross edges + 1 pair solved – plan an X-cross') },
        { id: 'oll-endless', kind: 'link', icon: '∞', tone: 'orange', title: L('Endlos-OLL', 'Endless OLL'), desc: L('Eine OLL nach der anderen – einfach ausführen, egal wie du hältst', 'One OLL after another – just perform it, any grip') },
        { id: 'pll-endless', kind: 'link', icon: '∞', tone: 'purple', title: L('Endlos-PLL', 'Endless PLL'), desc: L('Eine PLL nach der anderen – einfach ausführen, egal wie du hältst', 'One PLL after another – just perform it, any grip') },
        { id: 'own', kind: 'scramble', icon: '✋', tone: 'gray', title: L('Eigenes Scramble', 'Own scramble'), desc: L('Selbst verdrehen, der nächste Zug startet die Zeit', 'Scramble yourself, the next move starts the timer') },
      ],
    },
    {
      id: 'challenge',
      title: L('Herausforderung', 'Challenge'),
      modes: [
        { id: 'ghost-pb', kind: 'ghost', icon: '👻', tone: 'purple', title: L('Gegen Bestzeit', 'Race your PB'), desc: L('Dein PB-Solve löst live als Geist mit', 'Your PB solve runs live as a ghost') },
        { id: 'ghost-avg', kind: 'ghost', icon: '🎯', tone: 'orange', title: L('Gegen deinen Schnitt', 'Race your average'), desc: L('Ein typischer Solve aus deinem Ø12 als Gegner', 'A typical solve from your ao12 as opponent') },
        { id: 'room', kind: 'link', icon: '👥', tone: 'pink', title: L('Online-Raum', 'Online room'), desc: L('Gleiches Scramble mit Freunden, live zuschauen', 'Same scramble with friends, watch live') },
      ],
    },
  ];
}

export function findMode(id) {
  for (const g of modeGroups()) for (const m of g.modes) if (m.id === id) return m;
  return null;
}
