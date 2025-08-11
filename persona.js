// persona.js — tono Alfred + JARVIS, dirigido a "señorita"
const dayjs = require('dayjs');

const HONORIFIC = 'señorita';

function fmtStart(d) {
  try { return dayjs(d).format('YYYY-MM-DD HH:mm'); }
  catch { return String(d); }
}

function withVars(str, vars = {}) {
  return str
    .replace(/\{sir\}/g, HONORIFIC)
    .replace(/\{title\}/g, vars.title ?? '')
    .replace(/\{minutes\}/g, vars.minutes ?? '')
    .replace(/\{location\}/g, vars.location ? ` · ${vars.location}` : '')
    .replace(/\{startISO\}/g, vars.start ? fmtStart(vars.start) : '');
}

function t(key, vars = {}) {
  const M = {
    hello:
      'A su servicio, {sir}. ¿En qué le ayudo?',
    generic_help:
      'Claro, {sir}. Puedo crear citas con lenguaje natural. Ej: “Dentista mañana 11am 1h en Altavista”. También tengo /comandos.',
    agenda_help:
      'Por supuesto, {sir}. Envíeme: “título + fecha/hora + duración + lugar”. Ej: “Comida, viernes 2:30pm, 90m, @Roma”.',
    parse_fail_date:
      'No logré entender la fecha/hora, {sir}. Ejemplos: “hoy 6pm 45m @Roma”, “5/9 14:00 90m @Condesa”.',
    event_created:
      'Listo, {sir}. Evento creado: {title} ({startISO} · {minutes}m{location}).',
    file_saved:
      'Archivo guardado con éxito, {sir}: {title}.',
    calling:
      'Enseguida, {sir}. Llamando al {title}…',
    commands:
      'Comandos disponibles, {sir}:\n' +
      '• /comandos — ver esta lista\n' +
      '• /agenda — guía rápida para crear eventos\n' +
      '• /plantilla — ejemplo de formato\n' +
      '• /cc <número> — click-to-call (ej: /cc 55 1234 5678)\n' +
      '• /ping — comprobar que estoy en línea',
    plantilla:
      'Ejemplo: “Dentista mañana 11am 1h en Altavista” o “Café, 5/9 14:00, 45m, @Roma”.',
    pong:
      'En línea y atento, {sir}.'
  };
  return withVars(M[key] ?? '', vars);
}

module.exports = { HONORIFIC, t };
