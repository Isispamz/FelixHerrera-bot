// icloud.js — iCloud CalDAV via `dav`
// Crea eventos en el calendario de iCloud con entrada tolerante y validaciones.

const dav = require('dav');
const crypto = require('crypto');

// ---------- Config ----------
const SERVER = process.env.ICLOUD_CALDAV_URL || 'https://caldav.icloud.com';
const USERNAME = process.env.ICLOUD_USERNAME || '';
const PASSWORD = process.env.ICLOUD_APP_PASSWORD || '';
const CALENDAR_NAME = process.env.ICLOUD_CALENDAR_NAME || ''; // opcional

// ---------- Utils ----------
function pad(n) { return String(n).padStart(2, '0'); }

function formatUTC(dt) {
  // YYYYMMDDTHHMMSSZ
  const y = dt.getUTCFullYear();
  const m = pad(dt.getUTCMonth() + 1);
  const d = pad(dt.getUTCDate());
  const hh = pad(dt.getUTCHours());
  const mm = pad(dt.getUTCMinutes());
  const ss = pad(dt.getUTCSeconds());
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function ensureDate(x) {
  if (!x) return null;
  if (x instanceof Date && !isNaN(x)) return x;
  const try1 = new Date(x);
  if (!isNaN(try1)) return try1;
  return null;
}

function escapeICal(text = '') {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Crea un UID estable/único
function makeUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

// ---------- DAV session cache ----------
let _cache = {
  xhr: null,
  account: null,
  calendar: null,
  lastAt: 0
};

function makeTransport() {
  // `dav.transport.Basic` con credenciales
  const creds = new dav.Credentials({
    username: USERNAME,
    password: PASSWORD
  });
  return new dav.transport.Basic(creds);
}

async function resolveAccountAndCalendar() {
  const FRESH_MS = 15 * 60 * 1000; // 15 minutos
  const now = Date.now();

  if (_cache.account && _cache.calendar && (now - _cache.lastAt) < FRESH_MS) {
    return { xhr: _cache.xhr, account: _cache.account, calendar: _cache.calendar };
  }

  if (!USERNAME || !PASSWORD) {
    throw new Error('ICLOUD_USERNAME / ICLOUD_APP_PASSWORD no configurados.');
  }

  const xhr = makeTransport();

  // Descubrimiento de cuenta + colecciones
  const account = await dav.createAccount({
    server: SERVER,
    xhr,
    loadCollections: true,
    loadObjects: false
  });

  if (!account || !Array.isArray(account.calendars) || account.calendars.length === 0) {
    throw new Error('No se encontraron calendarios en la cuenta iCloud.');
  }

  // Selección de calendario
  let calendar = account.calendars[0];
  if (CALENDAR_NAME) {
    const byName = account.calendars.find(c => (c.displayName || '').toLowerCase() === CALENDAR_NAME.toLowerCase());
    if (byName) calendar = byName;
  }

  _cache = { xhr, account, calendar, lastAt: now };
  return { xhr, account, calendar };
}

// ---------- Normalización de entrada ----------
function normalizeEventInput(evt) {
  const title = (evt && evt.title) ? String(evt.title).trim() : 'Evento';
  const minutes = Math.max(1, parseInt(evt?.minutes, 10) || 60);
  const location = (evt && evt.location) ? String(evt.location).trim() : '';
  const description = (evt && evt.description) ? String(evt.description).trim() : '';

  // aceptar startDate | start | when | date
  const startCandidate = evt?.startDate || evt?.start || evt?.when || evt?.date;
  const startDate = ensureDate(startCandidate);
  if (!startDate) {
    throw new Error('startDate/start/when/date inválido o ausente.');
  }

  // endDate opcional; si no, lo calculamos con minutes
  let endDate = ensureDate(evt?.endDate);
  if (!endDate) {
    endDate = new Date(startDate.getTime() + minutes * 60000);
  }

  return { title, minutes, location, description, startDate, endDate };
}

// ---------- ICS builder ----------
function buildICS({ title, startDate, endDate, location, description }) {
  const uid = makeUID();
  const dtstamp = formatUTC(new Date());
  const dtstart = formatUTC(startDate);
  const dtend = formatUTC(endDate);

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//FelixHerrera-bot//iCloud//ES',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeICal(title)}`,
  ];

  if (location) lines.push(`LOCATION:${escapeICal(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeICal(description)}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return { uid, ics: lines.join('\r\n') };
}

// ---------- API principal ----------
/**
 * createEvent({ title, startDate|start|when|date, minutes?, endDate?, location?, description? })
 * @returns {Promise<{uid:string, href:string}>}
 */
async function createEvent(evt) {
  // Normaliza entrada (lanza si no hay fecha válida)
  const norm = normalizeEventInput(evt);

  // Carga cuenta y calendario
  const { xhr, calendar } = await resolveAccountAndCalendar();

  // Construye ICS
  const { uid, ics } = buildICS(norm);
  const filename = `${uid}.ics`;

  // Crea el objeto en el calendario
  const res = await dav.createCalendarObject(calendar, {
    data: ics,
    filename,
    xhr // pasar el transport explícitamente
  });

  // `res` puede ser undefined según versión; devolvemos datos útiles
  const href = (res && (res.href || res.url)) || `${calendar.url.replace(/\/+$/, '')}/${filename}`;
  return { uid, href };
}

module.exports = { createEvent };
