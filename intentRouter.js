// intentRouter.js — Router principal (ES) con tono Alfred + JARVIS
// Funciona con payload "plano" o con el crudo de WhatsApp Cloud API.
// ------------------------------------------------------------------

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
dayjs.locale('es');

const chrono = require('chrono-node');
const { t } = require('./persona');

// Módulos locales: soporta export default y export nombrado.
const sendMod = require('./send');
const sendText = sendMod?.sendText || sendMod;

const icloudMod = require('./icloud');
const createEvent = icloudMod?.createEvent || icloudMod;

const onedriveMod = require('./onedrive');
const uploadBufferToOneDrive =
  onedriveMod?.uploadBufferToOneDrive || onedriveMod;

const twilioMod = require('./twilio');
const startClickToCall = twilioMod?.startClickToCall || twilioMod;

// ============================== helpers ===============================

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
  if (!input) return 60;
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

/** Extrae lugar a partir de "en <lugar>" o "@lugar" */
function extractLocation(text) {
  if (!text) return '';
  let m = text.match(/(?:\b(?:en)\s+)([^,;]+)$/i);
  if (m) return m[1].trim();
  // última mención con @
  const atMatches = [...text.matchAll(/@([^\s,;]+)/g)];
  if (atMatches.length) return atMatches[atMatches.length - 1][1].trim();
  return '';
}

/** Usa chrono-node para fecha/hora en español */
function parseWhen(text) {
  const ref = new Date();
  const dt = chrono.parseDate(text, ref, { forwardDate: true });
  return toDateSafe(dt);
}

/** Quita fecha/hora/duración/lugar del texto original para inferir título */
function inferTitle(raw, { when, minutes, location }) {
  let title = String(raw || '').trim();

  // lugar
  title = title
    .replace(/\s+en\s+[^,;]+$/i, '')
    .replace(/\s+@[^\s,;]+.*$/i, '');

  // duración
  title = title
    .replace(/\b\d+\s*m(?:in(?:utos?)?)?\b/ig, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*h(?:oras?)?\b/ig, '')
    .replace(/\bmedia ?hora\b/ig, '')
    .replace(/\bhora y media\b/ig, '');

  // fecha/hora sencillas
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

/** Normaliza el payload de entrada: admite "plano" o crudo de Meta */
function normalizeIncoming(payload) {
  // Si ya viene normalizado
  if (payload && (payload.from || payload.sender || payload.phone_number)) {
    const text =
      payload.text?.body ||
      payload.button?.text ||
      payload.interactive?.button_reply?.title ||
      payload.body ||
      '';
    return {
      from: payload.from || payload.sender || payload.phone_number,
      type: payload.type || (text ? 'text' : undefined),
      text,
      mediaBuffer: payload.mediaBuffer,
      filename: payload.filename,
      raw: payload,
    };
  }

  // WhatsApp Cloud API crudo
  try {
    const entry = (payload?.entry || [])[0];
    const change = (entry?.changes || [])[0];
    const value = change?.value;
    const msg = (value?.messages || [])[0];
    if (msg) {
      const text =
        msg.text?.body ||
        msg.button?.text ||
        msg.interactive?.button_reply?.title ||
        '';
      const media =
        msg.document || msg.image || msg.audio || msg.video || null;

      return {
        from: msg.from,
        type: msg.type || (text ? 'text' : undefined),
        text,
        // si el servidor ya descargó el archivo, puede inyectar mediaBuffer/filename
        mediaBuffer: payload.mediaBuffer,
        filename: media?.filename || undefined,
        raw: msg,
      };
    }
  } catch (_) { /* noop */ }

  // Fallback ultra seguro
  return {
    from: '',
    type: undefined,
    text: '',
    raw: payload,
  };
}

// ============================ main router =============================

async function handleIncoming(payload) {
  const msg = normalizeIncoming(payload);

  // Traza útil en Render
  try {
    console.log('[router] incoming ->', {
      from: msg.from,
      type: msg.type,
      hasText: !!msg.text,
      preview: (msg.text || '').slice(0, 80),
    });
  } catch (_) {}

  // Si no tenemos remitente, no seguimos
  if (!msg.from) return;

  const from = msg.from;
  const text = String(msg.text || '').trim();
  const low = text.toLowerCase();

  // Saludo / ayuda breve
  if (!text) {
    await sendText(from, t('hello'));
    return;
  }
  if (['hola', 'buenas', 'hey', 'menu', 'ayuda', 'help'].includes(low)) {
    await sendText(from, t('generic_help'));
    return;
  }

  // ------------------------ comandos útiles -------------------------
  if (low.startsWith('/')) {
    const [cmd, ...rest] = low.split(/\s+/);
    const argOriginal = text.slice(cmd.length).trim();

    switch (cmd) {
      case '/comandos':
        await sendText(from, t('commands'));
        return;

      case '/agenda':
        await sendText(from, t('agenda_help'));
        return;

      case '/plantilla':
        await sendText(from, t('plantilla'));
        return;

      case '/ping':
        await sendText(from, t('pong'));
        return;

      case '/cc': {
        if (!argOriginal) {
          await sendText(
            from,
            'Indíqueme el número, señorita. Ej: /cc 55 1234 5678'
          );
          return;
        }
        try {
          const num = argOriginal.replace(/\D/g, '');
          await startClickToCall(num);
          await sendText(from, t('calling', { title: num }));
        } catch (_) {
          await sendText(
            from,
            'No fue posible iniciar la llamada ahora mismo, señorita.'
          );
        }
        return;
      }

      default:
        await sendText(from, t('commands'));
        return;
    }
  }

  // -------- adjuntos -> OneDrive (si el servidor inyecta el buffer) --------
  if (['image', 'document', 'audio', 'video'].includes(msg.type)) {
    if (msg.mediaBuffer && msg.filename) {
      try {
        const saved = await uploadBufferToOneDrive(msg.mediaBuffer, msg.filename);
        await sendText(
          from,
          t('file_saved', { title: saved || msg.filename })
        );
      } catch (_) {
        await sendText(
          from,
          'No logré guardar el archivo en OneDrive en este momento, señorita.'
        );
      }
    } else {
      await sendText(
        from,
        'Puedo guardar sus archivos en OneDrive; envíelos de nuevo y me encargo, señorita.'
      );
    }
    return;
  }

  // -------------------- creación de evento por lenguaje natural --------------------
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
    // Compatibilidad: algunos icloud.js esperan start o startDate (Date)
    await createEvent({
      title,
      start: when,
      startDate: when,
      minutes,
      location,
    });

    await sendText(
      from,
      t('event_created', { title, start: when, minutes, location })
    );
  } catch (err) {
    try {
      console.error('[icloud] createEvent error:', err?.message || err);
    } catch (_) {}
    await sendText(
      from,
      'No pude crear el evento. Intentemos otra vez en unos minutos, señorita.'
    );
  }
}

module.exports = { handleIncoming };
