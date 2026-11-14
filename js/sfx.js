// Small synthesized sound effects (Web Audio API) — no audio files needed.
let ctx = null, master = null;
let volume = 0.6, muted = false;
try {
  volume = +(localStorage.getItem('xc.vol') ?? 0.6);
  muted = localStorage.getItem('xc.mute') === '1';
} catch { /* storage blocked */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Browsers only allow audio after a user gesture; unlock on the first one.
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => ac(), { once: true, capture: true }));

export const getVolume = () => volume;
export const isMuted = () => muted;
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  try { localStorage.setItem('xc.vol', String(volume)); } catch { /* ignore */ }
  if (master) master.gain.value = muted ? 0 : volume;
}
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('xc.mute', muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = muted ? 0 : volume;
}

// ---------- primitives ----------
function tone(freq, dur, { type = 'sine', gain = 0.3, at = 0, to = null, attack = 0.005 } = {}) {
  const c = ac();
  if (!c || muted || volume === 0) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, { freq = 2000, to = null, q = 1, type = 'bandpass', gain = 0.3, at = 0 } = {}) {
  const c = ac();
  if (!c || muted || volume === 0) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// Don't stack the same sound many times in the same instant.
const lastAt = {};
function gate(name, ms = 45) {
  const now = performance.now();
  if (now - (lastAt[name] || 0) < ms) return false;
  lastAt[name] = now;
  return true;
}

// ---------- sounds ----------
const S = {
  draw: () => noise(0.11, { freq: 3200, to: 1400, q: 0.8, gain: 0.22 }),
  slide: () => noise(0.09, { freq: 1600, to: 900, q: 0.7, gain: 0.16 }),
  play: () => { noise(0.08, { freq: 2600, to: 1200, gain: 0.18 }); tone(240, 0.12, { to: 120, gain: 0.25, at: 0.04 }); },
  pp: () => tone(1250, 0.05, { type: 'triangle', gain: 0.12 }),
  click: () => tone(900, 0.03, { type: 'triangle', gain: 0.08 }),
  attack: () => noise(0.28, { freq: 400, to: 2800, q: 1.2, gain: 0.25 }),
  hit: () => { tone(150, 0.2, { to: 50, gain: 0.5 }); noise(0.06, { freq: 3000, type: 'highpass', gain: 0.25 }); },
  down: () => { tone(95, 0.45, { to: 38, gain: 0.55 }); noise(0.25, { freq: 600, to: 200, gain: 0.2, at: 0.02 }); },
  awaken: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.45, { type: 'triangle', gain: 0.16, at: i * 0.07 }));
    noise(0.6, { freq: 6000, type: 'highpass', gain: 0.06, at: 0.1 });
  },
  heal: () => { tone(880, 0.3, { gain: 0.18 }); tone(1320, 0.35, { gain: 0.14, at: 0.08 }); },
  turn: () => { tone(660, 0.6, { gain: 0.16 }); tone(990, 0.7, { gain: 0.1, at: 0.04 }); },
  round: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i === 4 ? 0.8 : 0.22, { type: 'triangle', gain: 0.18, at: i * 0.1 })),
  shuffle: () => { for (let i = 0; i < 9; i++) noise(0.035, { freq: 2200 + Math.random() * 1500, gain: 0.14, at: i * 0.035 }); },
  chat: () => { tone(880, 0.08, { type: 'triangle', gain: 0.12 }); tone(1320, 0.1, { type: 'triangle', gain: 0.1, at: 0.07 }); },
  dice: () => { for (let i = 0; i < 12; i++) { const at = i * 0.06 + (i * i) * 0.004; noise(0.03, { freq: 2500 + Math.random() * 2500, q: 2, gain: 0.2 - i * 0.012, at }); tone(700 + Math.random() * 600, 0.025, { type: 'triangle', gain: 0.06, at }); } },
  land: () => { tone(180, 0.14, { to: 90, gain: 0.35 }); noise(0.05, { freq: 3500, q: 2, gain: 0.2 }); },
  error: () => tone(220, 0.15, { type: 'square', gain: 0.06, to: 180 }),
};

/** Play a named sound, optionally after a delay (ms). */
export function sfx(name, delayMs = 0) {
  const fn = S[name];
  if (!fn) return;
  const go = () => { if (gate(name)) fn(); };
  if (delayMs > 0) setTimeout(go, delayMs); else go();
}
