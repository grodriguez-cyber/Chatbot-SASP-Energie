const express = require("express");
const bodyParser = require("body-parser");
const { MessagingResponse } = require("twilio").twiml;
const axios = require("axios");
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const sessions = {};

// =======================
// CONFIGURACIÓN
// =======================

const categorias = {
  "a": "🕳️ Bache",
  "b": "💡 Alumbrado",
  "c": "💧 Agua potable",
  "d": "🌳 Arbolado",
  "e": "🚧 Obra pública"
};

const numCategorias = {
  "a": 1,
  "b": 2,
  "c": 3,
  "d": 4,
  "e": 5
};

const detallesPorCategoria = {
  "🕳️ Bache": {
    pregunta: "🕳️ ¿Qué tan urgente es el bache?",
    opciones: {
      "a": "Leve (se puede esquivar)",
      "b": "Media (daña si no lo ves)",
      "c": "Alta (muy peligroso)"
    }
  },
  "💡 Alumbrado": {
    pregunta: "💡 ¿Qué ocurre con el alumbrado?",
    opciones: {
      "a": "No enciende",
      "b": "Está dañado",
      "c": "Permanece encendido de día"
    }
  },
  "💧 Agua potable": {
    pregunta: "💧 ¿Cómo es el problema del agua?",
    opciones: {
      "a": "Goteo constante",
      "b": "Fuga considerable",
      "c": "Sin suministro"
    }
  },
  "🌳 Arbolado": {
    pregunta: "🌳 ¿Qué situación presenta el árbol?",
    opciones: {
      "a": "Rama caída",
      "b": "Bloquea el paso",
      "c": "Riesgo de caer"
    }
  },
  "🚧 Obra pública": {
    pregunta: "🚧 ¿Cuál es el problema?",
    opciones: {
      "a": "Obra abandonada",
      "b": "Material obstruyendo",
      "c": "Daños a vialidad",
      "d": "Solicitud de obra"
    }
  }
};

// =======================
// ENDPOINT
// =======================

app.post("/whatsapp", async (req, res) => {
  const from = req.body.From;
  const msg = req.body.Body?.trim();
  const lat = req.body.Latitude;
  const lng = req.body.Longitude;

  if (!sessions[from]) sessions[from] = { step: 0 };
  const user = sessions[from];
  let reply = "";

  // =======================
  // COMANDOS GLOBALES
  // =======================
  const cmd = msg?.toLowerCase();

  if (cmd === "inicio") {
    sessions[from] = { step: 1 };
  
    reply = `👋 Hola!, soy tu ayuntamiento, para comenzar tu reportes contesta lo siguiente.
  
🅰️ Continuar
🅱️ Salir`;
  
    return send(res, reply);
  }

  if (cmd === "salir") {
    delete sessions[from];
    reply = "👋 Proceso cancelado. Escribe *inicio* para comenzar de nuevo.";
    return send(res, reply);
  }
    
  if (user.step === 0) {
    user.step = 1;
    reply = `👋 Hola, soy el bot de Reporte Ciudadano.

🅰️ Continuar
🅱️ Salir`;
    return send(res, reply);
  }

  // =======================
  // FLUJO PRINCIPAL
  // =======================
  switch (user.step) {

    // STATE 0 — WELCOME
    case 0:
      reply = `👋 Hola, soy el bot de Reporte Ciudadano.

🅰️ Continuar
🅱️ Salir`;
      user.step = 1;
      break;

    // STATE 1 — CATEGORY
    case 1:
      if (cmd !== "a") {
        reply = "❌ Escribe *A* para continuar o *SALIR*.";
        break;
      }

      reply = `📋 ¿Qué deseas reportar?

A) Bache
B) Alumbrado
C) Agua potable
D) Arbolado
E) Obra pública`;
      user.step = 2;
      break;

    // STATE 2 — CATEGORY SELECT
    case 2:
      if (!categorias[cmd]) {
        reply = "❌ Selecciona una letra de la A a la E.";
        break;
      }

      user.categoria = categorias[cmd];
      user.categoriaID = numCategorias[cmd];
      reply = `📍 Envía tu ubicación actual.

Presiona ➕ (iPhone) o 📎 (Android)
Luego selecciona *Ubicación*`;
      user.step = 3;
      break;

    // STATE 3 — LOCATION
    case 3:
      if (!lat || !lng) {
        reply = "⚠️ Necesito la ubicación GPS. Usa el botón 📍.";
        break;
      }

      user.lat = lat;
      user.lng = lng;

      const data = detallesPorCategoria[user.categoria];
      const opciones = Object.entries(data.opciones)
        .map(([k, v]) => `${k.toUpperCase()}) ${v}`)
        .join("\n");

      reply = `${data.pregunta}

${opciones}`;
      user.step = 4;
      break;

    // STATE 4 — DETAIL
    case 4:
      const opcionesDetalle = detallesPorCategoria[user.categoria].opciones;
      if (!opcionesDetalle[cmd]) {
        reply = "❌ Selecciona una opción válida.";
        break;
      }

      user.detalle = opcionesDetalle[cmd];

      reply = `📸 ¿Deseas enviar una foto?

🅰️ Enviar foto
🅱️ Omitir`;
      user.step = 5;
      break;

    // STATE 5 — PHOTO
    case 5:
      if (cmd === "a") {
        reply = "📷 Envía la foto ahora o escribe *OMITIR*.";
        user.step = 6;
        break;
      }

      if (cmd === "b") {
        user.foto = false;
        reply = contactoPregunta();
        user.step = 7;
        break;
      }

      reply = "❌ Responde A o B.";
      break;

    // STATE 6 — WAIT PHOTO
    case 6:
      if (req.body.NumMedia > 0) {
        user.foto = true;
      }
      reply = contactoPregunta();
      user.step = 7;
      break;

    // STATE 7 — CONTACT
    case 7:
      if (cmd === "a") {
        user.anonimo = false;
        user.telefono = from.replace("whatsapp:", "");
        user.nombre = "No proporcionado";
        reply = resumen(user);
        user.step = 8;
        break;
      }

      if (cmd === "b") {
        reply = "✍️ Escribe tu nombre:";
        user.step = 7.1;
        break;
      }

      if (cmd === "c") {
        user.anonimo = true;
        reply = resumen(user);
        user.step = 8;
        break;
      }

      reply = "❌ Selecciona A, B o C.";
      break;

    // STATE 7.1 — NAME
    case 7.1:
      user.nombre = msg;
      user.telefono = from.replace("whatsapp:", "");
      user.anonimo = false;
      reply = resumen(user);
      user.step = 8;
      break;

    // STATE 8 — CONFIRM
    case 8:
      if (cmd === "a") {
        try {
          const response = await enviarReporte(user);
          const folio = response.data.folio || `XAL-${Date.now()}`;
    
          reply = `✅ Reporte enviado correctamente.
    
    🆔 Folio: ${folio}
    
    Gracias por tu reporte.
    Escribe *INICIO* para crear otro.`;
        } catch (error) {
          console.error("Error enviando reporte:", error.message);
    
          reply = `❌ No se pudo registrar el reporte.
    Intenta nuevamente más tarde.`;
        }
    
        delete sessions[from];
        break;
      }
    
      reply = "❌ Proceso cancelado. Escribe *INICIO* para comenzar.";
      delete sessions[from];
      break;

    default:
      reply = "⚠️ Error inesperado. Escribe *INICIO*.";
      delete sessions[from];
  }

  send(res, reply);
});

// =======================
// HELPERS
// =======================
function contactoPregunta() {
  return `¿Deseas dejar datos para seguimiento?

A) Usar mi número de WhatsApp
B) Agregar nombre (opcional)
C) No (anónimo)`;
}

function resumen(user) {
  const mapa = `https://www.google.com/maps?q=${user.lat},${user.lng}`;
  return `📋 *Resumen del reporte*

📌 Tipo: ${user.categoria}
📍 Ubicación: ${mapa}
📝 Detalle: ${user.detalle}
📸 Foto: ${user.foto ? "Sí" : "No"}
👤 Anónimo: ${user.anonimo ? "Sí" : "No"}

A) Confirmar`;
}

function send(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.type("text/xml").send(twiml.toString());
}

async function enviarReporte(user) {
  return axios.post("https://138.201.173.117.nip.io/api/reports/whatsapp", {
    categoria: Number(user.categoriaID),
    detalle: user.detalle,
    ubicacion: {
      lat: user.lat,
      lng: user.lng
    },
    anonimo: user.anonimo,
    nombre: user.nombre || "Anonimo",
    telefono: user.telefono || 0,
  });
}
app.listen(process.env.PORT || 3000);
