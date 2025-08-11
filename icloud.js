// icloud.js — iCloud CalDAV helpers (crear, listar, buscar, actualizar, borrar)

const dav = require('dav');
const url = require('url');

const USER = process.env.ICLOUD_USERNAME;
const PASS = process.env.ICLOUD_APP_PASSWORD;
const CAL_URL = process.env.ICLOUD_CALENDAR_URL || ''; // opcional

if (!USER || !PASS) {
  throw new Error('ICLOUD_USERNAME / ICLOUD_APP_PASSWORD no configurados.');
}

async function getAccount() {
  const xhr = new dav.transport.Basic(
    new dav.Credentials({ username: USER, password: PASS })
  );
  const account = await dav.createAccount({
    server: 'https://caldav.icloud.com',
    xhr,
    loadCollections: true,
    loadObjects: false,
  });
  return { xhr, account };
}

function pickCalendar(collections) {
  if (CAL_URL) {
    const match = collections.find(c => (c && c.url && c.url.includes(CAL_URL)));
    if (match) return match;
  }
  // fallback: primer calendario "writable"
  return collections.find(c => c.components?.includes('VEVENT')) || collections[0];
}

function toISOZ(d) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildICS({ uid, title, start, minutes = 60, location = '' }) {
  const startISO = toISOZ(start);
  const endISO = toISOZ(new Date(new Date(start).getTime() + minutes * 60000));
  const dtstamp = toISOZ(new Date());
  const _uid = uid || `${Date.now()}-${Math.random().toString(36).slice(2)}@felixbot`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//felixbot//iCloud CalDAV//EN',
    'BEGIN:VEVENT',
    `UID:${_uid}`,
    `DTSTAMP:${dtstamp.replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,
    `DTSTART:${startISO.replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,
    `DTEND:${endISO.replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,
    `SUMMARY:${title}`,
    location ? `LOCATION:${location}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].filter(Boolean).join('\r\n');
}

function parseICS(ics) {
  // parsing muy ligero; suficiente para listar/mover/cancelar
  const get = (re) => (ics.match(re) || [,''])[1].trim();
  const uid = get(/\nUID:([^\r\n]+)/i);
  const summary = get(/\nSUMMARY:([^\r\n]+)/i) || 'Evento';
  const location = get(/\nLOCATION:([^\r\n]+)/i) || '';
  const dtstart = get(/\nDTSTART(?:;[^:]+)?:([^\r\n]+)/i);
  const dtend = get(/\nDTEND(?:;[^:]+)?:([^\r\n]+)/i);

  const toDate = (s) => {
    // soporta YYYYMMDDTHHmmssZ
    const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
    // (si tuvieras DTSTART;VALUE=DATE usa medianoche)
  };

  const start = toDate(dtstart);
  const end = toDate(dtend);
  const minutes = (start && end) ? Math.max(1, Math.round((end - start)/60000)) : 60;
  return { uid, title: summary, start, end, minutes, location };
}

// ---------- API pública ----------

async function createEvent({ title, start, minutes = 60, location = '' }) {
  const { xhr, account } = await getAccount();
  const cal = pickCalendar(account.calendars || account.collections || []);
  if (!cal) throw new Error('No encontré un calendario en iCloud.');

  const ics = buildICS({ title, start, minutes, location });
  await dav.createCalendarObject(cal, { data: ics, xhr });
  return true;
}

async function listEvents({ from, to }) {
  const { xhr, account } = await getAccount();
  const cal = pickCalendar(account.calendars || account.collections || []);
  if (!cal) throw new Error('No encontré un calendario en iCloud.');

  // pidiendo objetos en rango
  const objects = await dav.listCalendarObjects(cal, {
    xhr,
    timeRange: { start: from, end: to },
    expand: true
  });

  const events = [];
  for (const obj of objects || []) {
    try {
      const ics = obj?.data || '';
      const parsed = parseICS(ics);
      if (parsed?.start) {
        parsed.href = obj?.url; // para update/delete
        events.push(parsed);
      }
    } catch (_) {}
  }
  // orden cronológico
  events.sort((a,b) => (a.start - b.start));
  return events;
}

async function findEventByTitle(query, { from, to }) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  const list = await listEvents({ from, to });
  // heurística: incluye título y el más próximo en el tiempo
  const candidates = list.filter(ev => ev.title.toLowerCase().includes(q));
  return candidates[0] || null;
}

async function deleteEvent(event) {
  if (!event?.href) throw new Error('Evento sin href para borrar.');
  const { xhr } = await getAccount();
  await dav.deleteCalendarObject(event.href, { xhr });
  return true;
}

async function updateEvent(event, { start, minutes, location }) {
  if (!event?.href) throw new Error('Evento sin href para actualizar.');
  const { xhr } = await getAccount();
  const ics = buildICS({
    uid: event.uid,
    title: event.title,
    start,
    minutes: minutes || event.minutes || 60,
    location: (location != null ? location : event.location) || ''
  });
  await dav.updateCalendarObject(event.href, { data: ics, xhr });
  return true;
}

module.exports = {
  createEvent,
  listEvents,
  findEventByTitle,
  updateEvent,
  deleteEvent
};
