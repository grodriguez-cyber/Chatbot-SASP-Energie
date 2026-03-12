const express = require("express");
const bodyParser = require("body-parser");
const { MessagingResponse } = require("twilio").twiml;
// const axios = require("axios"); // Descomentar cuando conecten el backend
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Memoria temporal para sesiones (Máquina de estados)
const sessions = {};
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutos en milisegundos

// =======================
// CONFIGURACIÓN SASP
// =======================
const tiposCotizacion = {
  "a": "☀️ Solar",
  "b": "🔋 Baterías",
  "c": "📊 Diagnóstico"
};

// =======================
// ENDPOINT PRINCIPAL
// =======================
app.post("/whatsapp", async (req, res) => {
  const from = req.body.From;
  const msg = req.body.Body?.trim();
  const lat = req.body.Latitude;
  const lng = req.body.Longitude;
  const mediaUrl = req.body.NumMedia > 0 ? req.body.MediaUrl0 : null; 

  // Control de Inactividad (Timeout)
  if (sessions[from] && (Date.now() - sessions[from].lastActivity > SESSION_TIMEOUT)) {
    delete sessions[from]; 
  }

  if (!sessions[from]) {
    sessions[from] = { step: 0, intentos: 0 };
  }
  
  const user = sessions[from];
  user.lastActivity = Date.now(); // Actualizar timestamp de actividad
  let reply = "";

  // =======================
  // COMANDOS GLOBALES
  // =======================
  const cmd = msg?.toLowerCase();

  if (cmd === "menu") {
    sessions[from] = { step: 1, lastActivity: Date.now() };
    reply = `👋 Hola, soy SASP | Energie Consultores.

¿Cómo deseas ingresar?

A) CLIENTE
B) PERSONAL
C) ASESOR`;
    return send(res, reply);
  }

  if (cmd === "salir") {
    delete sessions[from];
    reply = "👋 Sesión finalizada. Escribe *MENU* para comenzar de nuevo.";
    return send(res, reply);
  }
    
  if (user.step === 0) {
    user.step = 1;
    reply = `👋 Hola, soy SASP | Energie Consultores.

¿Cómo deseas ingresar?

A) CLIENTE
B) PERSONAL
C) ASESOR`;
    return send(res, reply);
  }

  // =======================
  // FLUJO PRINCIPAL
  // =======================
  switch (user.step) {

    // STATE 1 — FILTRO DE ENTRADA (S0)
    case 1:
      if (cmd === "a" || cmd === "cliente") {
        reply = `¿Qué necesitas?

🅰️ COTIZAR
🅱️ SOPORTE`;
        user.step = 10; 
      } else if (cmd === "b" || cmd === "personal") {
        reply = `🔒 Acceso PERSONAL. Ingresa tu CLAVE de usuario:`;
        user.step = 300; 
      } else if (cmd === "c" || cmd === "asesor") {
        reply = `👤 Por favor, escribe tu nombre para que un asesor te contacte:`;
        user.step = 400; 
      } else {
        reply = "❌ Por favor selecciona A, B o C.";
      }
      break;

    // ==========================================
    // RAMA 10: CLIENTE - MENÚ (C1)
    // ==========================================
    case 10:
      if (cmd === "a" || cmd === "cotizar") {
        reply = `📋 ¿Qué tipo de cotización buscas?

A) SOLAR
B) BATERÍAS
C) DIAGNÓSTICO`;
        user.step = 100; 
      } else if (cmd === "b" || cmd === "soporte") {
        reply = `🛠️ Escribe tu número de FOLIO de 4 dígitos, o escribe *NUEVO* si no tienes folio:`;
        user.step = 200; 
      } else {
        reply = "❌ Selecciona A (COTIZAR) o B (SOPORTE).";
      }
      break;

    // ==========================================
    // RAMA 100: CLIENTE -> COTIZAR
    // ==========================================
    case 100: // C2 - Tipo
      if (!tiposCotizacion[cmd]) {
        reply = "❌ Selecciona A, B o C.";
        break;
      }
      user.cotizacionTipo = tiposCotizacion[cmd];
      reply = `✍️ Por favor, escribe tu Nombre completo, Teléfono y Correo electrónico (opcional):
Ejemplo: Juan Pérez, 5551234567, juan@correo.com`;
      user.step = 101;
      break;

    case 101: // C3 - Datos
      user.datosContacto = msg; // Guarda toda la cadena proporcionada
      user.telefonoWa = from.replace("whatsapp:", "");
      reply = `📍 Envía la ubicación (Share Location) donde se requiere el servicio.

Presiona ➕ o 📎 y selecciona *Ubicación*.`;
      user.step = 102;
      break;

    case 102: // C4 - Ubicación
      if (!lat || !lng) {
        reply = "⚠️ Necesito la ubicación GPS. Usa el botón 📍.";
        break;
      }
      user.lat = lat;
      user.lng = lng;

      // C5 - Evidencia según tipo
      if (user.cotizacionTipo === "☀️ Solar") {
        reply = `📸 Por favor envía una FOTO de tu recibo de CFE (o PDF), o escribe *SIN RECIBO*.`;
      } else if (user.cotizacionTipo === "🔋 Baterías") {
        reply = `🔋 ¿Cuál es tu objetivo? (ej. Respaldo, Aislado, Híbrido) y qué cargas/equipos quieres conectar:`;
      } else {
        reply = `📊 ¿Cuál es el giro de tu inmueble y tu pago aprox. mensual a CFE?`;
      }
      user.step = 103;
      break;

    case 103: // C5 Captura de evidencia o texto
      if (user.cotizacionTipo === "☀️ Solar" && mediaUrl) {
        user.evidencia = "RECIBO_CFE";
        user.media = mediaUrl;
      } else {
        user.evidencia = msg; 
      }

      reply = resumenCotizacion(user);
      user.step = 104;
      break;

    case 104: // C6 - Confirmación y Regla de Siguiente Paso
      if (cmd === "a") {
        const folio = Math.floor(1000 + Math.random() * 9000); 
        
        // Evaluar estatus inicial (Regla post-captura)
        let mensajeCierre = "";
        if (user.cotizacionTipo === "☀️ Solar" && user.evidencia === "RECIBO_CFE") {
          mensajeCierre = "Te enviaremos PRE-COTIZACION vía WhatsApp pronto.";
        } else {
          mensajeCierre = "Te llamaremos para completar información.";
        }

        reply = `✅ Registrado. Tu folio es *${folio}*.

${mensajeCierre}
Escribe *MENU* para volver al inicio.`;
        delete sessions[from];
      } else {
        reply = "❌ Proceso cancelado. Escribe *MENU*.";
        delete sessions[from];
      }
      break;

    // ==========================================
    // RAMA 200: CLIENTE -> SOPORTE
    // ==========================================
    case 200: // S2 - Identificación recibida
      user.folioSoporte = msg; 
      reply = `🛠️ ¿Qué tipo de soporte necesitas?

A) SEGUIMIENTO
B) FALLA
C) FACTURA
D) GARANTÍA
E) OTRO`;
      user.step = 201;
      break;

    case 201: // S3 - Reglas por tipo de soporte
      if (cmd === "a" || cmd === "seguimiento") {
        const folioDisplay = user.folioSoporte.toLowerCase() === "nuevo" ? "asignado" : user.folioSoporte;
        reply = `✅ Listo, seguimos con tu folio ${folioDisplay}.

Escribe *MENU* para volver al inicio.`; 
        delete sessions[from];
      } else if (cmd === "b" || cmd === "falla") {
        reply = `⚠️ Por favor, envíanos en un solo mensaje:
1️⃣ Ubicación (Share Location 📍) si es distinta.
2️⃣ Foto o Video 📸 de la falla.
3️⃣ Una frase corta describiendo el problema.`; 
        user.step = 202;
      } else if (["c", "d", "e", "factura", "garantia", "garantía", "otro"].includes(cmd)) {
        reply = `✍️ Por favor, describe brevemente qué requieres para asignarlo al equipo:`; 
        user.step = 203;
      } else {
        reply = "❌ Por favor selecciona una opción válida (A, B, C, D o E).";
      }
      break;

    case 202: // SOPORTE - Falla (Captura de evidencia)
      user.fallaDesc = msg;
      user.fallaMedia = mediaUrl; 
      user.fallaLat = lat;
      user.fallaLng = lng;
      reply = `✅ Evidencia de falla registrada. Nuestro equipo de mantenimiento lo revisará.

Escribe *MENU* para volver al inicio.`; 
      delete sessions[from];
      break;

    case 203: // SOPORTE - Factura/Garantía/Otro
      user.soporteDetalle = msg; 
      reply = `✅ Tu solicitud ha sido registrada y asignada.

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    // ==========================================
    // RAMA 300: PERSONAL - Validación y Menú
    // ==========================================
    case 300: // P1 - Validación de clave
      // Aquí validarán la clave real en la base de datos
      if (msg === "1234") { // Clave temporal
         user.intentos = 0;
         reply = `✅ Acceso concedido.

📋 ¿A qué módulo deseas ingresar?

A) MANTENIMIENTO
B) VISITA
C) MONITOREO
D) SUPERVISIÓN
E) SALIR`; 
         user.step = 301;
      } else {
         user.intentos++;
         if (user.intentos >= 2) {
           reply = `❌ Demasiados intentos fallidos. Usuario bloqueado temporalmente.

Escribe *MENU* para volver al inicio.`; 
           delete sessions[from];
         } else {
           reply = `❌ Clave incorrecta. Intenta nuevamente (Intento ${user.intentos}/2):`; 
         }
      }
      break;

    case 301: // P2 - Menú Personal
      if (cmd === "e" || cmd === "salir") {
        reply = "👋 Sesión finalizada. Escribe *MENU* para volver al inicio.";
        delete sessions[from];
        break;
      }

      const modulos = { "a": "MANTENIMIENTO", "b": "VISITA", "c": "MONITOREO", "d": "SUPERVISION" };
      if (!modulos[cmd]) {
         reply = "❌ Selecciona una opción válida (A, B, C, D o E).";
         break;
      }
      
      user.moduloPersonal = modulos[cmd]; 
      reply = `👤 Módulo: ${user.moduloPersonal}.

✍️ Por favor, escribe el Nombre del cliente o el Folio:`; // PBASE
      user.step = 302;
      break;

    case 302: // PBASE - Nombre de cliente
      user.clienteNombre = msg;
      reply = `📍 Ahora, envía la ubicación (Share Location).

Presiona ➕ o 📎 y selecciona *Ubicación*.`; 
      user.step = 303;
      break;

    case 303: // PBASE - Ubicación e inicio de submódulo
      if (!lat || !lng) {
        reply = "⚠️ Necesito la ubicación GPS. Usa el botón 📍."; 
        break;
      }
      user.lat = lat;
      user.lng = lng; 

      // Distribución hacia el submódulo técnico correspondiente
      if (user.moduloPersonal === "MANTENIMIENTO") {
        reply = `🛠️ ¿Qué tipo de mantenimiento es?

🅰️ PREVENTIVO
🅱️ CORRECTIVO`; 
        user.step = 310; // Espacio reservado para flujo de Mantenimiento
      } else if (user.moduloPersonal === "VISITA") {
        reply = `📋 Módulo Visita. 
Por favor, escribe el Nombre del TITULAR de CFE, el RPU y la TARIFA:`; 
        user.step = 320; // Espacio reservado para flujo de Visita
      } else if (user.moduloPersonal === "MONITOREO") {
        reply = `📸 Por favor, envía la FOTO del monitor físico existente (Obligatorio):`; 
        user.step = 330; // Espacio reservado para flujo de Monitoreo
      } else if (user.moduloPersonal === "SUPERVISION") {
        reply = `🏗️ ¿En qué momento de la obra te encuentras?

A) INICIO DE OBRA
B) DURANTE OBRA
C) FIN DE OBRA`; 
        user.step = 340; // Espacio reservado para flujo de Supervisión
      }
      break;

    // ==========================================
    // RAMA 400: ASESOR - Handoff
    // ==========================================
    case 400:
      user.nombreAsesor = msg;
      reply = `✅ Listo ${user.nombreAsesor}, un asesor te contactará a este número a la brevedad.

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    default:
      reply = "⚠️ Error inesperado. Escribe *MENU*.";
      delete sessions[from];
  }

  send(res, reply);
});

// =======================
// HELPERS
// =======================
function resumenCotizacion(user) {
  return `📋 *Resumen de Cotización*

📌 Tipo: ${user.cotizacionTipo}
👤 Datos: ${user.datosContacto}
📞 Tel Wa: ${user.telefonoWa}
📍 Ubicación: Recibida ✅
📎 Detalle/Evidencia: ${user.media ? "Foto/Documento recibido" : user.evidencia}

🅰️ Confirmar y generar folio
🅱️ Cancelar`;
}

function send(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.type("text/xml").send(twiml.toString());
}

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor de SASP Energie corriendo...");
});
