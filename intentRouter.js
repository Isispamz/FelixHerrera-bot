// intentRouter.js — Router principal (ES) con tono Alfred + JARVIS
// ---------------------------------------------------------------

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
require('dayjs/locale/es'); // asegura la locale
dayjs.extend(customParseFormat);
dayjs.locale('es');

const chrono = require('chrono-node');
const { t } = require('./persona');

// soporta default o named exports en módulos locales
const sendMod = require('./send');
const sendText = sendMod.sendText || sendMod;

const icloudMod = require('./icloud');
const createEvent = icloudMod.createEvent || icloudMod;

const onedriveMod = require('./onedrive');
const uploadBufferToOneDrive = onedriveMod.uploadBufferToOneDrive || onedriveMod;

const twilioMod = require('./twilio');
const startClickToCall = twilioMod.startClickToCall || twilioMod;

// ---------------------- helpers ----------------------

function pad(n) { return String(n).padStart(2, '0'); }

function toDateSafe(d) {
  if (!d) return null;
  if (d instanceof Date && !isNaN(d)) return d;
  const tryDay = dayjs(d, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD', 'DD/MM/YYYY HH:mm', 'DD/MM/YYYY'], true);
  if (tryDay.isValid()) return tryDay.toDate();
  const asDate = new Date(d);
  return isNaN(asDate) ? null : asDate;
}

/** Duración en minutos desde texto español/mixto */
function parseDurationText(input) {
  if (!input) return 60; // por defecto
  const s = String(input).toLowerCase().replace(/\s+/g, ' ').trim();
  let m;

  // "1h30", "1:30h"
  if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\s*(\d+)\s*m?/))) {
    const h = parseFloat(m[1].replace(',', '.'));
    const min = parseInt(m[2], 10) || 0;
    return Math.round(h * 60 + min);
  }
  if ((m = s.match(/(\d+)\s*[:.]\s*(\d+)\s*h/))) {
    return Math.round(parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
  }

  // "1.5h", "2h", "90m"
  if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?/))) {
    return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
  }
  if ((m = s.match(/(\d+)\s*m(?:in(?:utos?)?)?/))) {
    return parseInt(m[1], 10);
  }

  // español natural
  if (/\bmedia ?hora\b/.test(s)) return 30;
  if (/\bhora y media\b/.test(s)) return 90;
  if (/\buna hora\b/.test(s)) return 60;

  // "2 horas", "3 horas y 15"
  if ((m = s.match(/(\d+)\s*horas?(?:\s*y\s*(\d+)\s*min)?/))) {
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    return h * 60 + min;
  }

  return 60;
}

/** Extrae lugar a partir de "en <lugar>" o "@lugar" al final */
function extractLocation(text) {
  if (!text) return '';
  let m = text.match(/(?:\b(?:en)\s+)([^,;]+)$/i);
  if (m) return m[1].trim();
  m = text.match(/@([^\s,;].*)$/);
  if (m) return m[1].trim();
  return '';
}

/** Intenta inferir título eliminando fecha/hora/duración/lugar conocidos */
function inferTitle(raw, { when, minutes, location }) {
  let title = String(raw || '').trim();

  // quita "en <lugar>" o "@lugar"
  title = title
    .replace(/\s+en\s+[^,;]+$/i, '')
    .replace(/\s+@[^\s,;]+.*$/i, '');

  // quita duración
  title = title
    .replace(/\b\d+\s*m(?:in(?:utos?)?)?\b/ig, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*h(?:oras?)?\b/ig, '')
    .replace(/\bmedia ?hora\b/ig, '')
    .replace(/\bhora y media\b/ig, '');

  // quita fecha/hora reconocible simple (no perfecto, pero ayuda)
  title = title
    .replace(/\b(hoy|mañana|pasado mañana)\b/ig, '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
    .replace(/\b\d{1,2}\s*(?:am|pm|hrs?|h)\b/ig, '')
    .replace(/\b\d{2}:\d{2}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/, '');

  if (!title) title = 'Evento';
  return title;
}

/** Usa chrono-node para fecha/hora en español */
function parseWhen(text) {
  const ref = new Date();
  // forwardDate: fechas pasadas se mandan al futuro
  const dt = chrono.parseDate(text, ref, { forwardDate: true });
  return toDateSafe(dt);
}

/** Normaliza el payload: acepta crudo de Meta o un objeto plano */
function normalizeIncoming(payload) {
  // Si ya es plano { from, type, text }
  if (payload && typeof payload === 'object' && ('from' in payload || 'text' in payload || 'type' in payload)) {
    const from = payload.from || payload.phone_number || payload.sender || '';
    const type = payload.type || (payload.text ? 'text' : undefined);
    const text = payload.text?.body ?? payload.text ?? '';
    return { from, type, text };
  }

  // Crudo de WhatsApp Cloud API
  try {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg0 = value?.messages?.[0];

    const from = msg0?.from || value?.contacts?.[0]?.wa_id || '';
    const type = msg0?.type || '';
    const text =
      (msg0?.text && msg0.text.body) ||
      (msg0?.button && msg0.button.text) ||
      (msg0?.interactive && msg0.interactive?.button_reply?.title) ||
      '';

    return { from, type, text };
  } catch {
    return { from: '', type: '', text: '' };
  }
}

// ---------------------- router ----------------------

async function handleIncoming(payload) {
  const msg = normalizeIncoming(payload);
  try {
    const from = msg.from;
    const body = msg.text || '';
    const text = String(body || '').trim();
    const low = text.toLowerCase();

    console.log('[webhook] incoming:', {
      from,
      type: msg.type,
      hasText: !!text,
      preview: text.slice(0, 80)
    });

    // Saludo / ayuda rápida
    if (!text) {
      await sendText(from, t('hello'));
      return;
    }

    if (['hola', 'buenas', 'hey', 'menu', 'ayuda', 'help'].includes(low)) {
      await sendText(from, t('generic_help'));
      return;
    }

    // Intent: guía de agenda
    if (/\bagenda\b|\bevento\b|\bcita\b/.test(low)) {
      await sendText(from, t('agenda_help'));
      return;
    }

    // Intent: llamada (simple)
    if (/\b(llama|marc[ae]r?)\b/.test(low)) {
      const num = (text.match(/(\+?\d[\d\s-]{6,})/) || [])[1];
      if (num) {
        try {
          await startClickToCall(num.replace(/\D/g, ''));
          await sendText(from, t('calling', num));
        } catch (err) {
          await sendText(from, 'No fue posible iniciar la llamada ahora mismo.');
        }
      } else {
        await sendText(from, 'Indíqueme a qué número desea llamar (por ejemplo: "llama al 55 1234 5678").');
      }
      return;
    }

    // Intent: adjuntos -> OneDrive (si tu server ya descargó el buffer)
    if (['image', 'document', 'audio', 'video'].includes(msg.type)) {
      if (msg.mediaBuffer && msg.filename) {
        try {
          const savedPath = await uploadBufferToOneDrive(msg.mediaBuffer, msg.filename);
          await sendText(from, t('file_saved', savedPath || msg.filename));
        } catch (err) {
          await sendText(from, 'No logré guardar el archivo en OneDrive en este momento.');
        }
      } else {
        await sendText(from, 'Puedo guardar sus archivos en OneDrive; envíelos de nuevo y me encargo.');
      }
      return;
    }

    // -------- Intent: crear evento por lenguaje natural --------
    // Ej: "Dentista mañana 11am 1h en Altavista"
    //     "Comida, 5/9 14:00, 90m, @Roma"
    const when = parseWhen(text);
    if (!when || isNaN(when.getTime())) {
      if (/\b(hoy|mañana|pasado|am|pm|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|ene|feb|mar|abr|may|jun|jul|ago|sept|set|oct|nov|dic)\b/i.test(text)) {
        await sendText(from, t('parse_fail_date'));
      } else {
        await sendText(from, t('generic_help'));
      }
      return;
    }

    const minutes = parseDurationText(text);
    const location = extractLocation(text);
    const title = inferTitle(text, { when, minutes, location });

    console.log('[router] createEvent ->', {
      title,
      startISO: when.toISOString(),
      minutes,
      location
    });

    try {
      // 🔴 IMPORTANTE: usar startDate para iCloud
      await createEvent({ title, startDate: when, minutes, location });
      await sendText(from, t('event_created', { title, start: when, minutes, location }));
    } catch (err) {
      console.error('[icloud] createEvent error:', err?.message || err);
      await sendText(from, 'No pude crear el evento. Intentemos otra vez en unos minutos.');
    }
  } catch (err) {
    console.error('[router] fatal error:', err?.message || err);
    try { await sendText(msg.from || '', 'Ha ocurrido un detalle inesperado, pero sigo aquí.'); } catch (_) { }
  }
}

module.exports = { handleIncoming };
