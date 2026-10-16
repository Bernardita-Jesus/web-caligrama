const $ = (id) => document.getElementById(id);

// ---------- Estado ----------
// strokes: cada trazo dibujado, { pts, closed }
// format: 'full' (hoja completa), 'card' (tarjeta doblada) o 'postcards' (cuatro postales)
// Tintas: los colores de la caja de cartuchos
const INKS = [
  { name: 'Negro', hex: '#1f1e22' },
  { name: 'Gris', hex: '#85817d' },
  { name: 'Azul real', hex: '#2b3990' },
  { name: 'Azul humo', hex: '#4d5b7c' },
  { name: 'Morado', hex: '#5f3c9e' },
  { name: 'Turquesa', hex: '#2a8898' },
  { name: 'Rojo rubí', hex: '#c8204e' },
  { name: 'Naranjo', hex: '#d9782b' },
  { name: 'Café', hex: '#735a48' },
  { name: 'Verde', hex: '#2e5d3f' },
];

const state = { ink: INKS[0], strokes: [], W: 816, H: 1056, landscape: false, format: 'full', viewTurned: false };

// Tarjeta vertical: la mitad de arriba va dada vuelta en la hoja para que al doblar quede derecha.
// Lo que dibujas queda tal cual en la hoja; "Dar vuelta" solo gira la vista 180° para dibujar esa mitad derecha.
const flipsTop = (format, W, H) => format === 'card' && W <= H;

// Partes de la hoja: el texto de cada trazo se queda dentro de la suya
function panelsFor(format, W, H) {
  if (format === 'card') {
    return W > H
      ? [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }]
      : [{ x: 0, y: 0, w: W, h: H / 2 }, { x: 0, y: H / 2, w: W, h: H / 2 }];
  }
  if (format === 'postcards') {
    const w = W / 2, h = H / 2;
    return [{ x: 0, y: 0, w, h }, { x: w, y: 0, w, h }, { x: 0, y: h, w, h }, { x: w, y: h, w, h }];
  }
  return [{ x: 0, y: 0, w: W, h: H }];
}
const PAD = 24; // margen dentro de cada parte
const inset = (p, m) => ({ x: p.x + m, y: p.y + m, w: p.w - 2 * m, h: p.h - 2 * m });
function panelAt(panels, [x, y]) {
  return panels.find((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) || panels[0];
}

const clean = (t) => t.replace(/\s+/g, ' ').trim();

// Estación en el hemisferio sur (Chile), según el día del año
function season(month, day) {
  const md = month * 100 + day; // 1-12, 1-31
  if (md >= 1221 || md < 321) return 'verano';
  if (md < 621) return 'otoño';
  if (md < 923) return 'invierno';
  return 'primavera';
}
// "viernes 16 de octubre, primavera de 2026"
function dateText(value) {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString('es', { weekday: 'long' });
  const month = date.toLocaleDateString('es', { month: 'long' });
  return `${weekday} ${d} de ${month}, ${season(m, d)} de ${y}`;
}

function settings() {
  const { landscape, W, H, format } = state;
  return {
    text: clean($('text').value),
    // Un poema por parte: dos en la tarjeta, cuatro en las postales
    texts: [...document.querySelectorAll(state.format === 'card' ? '.card-text' : '.postcard-text')].map((t) => clean(t.value)),
    font: 'Source Serif 4', // la letra siempre es serif
    landscape,
    W,
    H,
    format,
    panels: panelsFor(format, W, H),
    repeat: $('repeat').checked,
    size: +$('size').value,
    ink: state.ink.hex,
    paper: '#ffffff',
    rainbow: $('rainbow').checked,
    date: $('useDate').checked ? dateText($('date').value) : '',
    para: $('para').value.trim(),
    de: $('de').value.trim(),
  };
}

// ---------- Medidas de letras ----------
const widthCache = {};
const mctx = document.createElement('canvas').getContext('2d');
function widthFn(font) {
  const cache = (widthCache[font] ||= {});
  return (c) => {
    if (cache[c] === undefined) {
      mctx.font = `100px "${font}"`;
      cache[c] = mctx.measureText(c).width / 100;
    }
    return cache[c];
  };
}

// ---------- Geometría de los trazos ----------
// Suaviza el pulso de la mano
function smooth(pts, passes, closed) {
  for (let k = 0; k < passes; k++) {
    const n = pts.length;
    pts = pts.map((b, i) => {
      if (!closed && (i === 0 || i === n - 1)) return b;
      const a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n];
      return [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    });
  }
  return pts;
}

// Reparte los puntos del trazo a distancias parejas
function resample(pts, gap = 2.5) {
  const out = [pts[0]];
  let [px, py] = pts[0];
  for (const [x, y] of pts.slice(1)) {
    let dist = Math.hypot(x - px, y - py);
    while (dist >= gap) {
      const t = gap / dist;
      px += (x - px) * t;
      py += (y - py) * t;
      out.push([px, py]);
      dist = Math.hypot(x - px, y - py);
    }
  }
  return out;
}

function pathLength(pts, closed) {
  let L = 0;
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    L += Math.hypot(x2 - x1, y2 - y1);
  }
  return L;
}

function sampler({ pts, closed }) {
  const lens = [0];
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    lens.push(lens[i] + Math.hypot(x2 - x1, y2 - y1));
  }
  const L = lens[lens.length - 1];
  const at = (d) => {
    d = closed ? ((d % L) + L) % L : Math.max(0, Math.min(L, d));
    let lo = 0, hi = lens.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lens[mid] <= d) lo = mid; else hi = mid; }
    const [x1, y1] = pts[lo], [x2, y2] = pts[(lo + 1) % pts.length];
    const t = (d - lens[lo]) / (lens[lo + 1] - lens[lo] || 1);
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  };
  return { L, at };
}

// ---------- Texto sobre los trazos ----------
// Caja girada que ocupa una letra, para evitar que se encimen
function glyphBox(x, y, a, cw, fs) {
  return { x, y, a, hw: cw * 0.46, hh: fs * 0.38 };
}
function boxCorners(b) {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
    b.x + u * b.hw * c - v * b.hh * s,
    b.y + u * b.hw * s + v * b.hh * c,
  ]);
}
// Separación de ejes entre dos rectángulos girados
function boxesOverlap(A, B) {
  const ca = boxCorners(A), cb = boxCorners(B);
  for (const ang of [A.a, A.a + Math.PI / 2, B.a, B.a + Math.PI / 2]) {
    const ax = Math.cos(ang), ay = Math.sin(ang);
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const [x, y] of ca) { const p = x * ax + y * ay; minA = Math.min(minA, p); maxA = Math.max(maxA, p); }
    for (const [x, y] of cb) { const p = x * ax + y * ay; minB = Math.min(minB, p); maxB = Math.max(maxB, p); }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

// Recorre los trazos en orden poniendo cada letra centrada sobre la línea.
// Si una letra chocaría con otra ya puesta, avanza un poco hasta encontrar lugar.
function layoutStrokes(list, src, fs, repeat, width, extra = 0, obstacles = []) {
  const paths = list.map((s) => ({ ...sampler(s), rect: s.rect }));
  const n = src.length;
  const reach = fs * 0.8; // suaviza el giro de las letras en las curvas
  const nudge = fs * 0.12;

  const cell = fs * 1.5;
  const grid = new Map();
  const key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  let prev = null; // la letra anterior del mismo trazo siempre puede quedar al lado
  const inside = (b, r) =>
    boxCorners(b).every(([x, y]) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  const collides = (b) => {
    if (obstacles.some((o) => boxesOverlap(b, o))) return true;
    const cx = Math.floor(b.x / cell), cy = Math.floor(b.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of grid.get(cx + dx + ',' + (cy + dy)) || []) if (o !== prev && boxesOverlap(b, o)) return true;
      }
    }
    return false;
  };

  const glyphs = [];
  let i = 0;
  for (const path of paths) {
    let d = 0;
    prev = null;
    while (true) {
      const c = repeat ? src[i % n] : src[i];
      if (c === undefined) break;
      const cw = width(c) * fs;
      if (c === ' ') {
        if (d + cw > path.L + 0.5) break;
        d += cw + extra;
        i++;
        continue;
      }
      let box = null;
      while (d + cw <= path.L + 0.5) {
        const mid = d + cw / 2;
        const [x, y] = path.at(mid);
        const [xa, ya] = path.at(mid - reach), [xb, yb] = path.at(mid + reach);
        const b = glyphBox(x, y, Math.atan2(yb - ya, xb - xa), cw, fs);
        if (inside(b, path.rect) && !collides(b)) { box = b; break; }
        d += nudge;
      }
      if (!box) break;
      glyphs.push({ c, x: box.x, y: box.y, a: box.a, i });
      const k = key(box.x, box.y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(box);
      prev = box;
      d += cw + extra;
      i++;
    }
    if (!repeat && i >= n) break;
  }
  return { glyphs, fits: repeat || i >= n };
}

// Fecha arriba a la derecha de la primera parte y firma (para / de) abajo a la izquierda (en la tarjeta, de la contraportada).
// En la tarjeta vertical, lo de la mitad de arriba se escribe dado vuelta (turn).
function labels(cfg) {
  const out = [];
  const add = (text, size, x, y, align, maxW, turn) => {
    mctx.font = `${size}px "${cfg.font}"`;
    const w = Math.min(mctx.measureText(text).width, maxW);
    let bx = align === 'center' ? x : align === 'right' ? x - w / 2 : x + w / 2;
    let by = y - size * 0.35;
    if (turn) { bx = cfg.W - bx; by = cfg.H / 2 - by; } // dónde queda en la hoja
    out.push({ text, size, x, y, align, maxW, turn, box: { x: bx, y: by, a: 0, hw: w / 2 + 6, hh: size * 0.65 } });
  };
  const first = cfg.panels[0], last = cfg.panels[cfg.panels.length - 1];
  const turnFirst = flipsTop(cfg.format, cfg.W, cfg.H);
  if (cfg.date) {
    const size = Math.min(18, first.w / 26);
    add(cfg.date, size, first.x + first.w - PAD, first.y + PAD + size, 'right', first.w - 2 * PAD, turnFirst);
  }
  // Firma: "Para" arriba y "De" abajo, en la esquina inferior izquierda.
  // En la tarjeta va en la contraportada (la primera parte), junto a la fecha.
  const sign = [cfg.para && `Para: ${cfg.para}`, cfg.de && `De: ${cfg.de}`].filter(Boolean);
  const card = cfg.format === 'card';
  const p = card ? first : last;
  const size = Math.min(24, p.w / 24);
  sign.forEach((text, k) => {
    const y = p.y + p.h - PAD - 4 - (sign.length - 1 - k) * size * 1.35;
    add(text, size, p.x + PAD, y, 'left', p.w - 2 * PAD, card && turnFirst);
  });
  return out;
}

// Acomoda un texto sobre un grupo de trazos y elige el tamaño de letra
function layoutGroup(list, text, cfg, obstacles) {
  const width = widthFn(cfg.font);
  const src = text + ' ';
  let fs = cfg.size, result;
  if (!cfg.repeat) {
    const fitsWith = (size, extra) => layoutStrokes(list, src, size, false, width, extra, obstacles).fits;
    // 1) La letra más grande con la que el texto entra con espaciado natural
    let lo = 5, hi = 72;
    if (fitsWith(lo, 0)) {
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (fitsWith(mid, 0)) lo = mid; else hi = mid;
      }
    }
    fs = lo;
    // 2) Repartir lo que sobra del dibujo entre las letras
    let elo = 0, ehi = fs * 0.6;
    for (let k = 0; k < 12; k++) {
      const mid = (elo + ehi) / 2;
      if (fitsWith(fs, mid)) elo = mid; else ehi = mid;
    }
    result = layoutStrokes(list, src, fs, false, width, elo, obstacles);
  } else {
    result = layoutStrokes(list, src, fs, true, width, 0, obstacles);
  }
  result.glyphs.forEach((g) => (g.fs = fs));
  return { ...result, fs };
}

function compose(cfg) {
  const out = { cfg, glyphs: [], sizes: [], fits: true, note: '', labels: labels(cfg), unwritten: [] };
  const obstacles = out.labels.map((l) => l.box);
  const list = state.strokes.map((s) => {
    const panel = panelAt(cfg.panels, s.pts[0]);
    return { ...s, panel: cfg.panels.indexOf(panel), rect: inset(panel, PAD) };
  });
  if (!list.length) { out.note = 'Dibuja sobre la hoja para empezar.'; return out; }

  // En la tarjeta y en las postales cada parte tiene su poema; en la hoja completa hay un solo texto
  const groups = cfg.format !== 'full'
    ? cfg.texts.map((text, k) => ({ text, list: list.filter((s) => s.panel === k) }))
    : [{ text: cfg.text, list }];

  for (const { text, list: strokes } of groups) {
    if (!strokes.length) continue;
    if (!text) { out.unwritten.push(...strokes); continue; }
    const r = layoutGroup(strokes, text, cfg, obstacles);
    out.glyphs.push(...r.glyphs);
    out.sizes.push(r.fs);
    if (!r.fits) out.fits = false;
  }
  if (!out.sizes.length) {
    out.note = cfg.format === 'postcards'
      ? 'Escribe el poema de cada postal para que recorra su dibujo.'
      : cfg.format === 'card'
        ? 'Escribe el poema de cada mitad para que recorra su dibujo.'
        : 'Escribe un texto para que recorra tu dibujo.';
  }
  return out;
}

// ---------- Dibujo ----------
function tracePath(ctx, { pts, closed }) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (closed) ctx.closePath();
}

// screen: dibuja también ayudas que no van al PDF
function draw(canvas, scale, out, screen) {
  const { cfg } = out;
  // Gira 180° alrededor del centro de la mitad de arriba
  const turn = (ctx) => { ctx.translate(cfg.W, cfg.H / 2); ctx.rotate(Math.PI); };
  canvas.width = Math.round(cfg.W * scale);
  canvas.height = Math.round(cfg.H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = cfg.paper;
  ctx.fillRect(0, 0, cfg.W, cfg.H);

  if (screen) {
    // Los trazos que aún no tienen texto se ven, para no dibujar a ciegas
    if (out.unwritten.length) {
      ctx.save();
      ctx.strokeStyle = cfg.ink;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 2;
      ctx.lineJoin = ctx.lineCap = 'round';
      out.unwritten.forEach((s) => { tracePath(ctx, s); ctx.stroke(); });
      ctx.restore();
    }
    if (!state.strokes.length) {
      ctx.save();
      ctx.fillStyle = cfg.ink;
      ctx.globalAlpha = 0.3;
      ctx.textAlign = 'center';
      for (const p of cfg.panels) {
        ctx.font = `${Math.min(22, p.w / 18)}px "IBM Plex Sans", sans-serif`;
        ctx.fillText('Dibuja aquí con el mouse o el dedo', p.x + p.w / 2, p.y + p.h / 2, p.w - 2 * PAD);
      }
      ctx.restore();
    }
  }

  // Línea de doblez (tarjeta) o de corte (postales); también se imprime
  if (cfg.panels.length > 1) {
    ctx.save();
    ctx.strokeStyle = '#c9c6bf';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    if (cfg.format === 'postcards' || cfg.W > cfg.H) { ctx.moveTo(cfg.W / 2, 0); ctx.lineTo(cfg.W / 2, cfg.H); }
    if (cfg.format === 'postcards' || cfg.W <= cfg.H) { ctx.moveTo(0, cfg.H / 2); ctx.lineTo(cfg.W, cfg.H / 2); }
    ctx.stroke();
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = cfg.ink;
  for (const g of out.glyphs) {
    if (cfg.rainbow) ctx.fillStyle = INKS[g.i % INKS.length].hex;
    ctx.font = `${g.fs}px "${cfg.font}"`;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.a);
    ctx.fillText(g.c, 0, g.fs * 0.32); // centra la letra sobre la línea
    ctx.restore();
  }

  ctx.fillStyle = cfg.ink;
  for (const l of out.labels) {
    ctx.save();
    if (l.turn) turn(ctx);
    ctx.textAlign = l.align;
    ctx.font = `${l.size}px "${cfg.font}"`;
    ctx.fillText(l.text, l.x, l.y, l.maxW);
    ctx.restore();
  }
}

// ---------- Render ----------
let current = null;
let token = 0;
async function render() {
  const my = ++token;
  const cfg = settings();
  await document.fonts.load(`20px "${cfg.font}"`);
  if (my !== token) return;

  const out = compose(cfg);
  current = out;
  const sheet = $('sheet');
  $('sheet-row').classList.toggle('landscape', cfg.landscape);
  const canFlip = flipsTop(cfg.format, cfg.W, cfg.H);
  if (!canFlip) state.viewTurned = false;
  $('turnView').hidden = !canFlip;
  $('turnView').classList.toggle('active', state.viewTurned);
  sheet.classList.toggle('turned', state.viewTurned);
  draw(sheet, 2, out, true);
  drawLive();

  const sizes = out.sizes.map(Math.round);
  const min = Math.min(...sizes), max = Math.max(...sizes);
  const sizeText = !sizes.length ? '–' : min === max ? `${min}` : `${min}–${max}`;
  $('sizeVal').textContent = sizes.length ? sizeText : cfg.size;
  if (!cfg.repeat && sizes.length) $('size').value = min;
  const status = $('status');
  status.classList.remove('warn');
  if (out.note) {
    status.textContent = out.note;
  } else if (!out.fits) {
    status.textContent = cfg.format === 'postcards'
      ? 'Algún poema es demasiado largo para su dibujo. Acórtalo o dibuja más líneas en esa postal.'
      : cfg.format === 'card'
        ? 'Algún poema es demasiado largo para su dibujo. Acórtalo o dibuja más líneas en esa mitad.'
        : 'El texto es demasiado largo para tu dibujo. Acórtalo o dibuja más líneas.';
    status.classList.add('warn');
  } else {
    status.textContent = `${out.glyphs.length} letras · tamaño ${sizeText}px`;
  }
  if (canFlip) {
    status.textContent = state.viewTurned
      ? 'Vista dada vuelta: así se lee la contraportada al doblar. Toca "Dar vuelta" otra vez para volver.'
      : 'Así se imprime: la mitad de arriba va dada vuelta para que al doblar quede derecha. Usa "Dar vuelta" para verla derecha.';
  }
}

let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
}

// ---------- Dibujar sobre la hoja ----------
const sheet = $('sheet');
let live = null; // trazo que se está dibujando
let liveRect = null; // parte de la hoja donde empezó el trazo

function toPage(e) {
  const r = sheet.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * state.W, y = ((e.clientY - r.top) / r.height) * state.H;
  // Con la vista dada vuelta, el punto de la pantalla corresponde al opuesto en la hoja
  return state.viewTurned ? [state.W - x, state.H - y] : [x, y];
}

const clampTo = ([x, y], r) => [Math.min(r.x + r.w, Math.max(r.x, x)), Math.min(r.y + r.h, Math.max(r.y, y))];

function drawLive() {
  if (!live) return;
  const ctx = sheet.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.save();
  ctx.strokeStyle = '#AF5515';
  ctx.lineWidth = 3;
  ctx.lineJoin = ctx.lineCap = 'round';
  tracePath(ctx, { pts: live, closed: false });
  ctx.stroke();
  ctx.restore();
}

function finishStroke() {
  const pts = resample(live);
  if (pts.length < 6) return;
  // Si termina cerca de donde empezó, se cierra
  const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1];
  const closed = pts.length > 30 && Math.hypot(x1 - x0, y1 - y0) < 18;
  state.strokes.push({ pts: resample(smooth(pts, 14, closed)), closed });
}

sheet.addEventListener('pointerdown', (e) => {
  try { sheet.setPointerCapture(e.pointerId); } catch {}
  const p = toPage(e);
  liveRect = inset(panelAt(panelsFor(state.format, state.W, state.H), p), 4);
  live = [clampTo(p, liveRect)];
});
sheet.addEventListener('pointermove', (e) => {
  if (!live) return;
  const p = clampTo(toPage(e), liveRect), last = live[live.length - 1];
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;
  live.push(p);
  draw(sheet, 2, current, true);
  drawLive();
});
const endStroke = () => {
  if (!live) return;
  finishStroke();
  live = null;
  schedule();
};
sheet.addEventListener('pointerup', endStroke);
sheet.addEventListener('pointercancel', endStroke);

// ---------- Controles ----------
['text', 'size', 'rainbow', 'useDate', 'date', 'para', 'de'].forEach((id) =>
  $(id).addEventListener('input', schedule)
);

$('repeat').addEventListener('input', () => {
  const on = $('repeat').checked;
  $('size').disabled = !on;
  $('sizeNote').textContent = on
    ? 'Elige el tamaño; el texto se repite hasta cubrir el dibujo.'
    : 'Se ajusta solo para que tu texto recorra todo el dibujo. Activa "Repetir" para elegirlo tú.';
  schedule();
});

// Rotar la hoja: el dibujo gira con ella, 90° en sentido horario
$('rotate').addEventListener('click', () => {
  const { W, H } = state;
  state.strokes = state.strokes.map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [H - y, x]) }));
  state.W = H;
  state.H = W;
  state.landscape = !state.landscape;
  updateTexts();
  schedule();
});

$('turnView').addEventListener('click', () => {
  state.viewTurned = !state.viewTurned;
  schedule();
});

$('formats').addEventListener('click', (e) => {
  const btn = e.target.closest('.format-btn');
  if (!btn || btn.dataset.format === state.format) return;
  if (state.strokes.length && !confirm('Cambiar el formato borra el dibujo. ¿Continuar?')) return;
  document.querySelectorAll('.format-btn').forEach((b) => b.classList.toggle('active', b === btn));
  state.format = btn.dataset.format;
  updateTexts();
  state.strokes = [];
  schedule();
});

// Un cuadro de texto, uno por mitad de la tarjeta o uno por postal
function updateTexts() {
  $('singleText').hidden = state.format !== 'full';
  $('cardTexts').hidden = state.format !== 'card';
  $('postcardTexts').hidden = state.format !== 'postcards';
  const vertical = state.W <= state.H;
  $('cardLabel1').textContent = vertical ? 'Mitad de arriba · contraportada' : 'Mitad izquierda';
  $('cardLabel2').textContent = vertical ? 'Mitad de abajo · portada' : 'Mitad derecha';
}
document.querySelectorAll('.postcard-text, .card-text').forEach((t) => t.addEventListener('input', schedule));

$('undo').addEventListener('click', () => { state.strokes.pop(); schedule(); });
$('clear').addEventListener('click', () => {
  if (state.strokes.length && !confirm('¿Borrar todo el dibujo?')) return;
  state.strokes = [];
  schedule();
});

// Imagen en alta resolución (300 dpi) para PDF e impresión
function highRes() {
  const canvas = document.createElement('canvas');
  draw(canvas, 300 / 96, current, false);
  return canvas.toDataURL('image/jpeg', 0.95);
}

$('download').addEventListener('click', async () => {
  if (!current) return;
  const btn = $('download');
  btn.disabled = true;
  btn.textContent = 'Generando…';
  try {
    await render();
    const { jsPDF } = window.jspdf;
    const landscape = current.cfg.landscape;
    const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'in', format: 'letter' });
    doc.addImage(highRes(), 'JPEG', 0, 0, landscape ? 11 : 8.5, landscape ? 8.5 : 11);
    doc.save('caligrama.pdf');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Descargar PDF';
  }
});

$('print').addEventListener('click', async () => {
  await render();
  $('print-orientation').textContent =
    `@page { size: letter ${current.cfg.landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
  const img = $('printImg');
  img.onload = () => window.print();
  img.src = highRes();
});

// Fecha de hoy por defecto
{
  const t = new Date();
  $('date').value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function updateDate() {
  $('date').disabled = !$('useDate').checked;
  $('datePreview').textContent = $('useDate').checked ? dateText($('date').value) : '';
}
$('useDate').addEventListener('input', updateDate);
$('date').addEventListener('input', updateDate);
updateDate();

// Muestras de tinta
INKS.forEach((ink) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ink' + (ink === state.ink ? ' active' : '');
  btn.style.background = ink.hex;
  btn.title = ink.name;
  btn.setAttribute('aria-label', ink.name);
  btn.addEventListener('click', () => {
    state.ink = ink;
    document.querySelectorAll('.ink').forEach((b) => b.classList.toggle('active', b === btn));
    $('inkName').textContent = ink.name;
    schedule();
  });
  $('inks').appendChild(btn);
});

updateTexts();
document.fonts.ready.then(schedule);
schedule();

// ---------- Frase que ronda alrededor de la hoja ----------
// Una sola frase que pasea por el margen como un hilo suelto: da la vuelta a su ritmo,
// se acerca y se aleja del borde y de vez en cuando se enrolla en una espiral.
// Es solo decoración de pantalla: no se imprime.
const RING_TEXT = 'Formato inspirado en las obras de Vicente Huidobro';
const RING_M = 92;        // espacio del lienzo alrededor de la hoja
const RING_FONT = 'italic 14px "Source Serif 4"';
const wanderer = {
  x: 0, y: 0, a: 0,       // cabeza de la frase y su dirección
  trail: [],              // camino recorrido, de la cabeza hacia atrás
  t: 0,
  curl: null,             // espiral en curso
  nextCurl: 6,
  rect: null,
};

function ringCanvasSize() {
  const holder = $('canvas-holder');
  const c = $('ring');
  const w = holder.clientWidth, h = holder.clientHeight;
  if (!w || !h) return false;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round((w + 2 * RING_M) * dpr);
  c.height = Math.round((h + 2 * RING_M) * dpr);
  const first = !wanderer.rect;
  wanderer.rect = { x: RING_M, y: RING_M, w, h };
  if (first) {
    wanderer.x = RING_M + w * 0.2;
    wanderer.y = RING_M - 34;
    wanderer.a = 0;
    // Avanza un rato sin dibujar para que la frase aparezca completa
    for (let k = 0; k < 600; k++) stepWanderer(1 / 60);
  }
  return true;
}

function sheetDistance(r, x, y) {
  const qx = Math.min(r.x + r.w, Math.max(r.x, x)), qy = Math.min(r.y + r.h, Math.max(r.y, y));
  const d = Math.hypot(x - qx, y - qy);
  if (d > 0) return { dist: d, nx: (x - qx) / d, ny: (y - qy) / d };
  // Encima de la hoja: sale por el borde más cercano
  const edges = [
    { dist: -(x - r.x), nx: -1, ny: 0 },
    { dist: -(r.x + r.w - x), nx: 1, ny: 0 },
    { dist: -(y - r.y), nx: 0, ny: -1 },
    { dist: -(r.y + r.h - y), nx: 0, ny: 1 },
  ];
  return edges.reduce((a, b) => (b.dist > a.dist ? b : a));
}

function stepWanderer(dt) {
  const W = wanderer, r = W.rect;
  W.t += dt;
  // Distancia a la hoja (negativa si está encima) y dirección hacia afuera
  const { dist, nx, ny } = sheetDistance(r, W.x, W.y);
  const tx = -ny, ty = nx; // sentido del reloj alrededor de la hoja

  if (W.curl) {
    // Rulo suave: menos de una vuelta, cerrándose apenas
    const c = W.curl;
    c.time += dt;
    const p = c.time / c.dur;
    W.a += c.dir * c.w0 * (1 + 0.5 * p) * dt;
    if (p >= 1) { W.curl = null; W.nextCurl = W.t + 14 + Math.random() * 8; }
  } else {
    // Rumbo deseado: dar la vuelta y mantenerse a una distancia que ondula
    const target = 30 + 10 * Math.sin(W.t * 0.37) + 6 * Math.sin(W.t * 0.91 + 1.3);
    const pull = Math.max(-1.6, Math.min(1.6, (target - dist) / 18));
    const want = Math.atan2(ty + ny * pull, tx + nx * pull);
    let diff = want - W.a;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // Deambular: pequeñas desviaciones suaves
    const wobble = 0.9 * Math.sin(W.t * 1.3) + 0.6 * Math.sin(W.t * 2.1 + 0.7);
    W.a += (diff * 1.8 + wobble * 0.6) * dt;
    // Espiral hacia afuera (girando a la izquierda), solo cuando va derecho por el margen
    if (W.t > W.nextCurl && dist > 16 && dist < 30 && Math.abs(diff) < 0.3) {
      W.curl = { time: 0, dur: 2.6 + Math.random() * 1, w0: 1.15, dir: -1 };
    }
  }
  const speed = 30;
  W.x += Math.cos(W.a) * speed * dt;
  W.y += Math.sin(W.a) * speed * dt;
  // Nunca encima de la hoja: si se acerca demasiado, la empuja hacia afuera
  if (dist < 14) { W.x += nx * (14 - dist); W.y += ny * (14 - dist); }
  // Ni fuera del lienzo
  const lim = RING_M - 10;
  W.x = Math.max(r.x - lim, Math.min(r.x + r.w + lim, W.x));
  W.y = Math.max(r.y - lim, Math.min(r.y + r.h + lim, W.y));

  const last = W.trail[0];
  if (!last || Math.hypot(W.x - last[0], W.y - last[1]) >= 1.5) {
    W.trail.unshift([W.x, W.y]);
    if (W.trail.length > 500) W.trail.pop();
  }
}

function drawWanderer() {
  const c = $('ring');
  const ctx = c.getContext('2d');
  const dpr = c.width / (wanderer.rect.w + 2 * RING_M);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = RING_FONT;
  ctx.fillStyle = '#85B19B'; // mismo verde del botón de formato seleccionado
  // Borde del color del fondo para que se lea aunque pase sobre otras cosas
  ctx.strokeStyle = '#FAF7EA';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  // Distancias acumuladas por el camino, desde la cabeza
  const tr = wanderer.trail;
  const lens = [0];
  for (let i = 1; i < tr.length; i++) lens.push(lens[i - 1] + Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]));
  const at = (d) => {
    let i = 1;
    while (i < tr.length - 1 && lens[i] < d) i++;
    const t = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
    return [tr[i - 1][0] + (tr[i][0] - tr[i - 1][0]) * t, tr[i - 1][1] + (tr[i][1] - tr[i - 1][1]) * t];
  };
  // La última letra va en la cabeza; la frase se lee en la dirección en que avanza
  let d = 4;
  for (let k = RING_TEXT.length - 1; k >= 0; k--) {
    const ch = RING_TEXT[k];
    const w = ctx.measureText(ch).width;
    const mid = d + w / 2;
    if (mid > lens[lens.length - 1]) break;
    const [x, y] = at(mid);
    const [xa, ya] = at(mid + 3), [xb, yb] = at(mid - 3);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(yb - ya, xb - xa));
    ctx.strokeText(ch, 0, 5);
    ctx.fillText(ch, 0, 5);
    ctx.restore();
    d += w;
  }
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastFrame = null;
function animateWanderer(now) {
  if (wanderer.rect) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    if (!reduceMotion) stepWanderer(dt);
    drawWanderer();
  }
  lastFrame = now;
  if (!reduceMotion) requestAnimationFrame(animateWanderer);
}
new ResizeObserver(() => { if (ringCanvasSize()) drawWanderer(); }).observe($('canvas-holder'));
document.fonts.ready.then(() => { if (ringCanvasSize()) drawWanderer(); });
requestAnimationFrame(animateWanderer);
