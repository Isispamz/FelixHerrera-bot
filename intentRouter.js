const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
dayjs.locale('es');

const { sendText } = require('./send');
const { createEvent } = require('./icloud');
const { uploadBufferToOneDrive } = require('./onedrive');
const { startClickToCall } = require('./twilio');

// ---- helpers ----
function parseDate(input) {
  if (!input) return null;
  const s = String(input).trim()
    .replace(/\s+/g, ' ')
    .replace('sept', 'sep'); // normaliza abreviación común en ES-MX

  const nowY = new Date().getFullYear();
  const candidates = [
    'YYYY-MM-DD HH:mm',
    'YYYY-MM-DDTHH:mm',
    'DD-MM-YYYY HH:mm',
    'D/M/YYYY H:mm',
    'D/M H:mm',
    'D MMM YYYY HH:mm',
    'D MMMM YYYY HH:mm',
    'D MMM HH:mm',
    'D MMMM HH:mm'
  ];

  // intenta tal cual
  for (const f of candidates) {
    const d = dayjs(s, f, true);
    if (d.isValid()) return d.toDate();
  }
  // intenta agregando el año actual si falta
  for (const f of candidates) {
    const d = dayjs(`${s} ${nowY}`, f.replace(' YYYY', '') + ' YYYY', true);
    if (d.isValid()) return d.toDate();
  }
  // fallback: si viene como "YYYY-MM-DD 11:00", convierte al ISO con T
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
    const d = new Date(s.replace(' ', 'T'));
    if (!isNaN(d)) return d;
  }
  return null;
}

function parseDuration(input) {
  const str = String(input || '60m').trim().toLowerCase().replace(/\s/g, '');
  if (/^\d+h$/.test(str)) return parseInt(str) * 60;
  if (/^\d+m$/.test(str)) return parseInt(str);
  const n = parseInt(str); // si no trae sufijo, asume minutos
  return isNaN(n) ? 60 : n;
}

// ---- main ----
async function handleIncoming(change) {
  const msg = change.messages?.[0];
  const from = msg?.from;

  if (msg?.type === 'text') {
    const raw = (msg.text?.body || '').trim();
    const t = raw.toLowerCase();

    if (/(^|\b)(agenda|evento|cita)(\b|$)/.test(t)) {
      await sendText(from, 'Dime: título, fecha y hora. Ej: "Dentista, 2025-09-05 11:00, 60m, Altavista"');
      return;
    }

    // patrón "Título, fecha hora, duración, lugar"
    if (raw.includes(',')) {
      try {
        const [title, dateTimeStr, durationStr, location] = raw.split(',').map(x => x.trim());
        const start = parseDate(dateTimeStr);
        if (!start) {
          await sendText(from, 'No entendí la fecha/hora. Ejemplo: "Dentista, 2025-09-05 11:00, 60m, Altavista"');
          return;
        }
        const minutes = parseDuration(durationStr);
        const end = new Date(start.getTime() + minutes * 60000);

        await createEvent({ title, start, end, location });
        await sendText(from, `Listo. Evento creado: ${title} (${dayjs(start).format('YYYY-MM-DD HH:mm')} · ${minutes}m${location ? ` · ${location}` : ''}).`);
      } catch (e) {
        console.error(e);
        await sendText(from, 'No pude crear el evento. Intenta otra vez con el formato del ejemplo.');
      }
      return;
    }

    if (/(llamar|hazme una llamada|marca)/.test(t)) {
      await startClickToCall(process.env.USER_PRIMARY_NUMBER, from);
      await sendText(from, 'Te marco y conecto la llamada.');
      return;
    }

    await sendText(from, 'Aquí Félix. Puedo: 1) Agenda 2) Guardar documentos 3) Recordatorios 4) Llamadas.');
    return;
  }

  // Documento / Imagen => subir a OneDrive
  if (msg?.type === 'document' || msg?.type === 'image') {
    const media = change?.messages?.[0];
    const mediaId = media?.document?.id || media?.image?.id;
    const filename = media?.document?.filename || `imagen-${Date.now()}.jpg`;

    const metaUrl = `https://graph.facebook.com/v22.0/${mediaId}?access_token=${process.env.WHATSAPP_TOKEN}`;
    const r1 = await fetch(metaUrl);
    const j1 = await r1.json();
    const r2 = await fetch(j1.url);
    const buf = Buffer.from(await r2.arrayBuffer());

    const path = `/FELIX/${new Date().toISOString().slice(0,10)}/${filename}`;
    await uploadBufferToOneDrive(path, buf);
    await sendText(from, `Documento guardado en OneDrive: ${path}`);
    return;
  }
}

module.exports = { handleIncoming };
