'use strict';

/**
 * intentRouter.js — Router principal (ES) con tono Alfred + JARVIS
 * - Normaliza payloads del webhook de WhatsApp (Meta)
 * - Crea eventos en iCloud con lenguaje natural
 * - Guarda adjuntos en OneDrive (si viene el buffer)
 * - Inicia click-to-call vía Twilio
 */

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
dayjs.locale('es');

const chrono = require('chrono-node');
const { t } = require('./persona');

// Permitir que los módulos locales exporten default o funciones nombradas
const sendMod = require('./send');
const sendText = sendMod.sendText || sendMod;

const icloudMod = require('./icloud');
const createEvent = icloudMod.createEvent || icloudMod;

const onedriveMod = require('./onedrive');
const uploadBufferToOneDrive = onedriveMod.uploadBufferToOneDrive || onedriveMod;

const twilioMod = require('./twilio');
const startClickToCall = twilioMod.startClickToCall || twilioMod;

// ---------------------- helpers ----------------------

function pad(n) {
  return String(n).padStart(2, '0');
}

function toDateSafe(d) {
  // acepta Date, dayjs, string; regresa Date o null
  if (!d) return null;
  if (d instanceof Date && !isNaN(d)) return d;
  const tryDay = dayjs(d, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD', 'DD/MM/YYYY HH:mm', 'DD/MM/YYYY'], true);
  if (tryDay.isValid()) return tryDay.toDate();
  const asDate = new Date(d);
  return isNaN(asDate) ? null : asDate;
}

// Duración en minutos desde texto español/mixto
function parseDurationText(input) {
  if (!input) return 60; // default
  const s = String(input).toLowerCase().replace(/\s+/g, ' ').trim();

  let m;
  // "1h30", "1:30h", "1.5h", "90m"
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

// Extrae lugar a partir de "en <lugar>" o "@lugar" al final
function extractLocation(text) {
  if (!text) return '';
  let m = text.match(/(?:\b(?:en)\s+)([^,;]+)$/i);
  if (m) return m[1].trim();
  m = text.match(/@([^\s,;].*)$/);
  if (m) return m[1].trim();
  return '';
}

// Intenta inferir título quitando fecha/hora/duración/lugar conocidos
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

  // quita fecha/hora muy comunes
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

// Usa chrono-node para fecha/hora en español
function parseWhen(text) {
  const ref = new Date();
  try {
    // forwardDate: fechas pasadas se mandan al futuro (siguiente ocurrencia)
    const dt = chrono.parseDate(text, ref, { forwardDate: true });
    return toDateSafe(dt);
  } catch (_) {
    return null;
  }
}

// Normaliza payload del webhook: crudo de Meta -> mensaje "plano"
function normalizeIncoming(payload) {
  // Si ya parece plano, regresa tal cual
  if (payload && (payload.from || payload.type || payload.text)) return payload;

  // Forma cruda de WhatsApp Cloud API
  try {
    const entry = payload?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const msg0 = value?.messages?.[0];
    if (msg0) return msg0;
  } catch (_) {}

  return payload || {};
}

// Obtiene texto desde varios tipos de mensaje (text, button, interactive)
function extractBody(m) {
  return (
    (m.text && m.text.body) ||
    (m.button && m.button.text) ||
    (m.interactive && m.interactive?.button_reply?.title) ||
    (m.interactive && m.interactive?.list_reply?.title) ||
    m.body ||
    ''
  );
}

// ---------------------- router ----------------------

async function handleIncoming(msg) {
  try {
    const m = normalizeIncoming(msg);

    const from = m.from || m.phone_number || m.sender || '';
    const body = extractBody(m);
    const text = String(body || '').trim();
    const low = text.toLowerCase();

    console.log('[webhook] incoming:', {
      from,
      type: m?.type,
      hasText: !!text,
      preview: text.slice(0, 60)
    });

    // si no hay remitente, no podemos responder
    if (!from) return;

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

    // Intent: llamada simple: "llama al 55 1234 5678"
    if (/\b(llama|marc[ae]r?)\b/.test(low)) {
      const numMatch = text.match(/(\+?\d[\d\s-]{6,})/);
      const num = numMatch ? numMatch[1] : null;
      if (num) {
        try {
          await startClickToCall(num.replace(/\D/g, ''));
          await sendText(from, t('calling', num));
        } catch (err) {
          console.error('[clickToCall] error:', err?.message);
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

    // Adjuntos -> OneDrive (si tu server ya descargó el archivo y puso mediaBuffer/filename)
    if (['image', 'document', 'audio', 'video'].includes(m.type)) {
      if (m.mediaBuffer && m.filename) {
        try {
          const savedPath = await uploadBufferToOneDrive(m.mediaBuffer, m.filename);
          await sendText(from, t('file_saved', savedPath || m.filename));
        } catch (err) {
          console.error('[onedrive] error:', err?.message);
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

    // -------- Crear evento (lenguaje natural) --------
    // Ej: "Dentista mañana 11am 1h en Altavista"
    //     "Comida, 5/9 14:00, 90m, @Roma"
    const when = parseWhen(text);
    if (!when) {
      if (/\b(hoy|mañana|pasado|am|pm|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\b/i.test(text)) {
        await sendText(from, t('parse_fail_date'));
      } else {
        await sendText(from, t('generic_help'));
      }
      return;
    }

    const minutes = parseDurationText(text);
    const location = extractLocation(text);
    const title = inferTitle(text, { when, minutes, location });

    try {
      await createEvent({ title, startDate: when, minutes, location });
      await sendText(from, t('event_created', { title, start: when, minutes, location }));
    } catch (err) {
      console.error('[icloud] createEvent error:', err?.message);
      await sendText(from, 'No pude crear el evento. Intentemos otra vez en unos minutos.');
    }
  } catch (err) {
    console.error('[router] fatal error:', err?.message);
    try { await sendText(msg?.from, 'Ha ocurrido un detalle inesperado, pero sigo aquí.'); } catch (_) {}
  }
}

// Export en ambas formas (named y default)
module.exports = handleIncoming;
module.exports.handleIncoming = handleIncoming;
