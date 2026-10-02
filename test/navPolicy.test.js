import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAllowed, navigationVerdict, popupVerdict, sameLink, sameSite, siteOf } from '../src/shared/navPolicy.js';

test('navigation : domaines et sites', () => {
  assert.equal(siteOf('player.streams.example.com'), 'example.com');
  assert.equal(siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.ok(sameSite('a.onhockey.tv', 'onhockey.tv'));
  assert.ok(!sameSite('localhost', '127.0.0.1'));
  assert.ok(hostAllowed('cdn.player.net', new Set(['player.net'])));
  assert.ok(!hostAllowed('evilplayer.net', new Set(['player.net'])));
  assert.ok(sameLink('https://x.com/p?a=1#h', 'https://x.com/p?a=1'));
  assert.ok(sameLink('https://x.com/p?a=1', 'https://x.com/p/?b=2'), 'paramètres ajoutés en route');
});

test('navigation : seuls les vrais clics mènent ailleurs', () => {
  const base = { currentUrl: 'https://onhockey.tv/', allowedHosts: new Set(['onhockey.tv']), now: 10_000 };
  assert.equal(navigationVerdict({ ...base, url: 'https://onhockey.tv/stream.php' }), 'allow');
  assert.equal(navigationVerdict({ ...base, url: 'https://ads.example/landing' }), 'block');
  const intents = [{ url: 'https://streamhost.example/live/1', at: 9_000 }];
  assert.equal(navigationVerdict({ ...base, intents, url: 'https://streamhost.example/live/1' }), 'allow');
  assert.equal(navigationVerdict({ ...base, intents, url: 'https://ads.example/landing' }), 'block', 'un clic n\'autorise que son propre lien');
  assert.equal(navigationVerdict({ ...base, intents, now: 20_000, url: 'https://streamhost.example/live/1' }), 'block', 'clic trop ancien');
  assert.equal(navigationVerdict({ ...base, url: 'about:blank' }), 'allow');
});

test('pop-ups : ouvertes sur place seulement si légitimes', () => {
  const base = { currentUrl: 'https://onhockey.tv/', now: 5_000 };
  assert.equal(popupVerdict({ ...base, url: 'https://ads.example/' }), 'deny');
  assert.equal(popupVerdict({ ...base, url: 'https://ads.example/', activated: true }), 'deny', 'clic piégé vers une pub');
  assert.equal(popupVerdict({ ...base, url: 'https://onhockey.tv/ch2.php', activated: true }), 'open-here');
  assert.equal(popupVerdict({ ...base, url: 'https://onhockey.tv/ch2.php', activated: false }), 'deny');
  assert.equal(popupVerdict({ ...base, url: 'https://host.example/s', knownStreams: new Set(['https://host.example/s']) }), 'open-here');
  assert.equal(popupVerdict({ ...base, url: 'https://host.example/s', intents: [{ url: 'https://host.example/s', at: 4_000 }] }), 'open-here');
  assert.equal(popupVerdict({ ...base, url: 'javascript:alert(1)', activated: true }), 'deny');
});
