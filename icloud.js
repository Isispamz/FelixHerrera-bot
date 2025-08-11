import * as dav from 'dav';

let cachedCalendar;

async function getAccount() {
  const xhr = new dav.transport.Basic(
    new dav.Credentials({
      username: process.env.ICLOUD_APPLE_ID,
      password: process.env.ICLOUD_APP_PASSWORD,
    })
  );

  const account = await dav.createAccount({
    server: process.env.ICLOUD_CALDAV_SERVER,
    xhr,
    loadCollections: true,
    loadObjects: false
  });
  return account;
}

async function getCalendar() {
  if (cachedCalendar) return cachedCalendar;
  const account = await getAccount();
  const cals = account.calendars || [];
  if (process.env.ICLOUD_CALENDAR_HREF) {
    cachedCalendar = cals.find(c => c.url.includes(process.env.ICLOUD_CALENDAR_HREF)) || cals[0];
  } else {
    cachedCalendar = cals[0];
  }
  if (!cachedCalendar) throw new Error('No se encontró calendario en iCloud (CalDAV).');
  return cachedCalendar;
}

export async function createEvent({ title, start, end, location }) {
  const calendar = await getCalendar();
  const vevent = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${Date.now()}@felix\nDTSTAMP:${toICS(start)}\nDTSTART:${toICS(start)}\nDTEND:${toICS(end)}\nSUMMARY:${escapeICS(title)}\n${location?`LOCATION:${escapeICS(location)}\n`:''}END:VEVENT\nEND:VCALENDAR`;

  await dav.createCalendarObject(calendar, {
    filename: `${Date.now()}.ics`,
    data: vevent,
  });
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
