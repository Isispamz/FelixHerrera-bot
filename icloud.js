// icloud.js — Crear eventos en iCloud vía CalDAV
// Soporta dos caminos:
// 1) DIRECTO con ICLOUD_CAL_URL -> PUT del ICS directo
// 2) Descubrimiento con 'dav' si no se proporciona la URL

const crypto = require('crypto');

// Entorno
const USER = process.env.ICLOUD_USERNAME || '';
const PASS = process.env.ICLOUD_APP_PASSWORD || '';
const DIRECT_URL = process.env.ICLOUD_CAL_URL || process.env.ICLOUD_CALENDAR_URL || '';
const CALDAV_BASE = process.env.ICLOUD_CALDAV_BASE || 'https://caldav.icloud.com';

// Node 20+ tiene fetch global
const hasFetch = typeof fetch === 'function';

// Carga perezosa de 'dav' sólo si hace falta
let dav = null;

// ---------- utilidades ----------
function ensureCreds() {
  if (!USER || !PASS) {
    const msg = 'ICLOUD_USERNAME / ICLOUD_APP_PASSWORD no configurados.';
    console.error('[icloud]', msg);
    throw new Error(msg);
  }
}

function toICSDate(d) {
  const iso = new Date(d).toISOString(); // 2025-08-11T17:00:00.000Z
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); // 20250811T170000Z
}

function buildICS({ uid, title, start, end, location }) {
  const now = toICSDate(new Date());
  const dtStart = toICSDate(start);
  const dtEnd = toICSDate(end);

  // Líneas plegadas según RFC 5545 (simple, sin pliegues por longitud)
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FelixHerreraBot//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${(title || 'Evento').replace(/\r?\n/g, ' ')}`,
    location ? `LOCATION:${location.replace(/\r?\n/g, ' ')}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].filter(Boolean).join('\r\n');
}

function normalizeDate({ start, startDate, minutes }) {
  const s = startDate || start;
  if (!s) throw new Error('start/startDate requerido');
  const startObj = new Date(s);
  if (isNaN(startObj)) throw new Error('Fecha de inicio inválida');
  const dur = Number.isFinite(minutes) ? minutes : 60;
  const endObj = new Date(startObj.getTime() + dur * 60000);
  return { startObj, endObj, minutes: dur };
}

function buildAuthHeader(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function ensureTrailingSlash(u) {
  return /\/$/.test(u) ? u : (u + '/');
}

// ---------- PUT directo ----------
async function putICSDirect(collectionUrl, ics, uid) {
  if (!hasFetch) throw new Error('fetch no está disponible en este entorno.');
  if (!collectionUrl || typeof collectionUrl !== 'string') {
    throw new Error("ICLOUD_CAL_URL inválida: se esperaba una string con la colección CalDAV");
  }
  const base = ensureTrailingSlash(collectionUrl);
  const resourceUrl = base + encodeURIComponent(`${uid}.ics`);

  const res = await fetch(resourceUrl, {
    method: 'PUT',
    headers: {
      'Authorization': buildAuthHeader(USER, PASS),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*', // crea sólo si no existe
    },
    body: ics,
  });

  if (res.status >= 200 && res.status < 300) return true;

  const text = await res.text().catch(() => '');
  throw new Error(`CalDAV PUT falló (${res.status}): ${text.slice(0, 200)}`);
}

// ---------- Descubrimiento con 'dav' ----------
async function discoverCalendarUrl() {
  if (!dav) {
    try { dav = require('dav'); }
    catch (e) {
      console.error('[icloud] No se pudo cargar "dav". Instálelo con "npm i dav" o use ICLOUD_CAL_URL.');
      throw e;
    }
  }

  const xhr = new dav.transport.Basic(
    new dav.Credentials({ username: USER, password: PASS })
  );

  const account = await dav.createAccount({
    server: CALDAV_BASE,
    xhr,
    loadCollections: true,
    loadObjects: false,
  });

  const cals = account?.calendars || [];
  console.log('[icloud] descubiertos', cals.map(c => ({
    name: c.displayName, url: c.url,
  })));

  // Heurística: el primero o uno con “Home/Calendario/Calendar”
  const preferred =
    cals.find(c => /home|calendar|calendario/i.test(c.displayName || '')) ||
    cals[0];

  return preferred?.url || null;
}

async function putICSViaDav(calendarUrl, ics, uid) {
  const xhr = new dav.transport.Basic(
    new dav.Credentials({ username: USER, password: PASS })
  );

  // createObject necesita la URL de la colección
  if (!calendarUrl || typeof calendarUrl !== 'string') {
    throw new Error("No se obtuvo URL de calendario (descubrimiento vacío). Defina ICLOUD_CAL_URL.");
  }

  await dav.createObject(xhr, calendarUrl, {
    data: ics,
    filename: `${uid}.ics`,
    contentType: 'text/calendar; charset=utf-8',
  });

  return true;
}

// ---------- API principal ----------
async function createEvent({ title, start, startDate, minutes, location }) {
  ensureCreds();

  const { startObj, endObj, minutes: dur } = normalizeDate({ start, startDate, minutes });
  const uid = crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2));
  const ics = buildICS({ uid, title, start: startObj, end: endObj, location });

  console.log('[router] createEvent -> {',
    `title: '${title}',`,
    `startISO: '${startObj.toISOString()}',`,
    `minutes: ${dur},`,
    `location: '${location || ''}'`,
    '}'
  );

  // 1) Intento directo si tenemos ICLOUD_CAL_URL
  if (DIRECT_URL) {
    return putICSDirect(DIRECT_URL, ics, uid);
  }

  // 2) Descubrimiento con dav
  const calUrl = await discoverCalendarUrl();
  if (!calUrl) {
    const msg = 'No se encontró ninguna colección CalDAV. Por favor configure ICLOUD_CAL_URL (termina en "/").';
    console.error('[icloud]', msg);
    throw new Error(msg);
  }

  return putICSViaDav(calUrl, ics, uid);
}

module.exports = { createEvent };
