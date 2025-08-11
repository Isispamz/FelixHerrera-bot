// icloud.js — Crear eventos en iCloud vía CalDAV
// Camino 1: DIRECTO con ICLOUD_CAL_URL -> PUT del ICS
// Camino 2: Descubrimiento + dav.createCalendarObject

const crypto = require('crypto');

const USER = process.env.ICLOUD_USERNAME || '';
const PASS = process.env.ICLOUD_APP_PASSWORD || '';
const DIRECT_URL = process.env.ICLOUD_CAL_URL || process.env.ICLOUD_CALENDAR_URL || '';
const CALDAV_BASE = process.env.ICLOUD_CALDAV_BASE || 'https://caldav.icloud.com';

const hasFetch = typeof fetch === 'function';
let dav = null;

// -------- helpers --------
function ensureCreds() {
  if (!USER || !PASS) {
    const msg = 'ICLOUD_USERNAME / ICLOUD_APP_PASSWORD no configurados.';
    console.error('[icloud]', msg);
    throw new Error(msg);
  }
}

function toICSDate(d) {
  const iso = new Date(d).toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); // 20250811T170000Z
}

function buildICS({ uid, title, start, end, location }) {
  const now = toICSDate(new Date());
  const dtStart = toICSDate(start);
  const dtEnd = toICSDate(end);

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

function ensureSlash(u) {
  return /\/$/.test(u) ? u : (u + '/');
}

// -------- PUT directo (sin dav) --------
async function putICSDirect(collectionUrl, ics, uid) {
  if (!hasFetch) throw new Error('fetch no está disponible en este entorno.');
  if (!collectionUrl || typeof collectionUrl !== 'string') {
    throw new Error('ICLOUD_CAL_URL inválida (se esperaba string con / final).');
  }
  const base = ensureSlash(collectionUrl);
  const resourceUrl = base + encodeURIComponent(`${uid}.ics`);

  const res = await fetch(resourceUrl, {
    method: 'PUT',
    headers: {
      'Authorization': buildAuthHeader(USER, PASS),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',
    },
    body: ics,
  });

  if (res.ok) return true;

  const text = await res.text().catch(() => '');
  throw new Error(`CalDAV PUT falló (${res.status}): ${text.slice(0, 200)}`);
}

// -------- Descubrimiento + createCalendarObject --------
async function discoverWithDav() {
  if (!dav) {
    try { dav = require('dav'); }
    catch (e) {
      console.error('[icloud] No se pudo cargar "dav". Instale con "npm i dav" o use ICLOUD_CAL_URL.');
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

  const calendars = account?.calendars || [];
  console.log('[icloud] descubiertos', calendars.map(c => ({ name: c.displayName, url: c.url })));

  const preferred =
    calendars.find(c => /home|calendar|calendario/i.test(c.displayName || '')) ||
    calendars[0];

  if (!preferred) {
    throw new Error('No se encontró ninguna colección CalDAV. Configure ICLOUD_CAL_URL.');
  }

  return { calendar: preferred, xhr };
}

async function createViaDav(calendar, xhr, ics /*, uid */) {
  // En varios builds de "dav" no existe createObject; el correcto es createCalendarObject
  // filename es opcional; many servers lo ignoran.
  await dav.createCalendarObject(calendar, {
    data: ics,
    xhr,
    // filename: `${uid}.ics`,
  });
  return true;
}

// -------- API principal --------
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

  // Camino 1: directo si tenemos ICLOUD_CAL_URL
  if (DIRECT_URL) {
    return putICSDirect(DIRECT_URL, ics, uid);
  }

  // Camino 2: descubrimiento + createCalendarObject
  const { calendar, xhr } = await discoverWithDav();
  return createViaDav(calendar, xhr, ics /*, uid */);
}

module.exports = { createEvent };
