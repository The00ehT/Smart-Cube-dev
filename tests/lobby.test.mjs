import assert from 'node:assert/strict';
import { cleanRoom } from '../src/lobby.js';

const a = cleanRoom({ code: 'ab12c', name: 'Speed Session', host: 'Anna', avatar: { type: 'emoji', value: '🦊' }, players: 3, round: 7, created: 123 });
assert.equal(a.code, 'AB12C');
assert.equal(a.emoji, '🦊');
assert.equal(cleanRoom(a).emoji, '🦊', 'Emoji bleibt auf dem Weg durch die Lobby erhalten');
assert.equal(cleanRoom({ code: 'XY' }), null, 'ungültiger Code');
assert.equal(cleanRoom({ code: 'ABCDE', players: 9999 }).players, 50, 'Spielerzahl begrenzt');
assert.equal(cleanRoom({ code: 'ABCDE', name: 'x'.repeat(200) }).name.length, 40, 'Name gekürzt');
assert.equal(cleanRoom({ code: 'ABCDE', avatar: { type: 'image', value: 'data:image/png;base64,…' } }).emoji, '', 'keine Bilder in der Liste');
console.log('lobby: alle Tests bestanden');
