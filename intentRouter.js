'use strict';

/**
 * intentRouter.js — Router principal (ES) con tono Alfred + JARVIS
 * - Resiliente a exports (default o nombrados)
 * - No llama a iCloud si la fecha/hora no es válida
 * - Maneja duración, lugar y título inferido
 * - Soporta “hoy/mañana/pasado mañana”, 11am / 14:30 / 6 pm, etc.
 */

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
dayjs.locale('es');

const chrono = require('chrono-node');

// ---- Cargas seguras de módulos locales (acepta export default o nombrado)
function pick(fnOrObj, key) {
  if (!fnOrObj) return undefined;
  if (typeof fnOrObj === 'function') return fnOrObj;
  if (typeof fnOrObj[key] === 'function') return fnOrObj[key];
  if (fnOrObj.default && typeof fnOrObj.default === 'function') return fnOrObj.default;
  return undefined;
}

const personaMod = require('./persona');
const t =
  (personaMod && personaMod.t) ||
  ((key, v = {}) => {
    const D = d =>
      dayjs(d).isValid() ? `${dayjs(d).format('YYYY-MM-DD HH:mm')}` : 'fecha/hora';
    const M = m => `${m}m`;
    const L = l => (l ? ` · ${l}` : '');
    const msgs = {
      hello:
        '¡A su servicio! Puedo crearle eventos. Por ejemplo: "Dentista mañana 11am 1h en Altavista".',
      generic_help:
        'Puede decirme: "Café, 5/9 18:30, 30m, @Condesa" o "Reunión pasado mañana 9am 90m en oficina".',
      agenda_help:
        'Formato libre: título + fecha/hora + duración + lugar. Ej: "Dentista mañana 11am 1h en Altavista".',
      parse_fail_date:
        'No pude entender la fecha/hora. ¿Podría enviarla como en: "mañana 11am", "5/9 18:30" o similar?',
      calling: num => `Iniciando llamada al ${num}…`,
      file_saved: name => `Archivo guardado: ${name}`,
      event_created: ({ title, start, minutes, location }) =>
        `Listo. Evento creado: ${title} (${D(start)} · ${M(minutes)}${L(location)}).`,
    };
    const m = msgs[key];
    return typeof m === 'function' ? m(v) : m || key;
  });

const sendMod = require('./send');
const sendText =
  pick(sendMod, 'sendText') ||
  ((to, text) => {
    console.log('[sendText Fallback]', { to, text });
    return Promise.resolve();
  });

const icloudMod = require('./icloud');
const createEvent =
  pick(icloudMod, 'createEvent') ||
  (async () => {
    console.log('[iCloud Fallback] createEvent omitido (modo simulación)');
  });

const onedriveMod = require('./onedrive');
const uploadBufferToOneDrive =
  pick(onedriveMod, 'uploadBufferToOneDrive') ||
  (async (buf, name) => {
    console.log('[OneDrive Fallback] upload omitido', { name, size: buf?.length });
    return name || 'archivo';
  });

const twilioMod = require('./twilio');
const startClickToCall =
  pick(twilioMod, 'startClickToCall') ||
  (async num => {
    console.log('[Twilio Fallback] click-to-call omitido', { num });
  });

// ---------------------- helpers ----------------------
const pad = n => String(n).padStart(2, '0');

function toDateSafe(d) {
  if (!d) return null;
  if (d instanceof Date && !isNaN(d)) return d;
  const tryDay = dayjs(
    d,
    ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD', 'DD/MM/YYYY HH:mm', 'DD/MM/YYYY'],
    true
  );
  if (tryDay.isValid()) return tryDay.toDate();
  const asDate = new Date(d);
  return isNaN(asDate) ? null : asDate;
}

/** Duración en minutos desde texto español/mixto */
function parseDurationText(input) {
  if (!input) return 60; // default
  const s = String(input).toLowerCase().replace(/\s+/g, ' ').trim();
  let m;

  // 1h30 / 1:30h / 1.5h / 90m
  if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\s*(\d+)\s*m?/))) {
    const h = parseFloat(m[1].replace(',', '.'));
    const min = parseInt(m[2], 10) || 0;
    return Math.round(h * 60 + min);
  }
  if ((m = s.match(/(\d+)\s*[:.]\s*(\d+)\s*h/))) {
    return Math.round(parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
  }
  if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?/))) {
    return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
  }
  if ((m = s.match(/(\d+)\s*m(?:in(?:utos?)?)?\b/))) {
    return parseInt(m[1], 10);
  }

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

/** Extrae lugar a partir de "en <lugar>" o "@lugar" (al final o casi al final) */
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
  title = title.replace(/\s+en\s+[^,;]+$/i, '').replace(/\s+@[^\s,;]+.*$/i, '');

  // quita duración
  title = title
    .replace(/\b\d+\s*m(?:in(?:utos?)?)?\b/gi, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*h(?:oras?)?\b/gi, '')
    .replace(/\bmedia ?hora\b/gi, '')
    .replace(/\bhora y media\b/gi, '');

  // quita fecha/hora (simple heurística útil)
  title = title
    .replace(/\b(hoy|mañana|pasado mañana)\b/gi, '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
    .replace(/\b\d{1,2}\s*(?:am|pm|hrs?|h)\b/gi, '')
    .replace(/\b\d{2}:\d{2}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/, '');

  if (!title) title = 'Evento'; // fallback
  return title;
}

/** Parse de fecha/hora robusto con fallback a “hoy/mañana/pasado mañana” + hora */
function parseWhen(text) {
  if (!text) return null;
  const ref = dayjs();
  const low = String(text).toLowerCase();

  // 1) chrono (si entiende, listo)
  try {
    const dt = chrono.parseDate(text, ref.toDate(), { forwardDate: true });
    if (dt instanceof Date && !isNaN(dt.getTime())) return dt;
  } catch (_) {}

  // 2) Fallback manual
  let base = ref;
  if (/\bpasado\s+mañana\b/.test(low)) base = ref.add(2, 'day');
  else if (/\bmañana\b/.test(low)) base = ref.add(1, 'day');

  // hora: 14:30 / 11am / 6 pm / 11h / 9 / 9:15
  let h = 9,
    m = 0;
  let mm;

  if ((mm = low.match(/\b(\d{1,2}):(\d{2})\b/))) {
    h = parseInt(mm[1], 10);
    m = parseInt(mm[2], 10);
  } else if ((mm = low.match(/\b(\d{1,2})\s*(am|pm)\b/))) {
    h = parseInt(mm[1], 10);
    if (mm[2] === 'pm' && h < 12) h += 12;
    if (mm[2] === 'am' && h === 12) h = 0;
  } else if ((mm = low.match(/\b(\d{1,2})\s*(?:hrs?|h)\b/))) {
    h = parseInt(mm[1], 10);
  } else if ((mm = low.match(/\b(\d{1,2})\b/))) {
    const cand = parseInt(mm[1], 10);
    if (cand >= 0 && cand <= 23) h = cand;
  }

  const cand = base.hour(h).minute(m).second(0).millisecond(0).toDate();
  return cand instanceof Date && !isNaN(cand.getTime()) ? cand : null;
}

// ---------------------- router ----------------------

/**
 * Maneja un mensaje entrante desde el webhook de WhatsApp.
 * Espera un objeto `msg` similar al de Meta:
 *  - msg.from : número del usuario
 *  - msg.type : 'text' | 'image' | 'document' | ...
 *  - msg.text?.body : texto
 *  - msg.document / msg.image ... (si aplica)
 */
async function handleIncoming(msg) {
  try {
    // Normaliza y loguea entrada
    const from = msg?.from || msg?.phone_number || msg?.sender || '';
    const body =
      msg?.text?.body ||
      msg?.button?.text ||
      msg?.interactive?.button_reply?.title ||
      msg?.body ||
      '';
    const type = msg?.type || (msg?.text ? 'text' : undefined);

    const text = String(body || '').trim();
    const low = text.toLowerCase();

    console.log('[webhook] incoming:', {
      from,
      type,
      hasText: !!text,
      preview: text.slice(0, 80),
    });

    // Si no hay texto
    if (!text) {
      await sendText(from, t('hello'));
      return;
    }

    // Saludo / ayuda
    if (['hola', 'buenas', 'hey', 'menu', 'ayuda', 'help'].includes(low)) {
      await sendText(from, t('generic_help'));
      return;
    }

    // Guía de agenda
    if (/\bagenda\b|\bevento\b|\bcita\b/.test(low)) {
      await sendText(from, t('agenda_help'));
      return;
    }

    // Llamada (muy básico)
    if (/\b(llama|marc[ae]r?)\b/.test(low)) {
      const num = (text.match(/(\+?\d[\d\s-]{6,})/) || [])[1];
      if (num) {
        try {
          await startClickToCall(num.replace(/\D/g, ''));
          await sendText(from, t('calling', num));
        } catch (err) {
          console.error('[twilio] clickToCall error:', err?.message || err);
          await sendText(from, 'No fue posible iniciar la llamada ahora mismo.');
        }
      } else {
        await sendText(
          from,
          'Indíqueme a qué número desea llamar (por ejemplo: "llama al 55 1234 5678").'
        );
      }
      return;
    }

    // Adjuntos -> OneDrive (si tu server ya descarga el buffer)
    if (['image', 'document', 'audio', 'video'].includes(type)) {
      if (msg?.mediaBuffer && msg?.filename) {
        try {
          const savedName = await uploadBufferToOneDrive(msg.mediaBuffer, msg.filename);
          await sendText(from, t('file_saved', savedName || msg.filename));
        } catch (err) {
          console.error('[onedrive] upload error:', err?.message || err);
          await sendText(from, 'No logré guardar el archivo en OneDrive en este momento.');
        }
      } else {
        await sendText(
          from,
          'Puedo guardar sus archivos en OneDrive; envíelos de nuevo y me encargo.'
        );
      }
      return;
    }

    // -------- Intent: crear evento por lenguaje natural --------
    // Ej: "Dentista mañana 11am 1h en Altavista"
    //     "Comida, 5/9 14:00, 90m, @Roma"
    const when = parseWhen(text);

    if (!(when instanceof Date) || isNaN(when.getTime())) {
      if (
        /\b(hoy|mañana|pasado|am|pm|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|sept|oct|nov|dic)\b/i.test(text)
      ) {
        await sendText(from, t('parse_fail_date'));
      } else {
        await sendText(from, t('generic_help'));
      }
      return;
    }

    const minutes = parseDurationText(text);
    const location = extractLocation(text);
    const title = inferTitle(text, { when, minutes, location });

    // Crear en iCloud (CalDAV)
    try {
      await createEvent({ title, start: when, minutes, location });
      await sendText(from, t('event_created', { title, start: when, minutes, location }));
    } catch (err) {
      console.error('[icloud] createEvent error:', err?.message || err);
      await sendText(from, 'No pude crear el evento. Intentemos otra vez en unos minutos.');
    }
  } catch (err) {
    console.error('[router] fatal error:', err?.message || err);
    try {
      if (msg?.from) {
        await sendText(msg.from, 'Ha ocurrido un detalle inesperado, pero sigo aquí.');
      }
    } catch (_) {}
  }
}

// Export en ambas formas (named y default) para evitar errores de importación
module.exports = { handleIncoming };
module.exports.default = handleIncoming;
