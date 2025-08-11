import fetch from 'node-fetch';
import dayjs from 'dayjs';
import { sendText } from './send.js';
import { createEvent } from './icloud.js';
import { uploadBufferToOneDrive } from './onedrive.js';
import { startClickToCall } from './twilio.js';

export async function handleIncoming(change) {
  const msg = change.messages?.[0];
  const from = msg?.from;

  if (msg?.type === 'text') {
    const t = msg.text.body.trim().toLowerCase();

    if (/(agenda|evento|cita)/.test(t)) {
      await sendText(from, 'Dime: título, fecha y hora. Ej: "Dentista, 5 sept 11:00, 1h, Altavista"');
      return;
    }

    // Ejemplo simple: "Dentista, 5 sept 11:00, 1h, Altavista"
    if (/\d/.test(t) && t.includes(',')) {
      try {
        const [title, dateTime, duration, location] = t.split(',').map(x => x.trim());
        const start = dayjs(dateTime).toDate();
        const minutes = parseInt((duration || '60').replace(/\D/g,'')) || 60;
        const end = new Date(start.getTime() + minutes * 60000);
        await createEvent({ title, start, end, location });
        await sendText(from, `Listo. Evento creado: ${title} (${dateTime}, ${duration||'60m'}).`);
      } catch (e) {
        console.error(e);
        await sendText(from, 'No pude entender la fecha/hora. Mándalo como en el ejemplo, porfa.');
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
