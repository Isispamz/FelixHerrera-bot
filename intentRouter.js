// intentRouter.js — Router principal (ES) con tono Alfred + JARVIS

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
dayjs.locale('es');

const chrono = require('chrono-node');
const { t } = require('./persona');

// Soporta export default o export nombrado
const sendMod = require('./send');
const sendText = sendMod.sendText || sendMod;

const icloud = require('./icloud');
const createEvent = icloud.createEvent || icloud;
const listEvents = icloud.listEvents;
const findEventByTitle = icloud.findEventByTitle;
const updateEvent = icloud.updateEvent;
const deleteEvent = icloud.deleteEvent;

// ---------------- helpers ----------------

const pad = (n) => String(n).padStart(2, '0');

function minutesToStr(m) {
  if (!m || m === 60) return '60m';
  if (m % 60 === 0) return `${m/60}h`;
  return `${m}m`;
}

function locToStr(location) {
  return location ? ` · ${location}` : '';
}

function formatWhen(d) {
  const dt = dayjs(d);
  const isToday = dt.isSame(dayjs(), 'day');
  const isTomorrow = dt.isSame(dayjs().add(1, 'day'), 'day');
  const dayPart = isToday ? 'hoy' : (isTomorrow ? 'mañana' : dt.format('DD MMM YYYY'));
  return `${dayPart} ${pad(dt.hour())}:${pad(dt.minute())}`;
}

function parseDurationText(input) {
  if (!input) return 60;
  const s = String(input).toLowerCase().replace(/\s+/g,' ').trim();

  let m;
  if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\s*(\d+)\s*m?/))) {
    const h = parseFloat(m[1].replace(',', '.'));
    const min = parseInt(m[2], 10) || 0;
    return Math.round(h*60 + min);
  }
  if ((m = s.match(/(\d+)\s*[:.]\s*(\d+)\s*h/))) {
    return Math.round(parseInt(m[1],10)*60 + parseInt(m[2],10));
  }
  if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?/))) {
    return Math.round(parseFloat(m[1].replace(',', '.'))*60);
  }
  if ((m = s.match(/(\d+)\s*m(?:in(?:utos?)?)?/))) {
    return parseInt(m[1], 10);
  }
  if (/\bmedia ?hora\b/.test(s)) return 30;
  if (/\bhora y media\b/.test(s)) return 90;
  if (/\buna hora\b/.test(s)) return 60;
  if ((m = s.match(/(\d+)\s*horas?(?:\s*y\s*(\d+)\s*min)?/))) {
    const h = parseInt(m[1],10);
    const min = m[2] ? parseInt(m[2],10) : 0;
    return h*60 + min;
  }
  return 60;
}

function extractLocation(text) {
  if (!text) return '';
  let m = text.match(/(?:\b(?:en)\s+)([^,;]+)$/i);
  if (m) return m[1].trim();
  m = text.match(/@([^\s,;].*)$/);
  if (m) return m[1].trim();
  return '';
}

function parseWhen(text) {
  const ref = new Date();
  return chrono.parseDate(text, ref, { forwardDate: true }) || null;
}

function inferTitle(raw, { when, minutes, location }) {
  let title = String(raw || '').trim();
  title = title.replace(/\s+en\s+[^,;]+$/i, '').replace(/\s+@[^\s,;]+.*$/i, '');
  title = title
    .replace(/\b\d+\s*m(?:in(?:utos?)?)?\b/ig, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*h(?:oras?)?\b/ig, '')
    .replace(/\bmedia ?hora\b/ig, '')
    .replace(/\bhora y media\b/ig, '');
  title = title
    .replace(/\b(hoy|mañana|pasado mañana)\b/ig, '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
    .replace(/\b\d{1,2}\s*(?:am|pm|hrs?|h)\b/ig, '')
    .replace(/\b\d{2}:\d{2}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/,'');
  if (!title) title = 'Evento';
  return title;
}

function previewOf(msg) {
  // pequeño resumen para logs
  const text = (msg?.text?.body || '').trim();
  return text.slice(0, 80);
}

// -------------- comandos de agenda --------------

async function cmdList(from, low) {
  // rangos: hoy, mañana, semana/esta semana
  let start = dayjs().startOf('day');
  let end = dayjs().endOf('day');

  if (/\bmañana\b/.test(low)) {
    start = dayjs().add(1, 'day').startOf('day');
    end   = dayjs().add(1, 'day').endOf('day');
  } else if (/\bsemana\b/.test(low)) {
    start = dayjs().startOf('week');
    end   = dayjs().endOf('week');
  }

  const events = await listEvents({ from: start.toDate(), to: end.toDate() });
  if (!events.length) {
    await sendText(from, t('list_empty'));
    return;
  }

  const lines = [ t('list_header') ];
  for (const ev of events) {
    const whenStr = formatWhen(ev.start);
    const durStr = minutesToStr(ev.minutes || 60);
    const locationStr = locToStr(ev.location || '');
    lines.push(t('list_item', { whenStr, title: ev.title, durStr, locationStr }));
  }
  await sendText(from, lines.join('\n'));
}

async function cmdCancel(from, text, low) {
  const m = low.match(/\b(cancela|elimina|borra)\b\s*(.+)?$/i);
  const query = (m && m[2]) ? m[2].trim() : '';
  if (!query) return sendText(from, t('cancel_ask_title'));

  const ev = await findEventByTitle(query, { from: new Date(), to: dayjs().add(90,'day').toDate() });
  if (!ev) return sendText(from, t('cancel_not_found', { query }));

  await deleteEvent(ev);
  return sendText(from, t('cancel_ok', { title: ev.title }));
}

async function cmdMove(from, text, low) {
  // “mueve [titulo] a [fecha]”
  const m = low.match(/\b(mueve|mover|reprograma|cambia)\b\s+(.+?)\s+(?:a|para|al)\s+(.+)$/i);
  if (!m) return sendText(from, t('move_ask_title'));
  const titleQ = m[2]?.trim();
  const whenQ  = m[3]?.trim();
  if (!titleQ) return sendText(from, t('move_ask_title'));
  if (!whenQ)  return sendText(from, t('move_ask_when'));

  const when = parseWhen(whenQ);
  if (!when)  return sendText(from, t('parse_fail_date'));

  const ev = await findEventByTitle(titleQ, { from: new Date(), to: dayjs().add(180,'day').toDate() });
  if (!ev) return sendText(from, t('move_not_found', { query: titleQ }));

  const minutes = ev.minutes || 60;
  const location = ev.location || '';
  await updateEvent(ev, { start: when, minutes, location });

  return sendText(from, t('move_ok', {
    title: ev.title,
    whenStr: formatWhen(when),
    durStr: minutesToStr(minutes),
    locationStr: locToStr(location)
  }));
}

// -------------- router --------------

async function handleIncoming(msg) {
  try {
    const from = msg.from || msg.phone_number || msg.sender;
    const body =
      (msg.text && msg.text.body) ||
      (msg.button && msg.button.text) ||
      (msg.interactive && msg.interactive?.button_reply?.title) ||
      (msg.body) || '';

    const text = String(body || '').trim();
    const low = text.toLowerCase();

    // Logs útiles
    console.log('[webhook] incoming:', {
      from, type: msg.type || 'text', hasText: !!text, preview: previewOf(msg)
    });

    if (!text) return sendText(from, t('hello'));

    // Ayuda / menú
    if (['hola','buenas','hey','menu','ayuda','help'].includes(low)) {
      return sendText(from, t('generic_help'));
    }

    // === LISTAR: "qué tengo ..." ===
    if (/\bqué\s+tengo\b|\bque\s+tengo\b|\bagenda\s+(de|para)\b|\bqué\s+hay\b/.test(low)) {
      return cmdList(from, low);
    }

    // === CANCELAR: "cancela ..." ===
    if (/\b(cancela|elimina|borra)\b/.test(low)) {
      return cmdCancel(from, text, low);
    }

    // === MOVER: "mueve X a Y" ===
    if (/\b(mueve|mover|reprograma|cambia)\b/.test(low)) {
      return cmdMove(from, text, low);
    }

    // === CREAR EVENTO libre ===
    const when = parseWhen(text);
    if (!when) {
      if (/\b(hoy|mañana|pasado|am|pm|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/i.test(text)) {
        return sendText(from, t('parse_fail_date'));
      }
      return sendText(from, t('generic_help'));
    }

    const minutes = parseDurationText(text);
    const location = extractLocation(text);
    const title = inferTitle(text, { when, minutes, location });

    try {
      await createEvent({ title, start: when, minutes, location });
      return sendText(from, t('event_created', {
        title,
        whenStr: formatWhen(when),
        durStr: minutesToStr(minutes),
        locationStr: locToStr(location)
      }));
    } catch (err) {
      console.error('[router] createEvent error:', err?.message || err);
      return sendText(from, t('oops'));
    }
  } catch (err) {
    console.error('[router] fatal error:', err?.message || err);
    try { await sendText(msg.from, t('oops')); } catch (_) {}
  }
}

module.exports = { handleIncoming };
