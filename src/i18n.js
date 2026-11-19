/**
 * Sprache: Deutsch oder Englisch.
 * Dynamische Texte stehen zweisprachig direkt im Code: L('Deutsch', 'English').
 * Feste Texte der Seite (index.html) übersetzt translateStatic() über das Wörterbuch unten.
 */

function detect() {
  try {
    const s = JSON.parse(localStorage.getItem('smartcube.settings.v1') || '{}').lang;
    if (s === 'de' || s === 'en') return s;
  } catch {
    /* egal */
  }
  return (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export const lang = typeof window === 'undefined' ? 'de' : detect();
export const isEn = lang === 'en';
/** Text je nach Sprache */
export const L = (de, en) => (isEn ? en : de);
export const locale = isEn ? 'en-GB' : 'de-DE';
/** Zahl mit Nachkommastellen (Deutsch: Komma) */
export const dec = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : isEn ? x.toFixed(d) : x.toFixed(d).replace('.', ','));
export const pctText = (x, d = 0) => (x == null ? '–' : `${dec(x * 100, d)} %`);

// Feste Texte aus index.html (Textstücke, Titel, Platzhalter, ARIA-Beschriftungen)
const STATIC = {
  Statistik: 'Stats',
  Algorithmen: 'Algorithms',
  Raum: 'Room',
  'Nicht verbunden': 'Not connected',
  Trennen: 'Disconnect',
  'Dieser Browser kann kein Web Bluetooth. Nutze': 'This browser has no Web Bluetooth. Use',
  oder: 'or',
  '– auf dem iPhone den': '– on iPhone the',
  '-Browser. Ohne Bluetooth kannst du den virtuellen Würfel ausprobieren.': ' browser. Without Bluetooth you can try the virtual cube.',
  'Würfel verbinden': 'Connect your cube',
  'Schalte deinen Smartcube ein und tippe auf „Verbinden“.': 'Turn on your smart cube and tap “Connect”.',
  'GAN-Würfel verbinden': 'Connect GAN cube',
  'Anderer Smartcube': 'Other smart cube',
  'Virtueller Würfel': 'Virtual cube',
  'Neues Scramble': 'New scramble',
  Eigenes: 'Own',
  '👻 Gegen Bestzeit': '👻 Race your PB',
  'Verbinde deinen Würfel, um loszulegen.': 'Connect your cube to get started.',
  '☆ Rekonstruktion archivieren': '☆ Save reconstruction',
  'Ausrichtung zurücksetzen': 'Reset orientation',
  'Als gelöst markieren': 'Mark as solved',
  'Ausrichten': 'Reset',
  'Modus': 'Mode',
  'Bildschirm anlassen (kein Bildschirmschoner)': 'Keep screen on (no auto-lock)',
  '🗑 Alle Bilder zurücksetzen': '🗑 Reset all images',
  'Zum Drehen ziehen': 'Drag to rotate',
  '🔍 Was wäre besser gewesen?': '🔍 What could have been better?',
  '🔍 Analyse': '🔍 Analysis',
  'Modus wählen': 'Choose mode',
  'Bleibt eingestellt, bis du ihn wechselst.': 'Stays on until you switch.',
  'Neu': 'New',
  'Gelöst': 'Solved',
  "Tastatur: I/K = R/R', J/F = U/U', H/G = F/F', D/E = L/L', S/L = D/D', W/O = B/B'": "Keyboard: I/K = R/R', J/F = U/U', H/G = F/F', D/E = L/L', S/L = D/D', W/O = B/B'",
  'Letzte Züge & Gerät': 'Last moves & device',
  'Alle löschen': 'Delete all',
  'Alle Solves': 'All solves',
  '★ Archiv': '★ Archive',
  'Online-Raum': 'Online room',
  'Alle im Raum bekommen': 'Everyone in the room gets',
  'dasselbe Scramble': 'the same scramble',
  ', ihr seht euch': ', you watch each other',
  'live beim Lösen': 'solve live',
  'zu und die Zeiten landen in einer gemeinsamen Tabelle. Die Verbindung läuft direkt zwischen den Geräten.':
    'and all times end up in one shared table. The connection runs directly between the devices.',
  'Raum erstellen': 'Create room',
  'oder mit Code beitreten': 'or join with a code',
  Beitreten: 'Join',
  'MAC-Adresse von': 'MAC address of',
  'GAN-Würfel verschlüsseln ihre Daten mit ihrer Bluetooth-MAC-Adresse. Dein Browser gibt sie nicht automatisch heraus, deshalb bitte einmal eintragen – sie wird für diesen Würfel gespeichert.':
    'GAN cubes encrypt their data with their Bluetooth MAC address. Your browser doesn’t reveal it automatically, so please enter it once – it is saved for this cube.',
  'Automatisch (Chrome/Edge):': 'Automatically (Chrome/Edge):',
  unter: 'enable',
  'aktivieren und neu verbinden.': 'and reconnect.',
  'Manuell finden:': 'Find it manually:',
  'in der GAN-App unter Geräteinfo, oder in Chrome unter': 'in the GAN app under device info, or in Chrome at',
  Abbrechen: 'Cancel',
  Verbinden: 'Connect',
  Lösung: 'Solution',
  '▶ Rekonstruktion ansehen & teilen': '▶ View & share reconstruction',
  '☆ Im Archiv speichern': '☆ Save to archive',
  '🖼 Als Bild teilen': '🖼 Share as image',
  '👻 Dagegen antreten': '👻 Race it',
  Löschen: 'Delete',
  Schließen: 'Close',
  Stärkenprofil: 'Skill profile',
  'Profil bearbeiten': 'Edit profile',
  Einstellungen: 'Settings',
  Profil: 'Profile',
  'Tippe auf das Bild, um es zu ändern.': 'Tap the picture to change it.',
  '📷 Eigenes Foto': '📷 Own photo',
  Entfernen: 'Remove',
  Fertig: 'Done',
  'Dein Name steht auf geteilten Rekonstruktionen. Das Foto bleibt nur auf diesem Gerät.': 'Your name appears on shared reconstructions. The photo stays on this device.',
  Darstellung: 'Appearance',
  Automatisch: 'Auto',
  Hell: 'Light',
  Dunkel: 'Dark',
  Sprache: 'Language',
  'Würfelansicht ohne Gyroskop': '3D view without gyro',
  'Cross-Farbe unten (automatisch)': 'Cross color down (auto)',
  'Weiß unten': 'White down',
  'Gelb unten': 'Yellow down',
  'Grün unten': 'Green down',
  'Blau unten': 'Blue down',
  'Rot unten': 'Red down',
  'Orange unten': 'Orange down',
  'Standard (Weiß oben)': 'Standard (white up)',
  'Deine Cross-Farbe (für Algorithmen, Training und leichte Scrambles)': 'Your cross color (for algorithms, training and easy scrambles)',
  'Automatisch (häufigste aus deinen Solves)': 'Auto (most frequent in your solves)',
  Weiß: 'White',
  Gelb: 'Yellow',
  Grün: 'Green',
  Blau: 'Blue',
  Rot: 'Red',
  'Scramble-Art': 'Scramble type',
  'Normal (WCA-Zufallszustand)': 'Normal (WCA random state)',
  'Leicht: 2 Cross-Kanten schon gelöst': 'Easy: 2 cross edges solved',
  'X-Cross üben: 2 Cross-Kanten + 1 Paar gelöst': 'X-cross practice: 2 cross edges + 1 pair solved',
  '15 s Inspektion (WCA: +2 ab 15 s, DNF ab 17 s)': '15 s inspection (WCA: +2 after 15 s, DNF after 17 s)',
  'Nach jedem Solve automatisch neues Scramble': 'New scramble after every solve',
  'Zeit während des Solves ausblenden': 'Hide time while solving',
  Würfel: 'Cube',
  'Gyroskop verwenden (Rotations, Regrips, 3D-Lage)': 'Use gyroscope (rotations, regrips, 3D orientation)',
  'Aus spart Akku am Handy: Die App verarbeitet dann keine Lagedaten und zeichnet den Würfel nur bei Zügen neu. Der Würfel selbst sendet weiter – sein Akku wird dadurch nicht geschont.':
    'Off saves phone battery: the app ignores orientation data and only redraws the cube on moves. The cube keeps sending – its own battery is not saved.',
  'Gespeicherte MAC-Adressen vergessen': 'Forget saved MAC addresses',
  // Attribute
  Bereiche: 'Sections',
  'Profil & Einstellungen': 'Profile & settings',
  'Du verdrehst selbst – der nächste Zug startet die Zeit': 'Scramble it yourself – the next move starts the timer',
  'Gegen deine Bestzeit antreten – ihr Geisterwürfel löst live mit': 'Race your PB – its ghost cube solves along live',
  'Geist beenden': 'Stop ghost',
  'Halte den Würfel mit Weiß oben und Grün vorne und drücke dann hier': 'Hold the cube white up, green front, then tap here',
  'Setzt den gespeicherten Zustand im Würfel auf gelöst': 'Sets the state stored in the cube to solved',
  'Alle Solves als Datei speichern': 'Save all solves to a file',
  'Solves aus einer Export-Datei laden': 'Load solves from an export file',
  'Profilbild ändern': 'Change picture',
  'Dein Name': 'Your name',
  'Avatar auswählen': 'Choose avatar',
  Farbschema: 'Color scheme',
  'Würfel-Aussehen': 'Cube look',
  'Offline-Prüfung': 'Offline check',
  Zurück: 'Back',
  '▶ Wiederholung': '▶ Replay',
  '▶ Ansehen': '▶ Replay',
  'Drehe eine beliebige Seite, um weiterzumachen.': 'Turn any face to continue.',
  'Ergebnis-Analyse nach jedem Solve zeigen': 'Show result analysis after every solve',
  'Als Bild teilen': 'Share as image',
  'GAN-Stil (spitze Ecken)': 'GAN style (sharp corners)',
  'Stickerless (rund)': 'Stickerless (round)',
  Design: 'Design',
  Galaxie: 'Galaxy',
  'Kuh 🐄': 'Cow 🐄',
  'Platine (PCB)': 'Circuit board (PCB)',
  'Eigene Bilder': 'Own images',
  '🏷 Logo fürs Mittelstück': '🏷 Logo for center piece',
  'Logo entfernen': 'Remove logo',
  'Tipps für iPhone / Bluefy': 'Tips for iPhone / Bluefy',
  'Zeigt die Prüfung „bereit“, funktioniert die App auch ohne Internet – öffne sie einfach wie gewohnt in Bluefy (am besten als Favorit). Zeigt sie „nicht unterstützt“, braucht die App beim Öffnen eine Verbindung; danach läuft alles außer Online-Räumen ohne Netz weiter, solange du die Seite nicht neu lädst.':
    'If the check says “ready”, the app also works without internet – just open it in Bluefy as usual (ideally as a favorite). If it says “not supported”, the app needs a connection when opening; after that everything except online rooms keeps working offline as long as you don’t reload.',
  'Als App-Symbol:': 'As an app icon:',
  'In der Kurzbefehle-App einen Kurzbefehl „URL öffnen“ mit der Adresse dieser Seite anlegen, „Mit Bluefy öffnen“ wählen und zum Home-Bildschirm hinzufügen.':
    'In the Shortcuts app create an “Open URL” shortcut with this page’s address, choose “Open in Bluefy” and add it to the home screen.',
  'Unter iOS 26 gibt es die Safari-Erweiterung „WebBLE“, die Web Bluetooth in Safari nachrüstet. In Safari ist die App über „Teilen → Zum Home-Bildschirm“ installierbar und offline nutzbar. (Mit der Erweiterung noch nicht getestet.)':
    'On iOS 26 there is the Safari extension “WebBLE” that adds Web Bluetooth to Safari. In Safari the app can be installed via “Share → Add to Home Screen” and used offline. (Not tested with the extension yet.)',
  Stil: 'Style',
  'Klassisch (Sticker)': 'Classic (stickers)',
  Fliesen: 'Tiles',
  Körper: 'Body',
  Schwarz: 'Black',
  Grau: 'Gray',
  Farben: 'Colors',
  Kräftig: 'Vivid',
  Pastell: 'Pastel',
  Oberfläche: 'Finish',
  Glänzend: 'Glossy',
  Matt: 'Matte',
};

/** Feste Texte und Attribute einer Seite übersetzen (nur bei Englisch nötig) */
export function translateStatic(root = document.body) {
  if (!isEn) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const key = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (key && STATIC[key] !== undefined) {
      const lead = n.nodeValue.match(/^\s*/)[0];
      const trail = n.nodeValue.match(/\s*$/)[0];
      n.nodeValue = lead + STATIC[key] + trail;
    }
  }
  for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v && STATIC[v] !== undefined) el.setAttribute(a, STATIC[v]);
    }
  }
  document.documentElement.lang = 'en';
}
