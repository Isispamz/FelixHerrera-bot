// intentRouter.js — Router principal (ES) con tono Alfred + JARVIS
// ---------------------------------------------------------------

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
dayjs.locale('es');

const chrono = require('chrono-node');

const { t } = require('./persona');
const { sendText } = require('./send');                 // sendText(to, body)
const { createEvent } = require('./icloud');            // createEvent({ title, start: Date, minutes, location })
const { uploadBufferToOneDrive } = require('./onedrive'); // uploadBufferToOneDrive(Buffer, filename) => path/url
const { startClickToCall } = require('./twilio');       // startClickToCall(number)

// ---------------------- helpers ----------------------

function pad(n){ return String(n).padStart(2,'0'); }

function toDateSafe(d) {
  // acepta Date, dayjs, string; regresa Date o null
  if (!d) return null;
  if (d instanceof Date && !isNaN(d)) return d;
  const tryDay = dayjs(d, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD', 'DD/MM/YYYY HH:mm', 'DD/MM/YYYY'], true);
  if (tryDay.isValid()) return tryDay.toDate();
  const asDate = new Date(d);
  return isNaN(asDate) ? null : asDate;
}

/** Duración en minutos desde texto español/mixto */
function parseDurationText(input) {
  if (!input) return 60; // default
  const s = String(input).toLowerCase().replace(/\s+/g,' ').trim();

  // formatos tipo "1h30", "1:30h", "1.5h", "90m"
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

  // español natural
  if (/\bmedia ?hora\b/.test(s)) return 30;
  if (/\bhora y media\b/.test(s)) return 90;
  if (/\buna hora\b/.test(s)) return 60;
  if (/\bun[a]?\s*\d{0}\s*hora[s]?\b/.test(s)) return 60;

  // "2 horas", "3 horas y 15"
  if ((m = s.match(/(\d+)\s*horas?(?:\s*y\s*(\d+)\s*min)?/))) {
    const h = parseInt(m[1],10);
    const min = m[2] ? parseInt(m[2],10) : 0;
    return h*60 + min;
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
    .replace(/[,\s]+$/,'');

  // si quedó vacío, título genérico
  if (!title) title = 'Evento';

  return title;
}

/** Usa chrono-node para fecha/hora en español */
function parseWhen(text) {
  const ref = new Date();
  // forwardDate: fechas pasadas se mandan al futuro (siguiente ocurrencia)
  const dt = chrono.parseDate(text, ref, { forwardDate: true });
  return toDateSafe(dt);
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
    const from = msg.from || msg.phone_number || msg.sender;
    const body =
      (msg.text && msg.text.body) ||
      (msg.button && msg.button.text) ||
      (msg.interactive && msg.interactive?.button_reply?.title) ||
      (msg.body) ||
      '';

    const text = String(body || '').trim();
    const low = text.toLowerCase();

    // Saludo / ayuda rápida
    if (!text) {
      await sendText(from, t('hello'));
      return;
    }

    if (['hola','buenas','hey','menu','ayuda','help'].includes(low)) {
      await sendText(from, t('generic_help'));
      return;
    }

    // Intent: guía de agenda
    if (/\bagenda\b|\bevento\b|\bcita\b/.test(low)) {
      await sendText(from, t('agenda_help'));
      return;
    }

    // Intent: llamada (muy básico: "llama a 555..." / "marcar 55...")
    if (/\b(llama|marc[ae]r?)\b/.test(low)) {
      const num = (text.match(/(\+?\d[\d\s-]{6,})/) || [])[1];
      if (num) {
        try {
          await startClickToCall(num.replace(/\D/g,''));
          await sendText(from, t('calling', num));
        } catch (err) {
          await sendText(from, 'No fue posible iniciar la llamada ahora mismo.');
        }
      } else {
        await sendText(from, 'Indíqueme a qué número desea llamar (por ejemplo: "llama al 55 1234 5678").');
      }
      return;
    }

    // Intent: adjuntos -> OneDrive (si tu server ya descarga el buffer)
    if (['image','document','audio','video'].includes(msg.type)) {
      // Tu server debe haber puesto msg.mediaBuffer / msg.filename si ya descargó el archivo.
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
    if (!when) {
      // No se detectó fecha/hora. Si el mensaje parece ser una instrucción de agenda, guía.
      if (/\b(hoy|mañana|pasado|am|pm|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|sept|oct|nov|dic)\b/i.test(text)) {
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
      await sendText(from, 'No pude crear el evento. Intentemos otra vez en unos minutos.');
    }
  } catch (err) {
    // Falla de router: que no se caiga
    try { await sendText(msg.from, 'Ha ocurrido un detalle inesperado, pero sigo aquí.'); } catch(_) {}
  }
}

module.exports = { handleIncoming };
