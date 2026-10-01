// Faux stream de hockey pour le mode démo : image générée sur un canvas (patinoire, joueurs,
// tableau de score avec horloge, reprises, pauses publicitaires) + bruit de foule, le tout
// envoyé dans un vrai élément <video> comme un lecteur de stream.

import { blackAt, clockAt, crowdAt, demoTime, screenScore, segmentAt } from './timeline.js';

const params = new URLSearchParams(location.search);
const start = Number(params.get('start')) || Date.now();
const canvas = document.getElementById('c');
const video = document.getElementById('v');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// Texture de foule (bruit) précalculée, qui défile avec la caméra
const crowd = document.createElement('canvas');
crowd.width = 2048;
crowd.height = 110;
{
  const c = crowd.getContext('2d');
  const img = c.createImageData(crowd.width, crowd.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 30 + Math.random() * 90;
    const red = Math.random() < 0.18;
    img.data[i] = red ? 150 + Math.random() * 80 : v;
    img.data[i + 1] = red ? 30 : v;
    img.data[i + 2] = red ? 40 : v + 10;
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function drawRink(t) {
  const camX = 320 * Math.sin(t * 0.33) + 110 * Math.sin(t * 1.07);
  const ice = ctx.createLinearGradient(0, 130, 0, H);
  ice.addColorStop(0, '#dfe9f3');
  ice.addColorStop(1, '#f4f8fc');
  ctx.fillStyle = ice;
  ctx.fillRect(0, 0, W, H);
  // Foule et bandes publicitaires
  const off = (((camX * 0.6) % crowd.width) + crowd.width) % crowd.width;
  ctx.drawImage(crowd, off, 0, W, 110, 0, 0, W, 110);
  ctx.drawImage(crowd, off - crowd.width, 0, W, 110, 0, 0, W, 110);
  for (let i = -3; i < 8; i++) {
    const x = i * 260 - (camX % 260);
    ctx.fillStyle = ['#af1e2d', '#192168', '#ffffff', '#f2c230'][(i + 40) % 4];
    ctx.fillRect(x, 110, 250, 26);
  }
  // Lignes de la patinoire
  for (const [wx, color, wdt] of [
    [-420, '#2f4fb5', 14],
    [0, '#c9283a', 12],
    [420, '#2f4fb5', 14],
  ]) {
    const x = W / 2 + wx - camX;
    ctx.fillStyle = color;
    ctx.fillRect(x - wdt / 2, 136, wdt, H - 136);
  }
  ctx.strokeStyle = '#c9283a';
  ctx.lineWidth = 3;
  for (const wx of [-900, 0, 900]) {
    ctx.beginPath();
    ctx.arc(W / 2 + wx - camX, 430, 110, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Joueurs
  for (let i = 0; i < 10; i++) {
    const wx = 380 * Math.sin(t * 0.7 + i * 1.3) + (i - 5) * 40;
    const wy = 400 + 180 * Math.sin(t * 0.55 + i * 1.9);
    const x = W / 2 + wx - camX * 0.9;
    ctx.fillStyle = i < 5 ? '#af1e2d' : '#1d3c8f';
    ctx.beginPath();
    ctx.ellipse(x, wy, 22, 42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String((i * 17) % 99), x, wy + 6);
  }
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(W / 2 + 300 * Math.sin(t * 1.3) - camX * 0.9, 420 + 150 * Math.sin(t * 0.9), 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawScorebug(s) {
  const { remaining } = clockAt(s);
  const score = screenScore(s);
  const x = 40;
  const y = 620;
  ctx.fillStyle = 'rgba(10, 16, 40, 0.94)';
  ctx.fillRect(x, y, 420, 56);
  ctx.fillStyle = '#1d3c8f';
  ctx.fillRect(x, y, 100, 56);
  ctx.fillStyle = '#af1e2d';
  ctx.fillRect(x + 140, y, 100, 56);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText('TOR', x + 50, y + 29);
  ctx.fillText('MTL', x + 190, y + 29);
  ctx.font = 'bold 32px Arial, sans-serif';
  ctx.fillText(String(score.tor), x + 120, y + 29);
  ctx.fillText(String(score.mtl), x + 260, y + 29);
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.fillText('2e', x + 302, y + 29);
  ctx.font = 'bold 32px Arial, sans-serif';
  ctx.fillText(mmss(remaining), x + 366, y + 29);
  ctx.textBaseline = 'alphabetic';
}

function drawAd(t) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  const hue = (t * 40) % 360;
  g.addColorStop(0, `hsl(${hue}, 80%, 45%)`);
  g.addColorStop(1, `hsl(${(hue + 120) % 360}, 80%, 30%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc((i * 137 + t * 90) % (W + 200) - 100, 360 + 200 * Math.sin(t + i), 60 + 20 * i, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 84px Arial, sans-serif';
  ctx.fillText('PNEUS HIVER PLUS', W / 2, 330);
  ctx.font = 'bold 44px Arial, sans-serif';
  ctx.fillText('−30 % cette semaine seulement !', W / 2, 410);
  ctx.font = '22px Arial, sans-serif';
  ctx.fillText('(publicité de démonstration)', W / 2, 470);
}

function frame() {
  const now = Date.now();
  const { s } = demoTime(start, now);
  const t = now / 1000;
  const seg = segmentAt(s);
  if (blackAt(s)) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  } else if (seg === 'ad') {
    drawAd(t);
  } else {
    drawRink(seg === 'replay' ? t * 0.3 : t);
    if (seg === 'replay') {
      ctx.fillStyle = 'rgba(20, 20, 30, 0.25)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f2c230';
      ctx.fillRect(40, 40, 170, 44);
      ctx.fillStyle = '#111';
      ctx.font = 'bold 26px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('REPRISE', 125, 72);
    } else {
      drawScorebug(s);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('DÉMO', W - 24, 34);
  audioUpdate(s, seg);
  requestAnimationFrame(frame);
}

// --- Son : foule, klaxon de l'aréna, musique de pub ---
const ac = new AudioContext();
const dest = ac.createMediaStreamDestination();
const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
{
  const d = noise.getChannelData(0);
  let b = 0;
  for (let i = 0; i < d.length; i++) {
    b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
    d[i] = b * 6;
  }
}
const src = ac.createBufferSource();
src.buffer = noise;
src.loop = true;
const band = ac.createBiquadFilter();
band.type = 'bandpass';
band.frequency.value = 900;
band.Q.value = 0.4;
const crowdGain = ac.createGain();
crowdGain.gain.value = 0.05;
src.connect(band).connect(crowdGain).connect(dest);
src.start();

const jingle = ac.createOscillator();
jingle.type = 'square';
const jingleGain = ac.createGain();
jingleGain.gain.value = 0;
jingle.connect(jingleGain).connect(dest);
jingle.start();

const horn = ac.createOscillator();
horn.type = 'sawtooth';
horn.frequency.value = 150;
const hornGain = ac.createGain();
hornGain.gain.value = 0;
horn.connect(hornGain).connect(dest);
horn.start();

const NOTES = [523, 659, 784, 1047, 784, 659];
function audioUpdate(s, seg) {
  const t = ac.currentTime;
  const c = seg === 'ad' ? 0 : crowdAt(s);
  crowdGain.gain.setTargetAtTime(0.03 + 0.9 * c ** 2, t, 0.25);
  jingleGain.gain.setTargetAtTime(seg === 'ad' ? 0.06 : 0, t, 0.05);
  jingle.frequency.setValueAtTime(NOTES[Math.floor(s * 4) % NOTES.length], t);
  hornGain.gain.setTargetAtTime(s >= 22 && s < 25 ? 0.12 : 0, t, 0.05);
}

const stream = canvas.captureStream(30);
for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
video.srcObject = stream;
video.play().catch(() => {});
requestAnimationFrame(frame);
