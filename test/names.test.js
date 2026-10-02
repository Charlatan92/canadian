import test from 'node:test';
import assert from 'node:assert/strict';
import { NameSpotter, phonetic, similarity } from '../src/shared/names.js';

const P = (id, first, last, teamId = 8) => ({ id, first, last, teamId });
const roster = [
  P(1, 'Nick', 'Suzuki'),
  P(2, 'Cole', 'Caufield'),
  P(3, 'Juraj', 'Slafkovský'),
  P(4, 'Ivan', 'Demidov'),
  P(5, 'Lane', 'Hutson'),
  P(6, 'Arber', 'Xhekaj'),
  P(7, 'Phillip', 'Danault'),
  P(8, 'Alexandre', 'Carrier'),
  P(9, 'Kirby', 'Dach'),
  P(10, 'Samuel', 'Montembeault'),
  P(20, 'Auston', 'Matthews', 10),
  P(40, 'Brayden', 'Point', 14),
  P(21, 'William', 'Nylander', 10),
  P(30, 'Jack', 'Hughes', 1),
  P(31, 'Luke', 'Hughes', 1),
];
const spotter = new NameSpotter(roster);
const ids = (text) => spotter.spot(text).map((f) => f.player.id);

test('voix : forme phonétique et similarité', () => {
  assert.equal(phonetic('Hudson'), phonetic('Hutson'));
  assert.equal(phonetic('Danneau'), phonetic('Danault'));
  assert.equal(phonetic('Montembeau'), phonetic('Montembeault'));
  assert.ok(similarity(phonetic('Slavkovsky'), phonetic('Slafkovsky')) > 0.85);
  assert.equal(similarity('abc', 'abc'), 1);
});

test('voix : commentaire en français', () => {
  assert.deepEqual(ids('Suzuki pour Caufield, Caufield lance... arrêt du gardien!'), [1, 2]);
  assert.deepEqual(ids('Slafkovsky dans le coin, il remet à Hutson à la pointe'), [3, 5]);
  assert.deepEqual(ids('Danneau gagne la mise en jeu contre Matthews'), [7, 20]);
  assert.deepEqual(ids('Belle carrière pour ce joueur'), [], '« carrière » n\'est pas Carrier');
  assert.deepEqual(ids('Carrier dégage la zone'), [8]);
  assert.deepEqual(ids('arrêt de Montembeau'), [10]);
});

test('voix : commentaire en anglais et erreurs de transcription', () => {
  assert.deepEqual(ids("Cofield shoots, saved by the goalie, rebound Demidoff!"), [2, 4]);
  assert.deepEqual(ids('Slavkovsky with the puck, over to Hudson'), [3, 5]);
  assert.deepEqual(ids('Slaf kovsky carries it in'), [3], 'nom coupé en deux par la transcription');
  assert.deepEqual(ids('Nylander to Matthews, he scores!'), [21, 20]);
  assert.deepEqual(ids('Dach takes the draw'), [9]);
  assert.deepEqual(ids('Dash to the net'), [9], 'Dach se prononce « Dash »');
  assert.deepEqual(ids('touch the puck'), [], 'nom court : forme phonétique exacte exigée');
  assert.deepEqual(ids('he carries it in'), [], '« carries » n\'est pas Carrier');
});

test('voix : noms qui sont aussi des mots courants (majuscule exigée)', () => {
  assert.deepEqual(ids('Big hit on the puck carrier'), []);
  assert.deepEqual(ids('Carrier clears it'), [8]);
  assert.deepEqual(ids('Hutson takes the shot from the point'), [5]);
  assert.deepEqual(ids('Hutson à la pointe'), [5]);
  assert.deepEqual(ids('Kucherov feeds Point, he scores!'), [40]);
  assert.deepEqual(ids('carrier dégage la zone'), [8], 'transcription sans majuscules : on garde le nom');
});

test('voix : homonymes ignorés et répétitions fusionnées', () => {
  assert.deepEqual(ids('Hughes to Hughes'), [], 'deux Hughes : impossible de savoir lequel');
  assert.deepEqual(ids('Suzuki, Suzuki again, Suzuki!'), [1]);
  assert.equal(new NameSpotter([]).spot('Suzuki').length, 0);
});
