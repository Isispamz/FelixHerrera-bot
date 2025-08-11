// persona.js — voz "Alfred + JARVIS": mayordomo británico + IA precisa
function pad(n){ return String(n).padStart(2,'0'); }
function fmtDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
const sometimes = (p)=> Math.random()<p;

const style = {
  codename: 'Félix',
  address: process.env.PERSONA_ADDRESS || 'señorita',
  emojiLevel: Number(process.env.PERSONA_EMOJI || 0)  // 0 sobrio, 1 sutil
};

const E = { ok:['✓','✔︎','—listo'], hint:['ℹ︎','⟲','…'], ping:['◦','•'] };
const e = (k)=> style.emojiLevel>0 ? ' '+pick(E[k]) : '';

const quips = {
  ack: ['Muy bien.','Enseguida.','Con mucho gusto.','Procedo de inmediato.'],
  failDate: ['Temo que la fecha/hora no fue clara.','No logro inferir la hora con certeza.'],
  help: ['Puedo coordinar su agenda, documentos y llamadas.','Indíqueme y lo resuelvo.']
};

const T = {
  hello: () => `${style.codename} a su servicio, ${style.address}. ¿En qué le asisto hoy?${e('ping')}`,
  agenda_help: () => `${pick(quips.ack)} Indíqueme algo como: "Dentista mañana 11am 1h en Altavista" o "Comida, 5 sep 14:00, 90m, @Roma". Si omite duración usaré 60m.${e('hint')}`,
  event_created: ({ title, start, minutes, location }) =>
    `${pick(['Hecho','Completado','Agendado'])}. ${title} — ${fmtDate(start)} · ${minutes}m${location ? ' · ' + location : ''}.${e('ok')}`,
  parse_fail_date: () =>
    `${pick(quips.failDate)} Ejemplos válidos: "Reunión mañana 10am 45m en oficina", "Café, 5/9 18:00, 30m, @Condesa".`,
  generic_help: () => `${pick(quips.help)} Escriba "agenda" para instrucciones rápidas.`,
  file_saved: (path) => `Archivo resguardado en OneDrive: ${path}.${e('ok')}`,
  calling: (to) => `Estableciendo llamada y conectando con ${to}.${e('ping')}`,
  tick: () => sometimes(0.2) ? `Listo para más instrucciones.${e('ping')}` : ''
};

module.exports = {
  t: (key, vars) => (T[key] ? [T[key](vars||{}), T.tick()].filter(Boolean).join(' ') : key),
  fmtDate, style
};
