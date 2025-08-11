// persona.js — tono Alfred + JARVIS (en español), tratando a la usuaria como "señorita"

const USER_TITLE = "señorita";

function t(key, vars = {}) {
  const v = (k, d = "") => (vars && vars[k] != null ? String(vars[k]) : d);

  switch (key) {
    // saludos / ayuda
    case "hello":
      return `A sus órdenes, ${USER_TITLE}. ¿Desea agendar, mover o cancelar algo?`;
    case "generic_help":
      return `Claro, ${USER_TITLE}. Puedo crear eventos (“Dentista mañana 11am 1h en Altavista”), listar (“qué tengo mañana”), mover (“mueve dentista a viernes 12:00”) o cancelar (“cancela dentista”).`;
    case "agenda_help":
      return `Con gusto, ${USER_TITLE}. Ejemplos:
• Dentista mañana 11am 1h en Altavista
• Comida, 5/9 14:00, 90m, @Roma
• qué tengo hoy / mañana / esta semana
• mueve dentista a viernes 12:00
• cancela dentista`;

    // creación
    case "event_created":
      return `Listo, ${USER_TITLE}. Evento creado: ${v("title")} (${v("whenStr")} · ${v("durStr")}${v("locationStr")}).`;

    // listar
    case "list_header":
      return `Esto es lo que tiene, ${USER_TITLE}:`;
    case "list_empty":
      return `No encuentro nada en ese rango, ${USER_TITLE}.`;
    case "list_item":
      // { whenStr, title, durStr, locationStr }
      return `• ${v("whenStr")}: ${v("title")} (${v("durStr")}${v("locationStr")})`;

    // mover
    case "move_ok":
      return `Reprogramado, ${USER_TITLE}: “${v("title")}” a ${v("whenStr")} (${v("durStr")}${v("locationStr")}).`;
    case "move_ask_title":
      return `¿Qué evento desea mover, ${USER_TITLE}? Por ejemplo: “mueve dentista a viernes 12:00”.`;
    case "move_ask_when":
      return `¿A qué fecha/hora lo movemos, ${USER_TITLE}? Por ejemplo: “mueve dentista a mañana 5pm”.`;
    case "move_not_found":
      return `No encuentro un evento que coincida con “${v("query")}”, ${USER_TITLE}.`;

    // cancelar
    case "cancel_ok":
      return `Hecho, ${USER_TITLE}. Evento “${v("title")}” cancelado.`;
    case "cancel_ask_title":
      return `¿Cuál desea cancelar, ${USER_TITLE}? Por ejemplo: “cancela dentista”.`;
    case "cancel_not_found":
      return `No encuentro un evento que coincida con “${v("query")}”, ${USER_TITLE}.`;

    // errores
    case "parse_fail_date":
      return `No pude entender la fecha/hora. ¿Podría dictármela como en los ejemplos, ${USER_TITLE}?`;
    case "oops":
      return `Ha ocurrido un detalle inesperado, pero sigo aquí, ${USER_TITLE}.`;

    // llamadas / archivos (opcionales)
    case "calling":
      return `Marcando ${v("num")}, ${USER_TITLE}.`;
    case "file_saved":
      return `Archivo guardado (${v("name")}), ${USER_TITLE}.`;

    default:
      return `Entendido, ${USER_TITLE}.`;
  }
}

module.exports = { t };
