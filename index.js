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
    // RAMA 100: CLIENTE -> COTIZAR (Paso a paso)
    // ==========================================
    case 100: // C2 - Tipo
      if (!tiposCotizacion[cmd]) {
        reply = "❌ Selecciona A, B o C.";
        break;
      }
      user.cotizacionTipo = tiposCotizacion[cmd];
      reply = `✍️ Por favor, escribe tu *Nombre completo*:`;
      user.step = 101;
      break;

    case 101: // C3 - Nombre
      user.nombre = msg;
      user.telefonoWa = from.replace("whatsapp:", ""); // Capturamos el teléfono automáticamente
      reply = `📧 Escribe tu *Correo electrónico*.
      
(Si no deseas darlo, escribe *OMITIR*):`;
      user.step = 102;
      break;

    case 102: // C3 - Correo (Opcional)
      user.correo = (cmd === "omitir") ? "No proporcionado" : msg;
      reply = `📍 Envía la *Ubicación* (Share Location) donde se requiere el servicio.

Presiona ➕ o 📎 y selecciona *Ubicación*.`;
      user.step = 103;
      break;

    case 103: // C4 - Ubicación
      if (!lat || !lng) {
        reply = "⚠️ Necesito la ubicación GPS. Usa el botón 📍.";
        break;
      }
      user.lat = lat;
      user.lng = lng;

      // C5 - Petición de evidencia según tipo
      if (user.cotizacionTipo === "☀️ Solar") {
        reply = `📸 Por favor envía una FOTO de tu recibo de CFE (o PDF). 
        
(Si no cuentas con él, escribe *SIN RECIBO*):`;
      } else if (user.cotizacionTipo === "🔋 Baterías") {
        reply = `🔋 ¿Cuál es tu objetivo? (ej. Respaldo, Aislado, Híbrido) y qué cargas/equipos quieres conectar:`;
      } else {
        reply = `📊 ¿Cuál es el giro de tu inmueble y tu pago aprox. mensual a CFE?`;
      }
      user.step = 104;
      break;

    case 104: // C5 Captura de evidencia o texto
      if (user.cotizacionTipo === "☀️ Solar" && mediaUrl) {
        user.evidencia = "RECIBO_CFE";
        user.media = mediaUrl;
      } else {
        user.evidencia = msg; 
      }

      // Actualizamos la función resumen en este punto
      reply = `📋 *Resumen de Cotización*

📌 Tipo: ${user.cotizacionTipo}
👤 Nombre: ${user.nombre}
📧 Correo: ${user.correo}
📞 Tel Wa: ${user.telefonoWa}
📍 Ubicación: Recibida ✅
📎 Detalle/Evidencia: ${user.media ? "Foto/Documento recibido" : user.evidencia}

🅰️ Confirmar y generar folio
🅱️ Cancelar`;
      user.step = 105;
      break;

    case 105: // C6 - Confirmación y Regla de Siguiente Paso
      if (cmd === "a") {
        const folio = Math.floor(1000 + Math.random() * 9000); 
        
        let mensajeCierre = "Te llamaremos para completar información.";
        if (user.cotizacionTipo === "☀️ Solar" && user.evidencia === "RECIBO_CFE") {
          mensajeCierre = "Te enviaremos PRE-COTIZACION vía WhatsApp pronto.";
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
    // RAMA 200: CLIENTE -> SOPORTE (Paso a paso)
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
        reply = `📍 Para reportar la falla, primero envíanos la *Ubicación* (Share Location).
        
Presiona ➕ o 📎 y selecciona *Ubicación*:`; 
        user.step = 202; // Inicia flujo paso a paso de falla

      } else if (["c", "d", "e", "factura", "garantia", "garantía", "otro"].includes(cmd)) {
        reply = `✍️ Por favor, describe brevemente qué requieres para asignarlo al equipo:`; 
        user.step = 205; // Salta al cierre de estas opciones
      } else {
        reply = "❌ Por favor selecciona una opción válida (A, B, C, D o E).";
      }
      break;

    case 202: // SOPORTE Falla - Captura Ubicación
      if (!lat || !lng) {
        reply = "⚠️ Necesito la ubicación GPS. Usa el botón 📍.";
        break;
      }
      user.fallaLat = lat;
      user.fallaLng = lng;
      reply = `📸 Gracias. Ahora, envía una *Foto o Video* de la falla.
      
(Si no tienes, escribe *OMITIR*):`;
      user.step = 203;
      break;
      
    case 203: // SOPORTE Falla - Captura Foto/Video
      user.fallaMedia = mediaUrl ? mediaUrl : "No proporcionada";
      reply = `✍️ Por último, escribe una frase corta describiendo el problema:`;
      user.step = 204;
      break;

    case 204: // SOPORTE Falla - Captura Descripción
      user.fallaDesc = msg;
      reply = `✅ Falla registrada correctamente. Nuestro equipo de mantenimiento lo revisará.

Escribe *MENU* para volver al inicio.`; 
      delete sessions[from];
      break;

    case 205: // SOPORTE - Factura/Garantía/Otro
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
    // RAMA 310: PERSONAL -> MANTENIMIENTO (MTTO)
    // ==========================================
    case 310: // PM2 - Tipo de Mantenimiento
      if (cmd === "a" || cmd === "preventivo") {
        user.mttoTipo = "PREVENTIVO";
        reply = `📋 *Reporte de Mantenimiento Preventivo*
Confirma qué servicios le realizaste a los equipos en esta visita. 

(Escribe los números de las tareas completadas separados por comas. Ej. 1, 2, 3, 4):
1️⃣ Limpieza de paneles
2️⃣ Revisión de gabinetes/protecciones
3️⃣ Revisión de producción del inversor
4️⃣ Verificación de monitoreo en línea`;
        user.step = 3101; 
      } else if (cmd === "b" || cmd === "correctivo") {
        user.mttoTipo = "CORRECTIVO";
        reply = `🛠️ *Reporte de Mantenimiento Correctivo*
¿Qué tipo de falla encontraste y reparaste en los equipos?

A) Inversor no funciona
B) Panel roto
C) Estructura mal estado
D) Falla protecciones
E) Otro`;
        user.step = 315;
      } else {
        reply = "❌ Por favor selecciona A (PREVENTIVO) o B (CORRECTIVO).";
      }
      break;

    // --- SUB-RAMA PREVENTIVO ---
    case 3101: // Validación de Selección Múltiple del Checklist
      const input = msg.replace(/\s/g, ''); 
      
      // Validamos que el técnico confirme AL MENOS UNA de las tareas
      if (input.includes('1') || input.includes('2') || input.includes('3') || input.includes('4')) {
         user.mttoChecklistConfirmado = true;
         user.mttoTareasRealizadas = msg; // Guardamos lo que contestó para el backend
         
         reply = `✅ Tareas registradas. 
         
📸 Ahora, por favor envía las *FOTOS de evidencia mínimas* (paneles, gabinete, app inversor, evidencia monitoreo). 
Cuando termines de subir las fotos, escribe la palabra *LISTO*:`;
         user.step = 311;
      } else {
         reply = `⚠️ Debes registrar al menos una tarea realizada para continuar. 
         
Por favor, escribe el número o números de las tareas que completaste (ej. 1 o 1,3):`;
      }
      break;

    case 311: // PM4 - Recepción de fotos Preventivo
      if (cmd !== "listo") {
        reply = "✅ Foto recibida. Envía la siguiente o escribe *LISTO*.";
        break;
      }
      reply = `✅ Evidencias de mantenimiento recibidas. Selecciona el *Estatus final* para cerrar tu ticket: 

A) OK
B) OBSERVACIONES
C) REQUIERE CORRECTIVO`;
      user.step = 312;
      break;

    case 312: // Cierre Preventivo
      user.mttoCierre = msg; 
      reply = `✅ *Ticket de Mantenimiento Preventivo cerrado exitosamente.* Buen trabajo.

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

      
    // ==========================================
    // RAMA 320: PERSONAL -> VISITA TÉCNICA (PV)
    // ==========================================
    case 320: // PV2 - Datos CFE capturados
      user.visDatosCfe = msg; 
      reply = `📸 Excelente. Ahora envía la *FOTO del Medidor* (Obligatoria):`; 
      user.step = 321;
      break;

    case 321: // Combina PV3 y PV4
      if (!mediaUrl) {
        reply = "⚠️ Por favor, adjunta la foto del medidor para continuar."; 
        break;
      }
      user.visFotoMedidor = mediaUrl; 
      reply = `🏠 Responde en un solo mensaje:
1️⃣ *Inmueble*: (CASA / COMERCIO / INDUSTRIA / OTRO)
2️⃣ *Superficie*: (TECHO CONCRETO / LAMINA / SUELO)
3️⃣ *Inclinación y Orientación*: (ej. PLANO, SUR)`; 
      user.step = 322;
      break;

    case 322: // Combina PV5 y PV6
      user.visInmuebleParams = msg; 
      reply = `⚡ Siguientes datos:
1️⃣ *Sombras y Gas*: (ej. SIN SOMBRAS, GAS NO)
2️⃣ *Transformador y Acometida*: (ej. POSTE, AÉREA)
3️⃣ *Distancia al trafo (m)*:`; 
      user.step = 323;
      break;

    case 323: // Combina PV7 y PV8
      user.visTrafoParams = msg; 
      reply = `🔌 Instalación eléctrica:
1️⃣ *Suministro*: (MONO / BIFÁSICO / TRIFÁSICO)
2️⃣ *Protección*: (FUSIBLES / TERMOMAGNÉTICO + Amperaje)
3️⃣ *Tierra física*: (SI / NO y distancia en m)`; 
      user.step = 324;
      break;

    case 324: // Combina PV9 y PV10
      user.visElecParams = msg; 
      reply = `📏 *Distancias y Preferencias*:
1️⃣ Distancia PANEL a INVERSOR (m):
2️⃣ Distancia INVERSOR a TABLERO (m):
3️⃣ Preferencias del cliente: (ej. NO ver paneles, NO ver tubería)`; 
      user.step = 325;
      break;

    case 325: // PV11 - Evidencias fotográficas múltiples
      user.visDistPreferencias = msg; 
      reply = `📸 *Evidencia Fotográfica* (Envía las fotos necesarias):
- Azotea/Sitio
- Ruta tubería
- Centro carga abierto
- Muro para inversor

Cuando termines de enviar las fotos, escribe la palabra *LISTO*.`; 
      user.step = 326;
      break;

    case 326: // Espera de fotos o salto a Croquis
      if (cmd !== "listo") {
        reply = "✅ Foto recibida. Envía la siguiente o escribe *LISTO*.";
        break;
      }
      reply = `✍️ Por último, envía la *FOTO DEL DIBUJO/CROQUIS* de instalación (Obligatorio):`; 
      user.step = 327;
      break;

    case 327: // PV13 - Cierre de Visita
      if (!mediaUrl) {
         reply = "⚠️ Adjunta la foto del croquis."; 
         break;
      }
      user.visCroquis = mediaUrl; 
      reply = `✅ *Visita Técnica finalizada.* Estatus: INFO COMPLETA (Pasando a diseño/cotización).

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;


    // ==========================================
    // RAMA 330: PERSONAL -> MONITOREO (MON)
    // ==========================================
    case 330: // Primer paso que se asigna en el case 303
      if (!mediaUrl) {
        reply = "⚠️ La FOTO del monitor físico es obligatoria."; 
        break;
      }
      user.monFoto = mediaUrl; 
      reply = `📶 Por favor, registra la red:
*WIFI_NOMBRE* + *WIFI_CLAVE*:`; 
      user.step = 331;
      break;

    case 331:
      user.monWifi = msg; 
      reply = `🔎 Registra el *HALLAZGO* principal:
(SIN ENERGIA / SIN INTERNET / SIN SEÑAL / CONFIGURACION / OTRO) + Pasos realizados:`; 
      user.step = 332;
      break;

    case 332:
      user.monHallazgo = msg; 
      reply = `✅ Resultado final. ¿El equipo quedó *EN LÍNEA*?

A) SÍ (EN LÍNEA)
B) NO (NO EN LÍNEA)`; 
      user.step = 333;
      break;

    case 333:
      if (cmd === "a" || cmd === "si") {
        reply = `📸 Excelente. Envía la *foto de evidencia en línea* para cerrar el ticket:`; 
        user.step = 334;
      } else {
        reply = `⚠️ Registra el plan a seguir:
(REQUIERE VISITA 2 / ESCALAR / CAMBIO EQUIPO):`; 
        user.step = 335;
      }
      break;

    case 334: // Cierre Monitoreo (SI en línea)
      user.monEvidenciaFinal = mediaUrl; 
      reply = `✅ *Ticket de Monitoreo actualizado exitosamente.*

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    case 335: // Cierre Monitoreo (NO en línea)
      user.monPlan = msg; 
      reply = `✅ *Ticket de Monitoreo actualizado exitosamente (Pendiente de acción).*

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    // ==========================================
    // RAMA 340: PERSONAL -> SUPERVISIÓN (SUP)
    // ==========================================
    case 340: // Recepción Momento de Obra
      if (cmd === "a" || cmd === "inicio") {
        user.supMomento = "INICIO_OBRA"; // [cite: 98]
        reply = `🏗️ *INICIO DE OBRA*.
Por favor, envía la FOTO de los *materiales entregados*:`; // [cite: 99]
        user.step = 341;
      } else if (["b", "c", "durante", "fin"].includes(cmd)) {
        user.supMomento = "PROCESO_FIN_OBRA"; // [cite: 102]
        reply = `🏗️ *DURANTE / FIN DE OBRA*.
Sube las evidencias del proceso (mínimo 6 fotos). 
Cuando termines de subir las fotos, escribe tu *COMENTARIO/REPORTE*:`; // [cite: 104]
        user.step = 345;
      } else {
        reply = "❌ Selecciona A, B o C.";
      }
      break;

    case 341: // SUP Inicio - Foto Materiales
      user.supFotoMateriales = mediaUrl; // [cite: 99]
      reply = `📸 Recibido. Ahora envía la foto de *Firma del instalador* (recibió material):`; // [cite: 100]
      user.step = 342;
      break;

    case 342: // SUP Inicio - Foto Firma Instalador
      user.supFotoInstalador = mediaUrl; // [cite: 100]
      reply = `📸 Recibido. Por último, envía la foto de *Firma del cliente*:`; // [cite: 101]
      user.step = 343;
      break;

    case 343: // Cierre SUP Inicio
      user.supFotoCliente = mediaUrl; // [cite: 101]
      reply = `✅ *Supervisión de Inicio de Obra registrada.*

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    case 345: // Cierre SUP Durante/Fin (Después de recibir fotos y comentario)
      user.supComentario = msg; // [cite: 104]
      reply = `✅ Cierre de reporte. Selecciona el estatus final:

A) OK
B) DESVIACIÓN MENOR
C) DESVIACIÓN MAYOR
D) DETENER POR SEGURIDAD`; // [cite: 105]
      user.step = 346;
      break;

    case 346: // Estatus Final SUP
      user.supEstatus = msg; // [cite: 105]
      reply = `✅ *Ticket de Supervisión actualizado exitosamente.*

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
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
