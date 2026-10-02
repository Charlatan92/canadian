import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMediaFailure, describePlayerError, isManifest, isMediaRequest, nextRecoveryStep } from '../src/shared/streamErrors.js';

test('flux : requêtes vidéo jamais filtrées par le bloqueur', () => {
  assert.ok(isMediaRequest({ url: 'https://cdn.example.net/live/index.m3u8?token=abc', resourceType: 'xhr' }));
  assert.ok(isMediaRequest({ url: 'https://cdn.example.net/live/seg_0042.ts' }));
  assert.ok(isMediaRequest({ url: 'https://cdn.example.net/dash/manifest.mpd' }));
  assert.ok(isMediaRequest({ url: 'https://cdn.example.net/x', resourceType: 'media' }));
  assert.ok(!isMediaRequest({ url: 'https://ads.example.com/vast.xml', resourceType: 'xhr' }));
  assert.ok(!isMediaRequest({ url: 'https://ads.example.com/pop.js', resourceType: 'script' }));
  assert.ok(isManifest({ url: 'https://x/y', contentType: 'application/vnd.apple.mpegurl' }));
});

test('flux : cause probable d\'un échec de la liste de lecture', () => {
  assert.equal(classifyMediaFailure({ status: 403 }).kind, 'forbidden');
  assert.equal(classifyMediaFailure({ status: 404 }).kind, 'gone');
  assert.equal(classifyMediaFailure({ status: 502 }).kind, 'server');
  assert.equal(classifyMediaFailure({ error: 'net::ERR_BLOCKED_BY_CLIENT' }).kind, 'blocked');
  assert.equal(classifyMediaFailure({ error: 'net::ERR_CONNECTION_TIMED_OUT' }).kind, 'unreachable');
  assert.equal(classifyMediaFailure({ status: 200, contentType: 'text/html; charset=utf-8' }).kind, 'not-playlist');
  assert.equal(classifyMediaFailure({ error: 'net::ERR_ABORTED' }), null);
  assert.equal(classifyMediaFailure({ status: 200, contentType: 'application/x-mpegURL' }), null);
});

test('flux : codes d\'erreur des lecteurs', () => {
  assert.match(describePlayerError('hls:networkError_manifestLoadError'), /liste de lecture/);
  assert.match(describePlayerError('hls:networkError_manifestParsingError'), /invalide/);
  assert.match(describePlayerError('hls:networkError_fragLoadError'), /morceaux/);
  assert.match(describePlayerError('media:4'), /format/);
});

test('flux : étapes de reprise', () => {
  assert.equal(nextRecoveryStep({ attempt: 1, adblockActive: true, canSwitch: true }), 'reload');
  assert.equal(nextRecoveryStep({ attempt: 2, adblockActive: true, canSwitch: true }), 'adblock-off');
  assert.equal(nextRecoveryStep({ attempt: 2, adblockActive: false, canSwitch: true }), 'next');
  assert.equal(nextRecoveryStep({ attempt: 3, adblockActive: true, canSwitch: false }), 'suggest');
});
