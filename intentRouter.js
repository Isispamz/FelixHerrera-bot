const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
dayjs.locale('es');

const chrono = require('chrono-node'); // parser de lenguaje natural (ES)
const { sendText } = require('./send');
const { createEvent } = require('./icloud');
const { uploadBufferToOneDrive } = require('./onedrive');
const { startClickToCall } = require('./twilio');

// ---------- helpers ----------
function parseDurationText(s) {
  if (!s) return 60;
  const str = String(s).toLowerCase().replace(/\s+/g, '');
  // horas + minutos: "1h30m", "1h", "90m", "1.5h", "hora y media", "mediahora"
  if (/^\d+(?:[.,]\d+)?h(\d+m)?$/.test(str)) {
    const h = parseFloat(str.replace(/h.*/,'').replace(',','.'));
    const m = (str.match(/(\d+)m/) || [0,0])[1];
    return Math.round(h*60) + parseInt(m || 0);
  }
  if (/^\d+m$/.test(str)) return parseInt(str);
  if (/^(\d+(?:[.,]\d+)?)h$/.test(str)) return Math.round(parseFloat(RegExp.$1.replace(',','.'))*60);
  if (/mediashora/.test(str) || /mediahora/.test(str) || /mediah/.test(str)) return 30;
  if (/horaymedia/.test(str) || /horaymedia/.test(str)) return 90;

  // español con espacios
  if (/(\d+(?:[.,]\d+)?)\s*h(oras?)?/i.test(s)) {
    const h = parseFloat((s.match(/(\d+(?:[.,]\d+)?)\s*h/i)||[])[1]?.replace(',','.')) || 0;
    const m = parseInt((s.match(/(\d+)\s*m/i)||[])[1]||0);
    return Math.round(h*60) + m;
  }
  if (/(\d+)\s*m(in(utos)?)?/i.test(s)) return parseInt(s.match(/(\d+)\s*m/i)[1]);

  const n = parseInt(s); // si solo hay número, asumimos minutos
  return isNaN(n) ? 60 : n;
}

function extractLocation(text) {
  // "…, en Altavista", "… @Altavista"
  let loc = null, rest = text;
  const m1 = text.match(/(?:^|,|\s)\ben\s+([^,]+)$/i);
  if (m1) { loc = m1[1].trim(); rest = text.replace(m1[0],'').trim(); }
  const m2 = rest.match(/@([^\s,].*)$/);
  if (!loc && m2) { loc = m2[1].trim(); rest = rest.replace(m2[0],'').trim(); }
  return { location: loc, rest };
}

function extractDuration(text) {
  const m = text.match(/(?:^|,|\s)(\d+(?:[.,]\d+)?\s*h(?:\s*\d+\s*m)?)\b/i)
           || text.match(/(?:^|,|\s)(\d+\s*m)\b/i)
           || text.match(/\b(hora y media|media hora)\b/i);
  if (!m) return { minutes: 60, rest: text };
  const minutes = parseDurationText(m[1] || m[0]);
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s{2,}/g,' ').trim();
  return { minutes, rest };
}

function parseEventFreeform(raw) {
  // 1) quita ubicación y duración del texto
  let { location, rest } = extractLocation(raw);
  let dInfo = extractDuration(rest); rest = dInfo.rest;
  let minutes = dInfo.minutes;

  // 2) detecta fecha/hora con Chrono (ES)
  const results = chrono.es.parse(rest, new Date());
  if (!results.length) return null;
  const r = results[0];
  let start = r.start.date();

  // si no trae hora, fija 09:00 local
  if (start.getHours() === 0 && start.getMinutes() === 0) {
    start.setHours(9, 0, 0, 0);
  }

  // 3) título = texto restante sin el fragmento de fecha
  const before = rest.slice(0, r.index).trim().replace(/[,-–—]+$/,'');
  const after  = rest.slice(r.index + r.text.length).trim().replace(/^[,-–—]+/,'');
  const title = (before + (before && after ? ' ' : '') + after).trim() || 'Evento';

  return { title, start, minutes, location };
}

// ---------- main ----------
async function handleIncoming(change) {
  const msg = change.messages?.[0];
  const from = msg?.from;

  if (msg?.type === 'text') {
    const raw = (msg.text?.body || '').trim();

    // palabras clave para abrir el modo agenda
    if (/(\bagenda\b|\bevento\b|\bcita\b)/i.test(raw)) {
      await sendText(from, 'Ok. Dime algo como: "Dentista mañana 11am 1h en Altavista" o "Cena, 5 sept 20:30, 90m, @Roma". Si omites duración uso 60m.');
      return;
    }

    // intento de parseo libre
    const ev = parseEventFreeform(raw);
    if (ev) {
      try {
        const end = new Date(ev.start.getTime() + ev.minutes * 60000);
        await createEvent({ title: ev.title, start: ev.start, end, location: ev.location });
        await sendText(from,
          `Listo. Evento creado: ${ev.title} (${dayjs(ev.start).format('YYYY-MM-DD HH:mm')} · ${ev.minutes}m${ev.location ? ' · ' + ev.location : ''}).`
        );
      } catch (e) {
        console.error(e);
        await sendText(from, 'No pude crear el evento. Intenta otra vez o dame otro formato (ej: "Reunión mañana 10am 45m en oficina").');
      }
      return;
    }

    // fallback
    await sendText(from, 'No entendí. Prueba: "Dentista mañana 11am 1h en Altavista" o "Café, 5/9 18:00, 30m, @Condesa".');
    return;
  }

  // Documento / Imagen => a OneDrive (igual que antes)
  if (msg?.type === 'document' || msg?.type === 'image') {
    const media = change?.messages?.[0];
    const mediaId = media?.document?.id || media?.image?.id;
    const filename = media?.document?.filename || `imagen-${Date.now()}.jpg`;

    const metaUrl = `https://graph.facebook.com/v22.0/${mediaId}?access_token=${process.env.WHATSAPP_TOKEN}`;
    const r1 = await fetch(metaUrl); const j1 = await r1.json();
    const r2 = await fetch(j1.url);  const buf = Buffer.from(await r2.arrayBuffer());

    const path = `/FELIX/${new Date().toISOString().slice(0,10)}/${filename}`;
    await uploadBufferToOneDrive(path, buf);
    await sendText(from, `Documento guardado en OneDrive: ${path}`);
    return;
  }
}

module.exports = { handleIncoming };
