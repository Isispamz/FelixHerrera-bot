const dav = require('dav');

let cached = { xhr: null, calendar: null };

function getXhr() {
  if (!cached.xhr) {
    cached.xhr = new dav.transport.Basic({
      username: process.env.ICLOUD_APPLE_ID,
      password: process.env.ICLOUD_APP_PASSWORD,
    });
  }
  return cached.xhr;
}

async function getCalendar() {
  if (cached.calendar) return cached.calendar;
  const xhr = getXhr();
  const account = await dav.createAccount({
    server: process.env.ICLOUD_CALDAV_SERVER || 'https://caldav.icloud.com',
    xhr,
    loadCollections: true,
    loadObjects: false,
  });
  const cals = account.calendars || [];
  // Usa el primero o el que coincida con ICLOUD_CALENDAR_HREF
  const href = process.env.ICLOUD_CALENDAR_HREF;
  cached.calendar = href ? (cals.find(c => c.url.includes(href)) || cals[0]) : cals[0];
  if (!cached.calendar) throw new Error('No se encontró un calendario en iCloud.');
  return cached.calendar;
}

function toICS(d){
  const pad = n => String(n).padStart(2,'0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth()+1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}
function escapeICS(s){
  return String(s).replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}

async function createEvent({ title, start, end, location }) {
 function createEvent({ title, start, minutes = 60, location = '' }) {
  // Normaliza 'start' a Date SIEMPRE
  if (!(start instanceof Date)) start = new Date(start);
  if (isNaN(start)) throw new Error('Invalid start date');

  const end = new Date(start.getTime() + minutes * 60000);

  // Helper para iCal UTC: YYYYMMDDTHHMMSSZ
  const toICS = (d) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  // (opcional) log defensivo para ver qué llega
  console.log('[icloud] createEvent normalized:', {
    startISO: start.toISOString(),
    minutes,
    title,
    location,
  });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FelixHerreraBot//iCloud//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@felixherrera-bot`,
    `DTSTAMP:${toICS(new Date())}`,
    `DTSTART:${toICS(start)}`,
    `DTEND:${toICS(end)}`,
    `SUMMARY:${title}`,
    location ? `LOCATION:${location}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].filter(Boolean).join('\r\n');

  // …a partir de aquí, lo que ya tenías para subir via CalDAV/dav.createCalendarObject
}
  const xhr = getXhr();
  const calendar = await getCalendar();
  const vevent =
`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:${Date.now()}@felix
DTSTAMP:${toICS(start)}
DTSTART:${toICS(start)}
DTEND:${toICS(end)}
SUMMARY:${escapeICS(title)}
${location ? `LOCATION:${escapeICS(location)}\n` : ''}END:VEVENT
END:VCALENDAR`;

  await dav.createCalendarObject(calendar, {
    filename: `${Date.now()}.ics`,
    data: vevent,
    xhr, // <-- ¡clave!
  });
}

module.exports = { createEvent };
