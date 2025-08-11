// intentRouter.js — Router principal (ES) con tono Alfred + JARVIS
// ---------------------------------------------------------------

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
dayjs.locale('es');

const chrono = require('chrono-node');

const { t } = require('./persona');

// Módulos locales con soporte a export default / nombrado
const sendMod = require('./send');
const sendText = sendMod.sendText || sendMod;

const icloudMod = require('./icloud');
const createEvent = icloudMod.createEvent || icloudMod;

const onedriveMod = require('./onedrive');
const uploadBufferToOneDrive = onedriveMod.uploadBufferToOneDrive || onedriveMod;

const twilioMod = require('./twilio');
const startClickToCall = twilioMod.startClickToCall || twilioMod;

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

function toDateSafe(d) {
  if (isValidDate(d)) return d;
  if (!d) return null;
  // Intenta varios formatos conocidos
  const tryDay = dayjs(d, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD', 'DD/MM/YYYY HH:mm', 'DD/MM/YYYY'], true);
  if (tryDay.isValid()) return tryDay.toDate();
  const asDate = new Date(d);
  return isValidDate(asDate) ? asDate : null;
}

/** Duración en minutos desde texto español/mixto */
function parseDurationText(input) {
  if (!input) return 60; // default
  const s = String(input).toLowerCase().replace(/\s+/g, ' ').trim();

  let m;
  // 1h30, 1:30h
  if ((m = s.match(/(\d+)\s*[:.]\s*(\d+)\s*h/))) {
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  // 1.5h, 2h, 2 horas, 2 horas y 15
  if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?(?:\s*y\s*(\d+)\s*min)?/))) {
    const h = parseFloat(m[1].replace(',', '.'));
    const min = m[2] ? parseInt(m[2], 10) : 0;
    return Math.round(h * 60 + min);
  }
  // 90m, 45 min
  if ((m = s.match(/(\d+)\s*m(?:in(?:utos?)?)?/))) {
    return parseInt(m[1], 10);
  }
  // media hora / hora y media / una hora
  if (/\bmedia ?hora\b/.test(s)) return 30;
  if (/\bhora y media\b/.test(s)) return 90;
  if (/\buna hora\b/.test(s)) return 60;

  return 60;
}

/** Extrae lugar a partir de "en <lugar>" o "@lugar" (preferentemente al final) */
function extractLocation(text) {
  if (!text) return '';
  let m = text.match(/(?:\ben\s+)([^,;]+)$/i);
  if (m) return m[1].trim();
  m = text.match(/@([^\s,;].*)$/);
  if (m) return m[1].trim();
  return '';
}

/** Título: limpia fecha/hora/duración/lugar del texto para quedarse con lo “nominal” */
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
    .replace(/\b(?:lun|mar|mié|mie|jue|vie|sáb|sab|dom)\.?/ig, '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
    .replace(/\b\d{1,2}\s*(?:am|pm|hrs?|h)\b/ig, '')
    .replace(/\b\d{2}:\d{2}\b/g, '')
    .replace(/[,\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!title) title = 'Evento';
  return title;
}

/** Usa chrono-node en español (con forwardDate) */
function parseWhen(text) {
  const ref = new Date();
  const dt = chrono.parseDate(text, ref, { forwardDate: true });
  return toDateSafe(dt);
}

// ---------------------------------------------------------------
// normalización del payload
// ---------------------------------------------------------------

/**
 * Normaliza “payload” en un objeto:
 *   { from, type, text, mediaBuffer?, filename? }
 * Soporta: 
 *  a) el objeto “plano” que ya enviabas desde server.js
 *  b) el webhook crudo de Meta (entry[0].changes[0].value.messages[0])
 */
function normalizeIncoming(payload) {
  // a) Ya normalizado/“plano”
  if (payload && (payload.from || payload.sender || payload.phone_number)) {
    return {
      from: payload.from || payload.phone_number || payload.sender || '',
      type: payload.type || (payload.text ? 'text' : undefined),
      text:
        (payload.text && payload.text.body) ||
        (payload.button && payload.button.text) ||
        (payload.interactive && payload.interactive?.button_reply?.title) ||
        payload.body ||
        '',
      mediaBuffer: payload.mediaBuffer,
      filename: payload.filename,
    };
  }

  // b) Raw Meta Webhook
  try {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      const type = msg.type;
      const from = msg.from || change?.contacts?.[0]?.wa_id || '';
      let text = '';
      if (type === 'text') text = msg.text?.body || '';
      else if (type === 'button') text = msg.button?.text || msg.button?.payload || '';
      else if (type === 'interactive') {
        text =
          msg.interactive?.button_reply?.title ||
          msg.interactive?.list_reply?.title ||
          msg.interactive?.nfm_reply?.response_json ||
          '';
      }
      return { from, type, text };
    }
  } catch (_) {
    // pasa
  }

  return { from: '', type: undefined, text: '' };
}

// ---------------------------------------------------------------
// Router principal
// ---------------------------------------------------------------

async function handleIncoming(payload) {
  // Normaliza SIEMPRE
  const msg = normalizeIncoming(payload);

  try {
    const from = msg.from;
    const body = msg.text || '';
    const text = String(body || '').trim();
    const low = text.toLowerCase();

    if (!from) {
      // No hay número; no podemos responder
      return;
    }

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

    // Intent: llamada (p. ej. "llama al 55 1234 5678")
    if (/\b(llama|marc[ae]r?)\b/.test(low)) {
      const num = (text.match(/(\+?\d[\d\s-]{6,})/) || [])[1];
      if (num) {
        try {
          await startClickToCall(num.replace(/\D/g, ''));
          await sendText(from, t('calling', num));
        } catch {
          await sendText(from, 'No fue posible iniciar la llamada ahora mismo.');
        }
      } else {
        await sendText(from, 'Indíqueme a qué número desea llamar (por ejemplo: "llama al 55 1234 5678").');
      }
      return;
    }

    // Adjuntos -> OneDrive (si server descargó previamente el buffer)
    if (['image', 'document', 'audio', 'video'].includes(msg.type)) {
      if (msg.mediaBuffer && msg.filename) {
        try {
          const saved = await uploadBufferToOneDrive(msg.mediaBuffer, msg.filename);
          await sendText(from, t('file_saved', saved || msg.filename));
        } catch {
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

    // Guardas: si no hay fecha válida, no intentes crear evento (evita getUTCFullYear de undefined)
    if (!isValidDate(when)) {
      if (/\b(hoy|mañana|pasado|am|pm|\d{1,2}[:h]\d{2}|\d{1,2}\/\d{1,2}|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/i.test(text)) {
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
      await createEvent({ title, start: when, minutes, location });
      await sendText(from, t('event_created', { title, start: when, minutes, location }));
    } catch (err) {
      console.error('[icloud] createEvent error:', err?.message || err);
      await sendText(from, 'No pude crear el evento. Intentemos otra vez en unos minutos.');
    }
  } catch (err) {
    console.error('[router] fatal error:', err?.message || err);
    try { await sendText(payload?.from || '', 'Ha ocurrido un detalle inesperado, pero sigo aquí.'); } catch {}
  }
}

module.exports = { handleIncoming };
