const express = require("express");
const bodyParser = require("body-parser");
const { MessagingResponse } = require("twilio").twiml;
const axios = require("axios");
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
const FormData = require("form-data");

// Memoria temporal para sesiones (Máquina de estados)
const sessions = {};
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutos en milisegundos
const URL_API = 'https://energie-crm.energieconsultores.com/api';
// =======================
// CONFIGURACIÓN SASP
// =======================
const tiposCotizacion = {
  "a": "Paneles Solares",
  "b": "Calentadores Solares",
  "c": "Diagnóstico Energético",
  "d": "Alumbrado Público",
  "e": "Otro"
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

  // Helper para cerrar venta/cotización y dar folio 

  const darFolioYDespedir = async () => {
  

    const response = await enviarClienteRegistro(user);
    console.log("response cliente registro:", response);
  
     const folio = response?.folio;

     if ((user.mediaUrl || user.evidenciaRecibo) && response?.folio) {
      await enviarEvidencia(user, folio);
    }
    let mensaje=''
    if(folio!==undefined){
         mensaje = `✅ Tu solicitud ha sido registrada con el folio *${folio}*.
      
      Un asesor se pondrá en contacto a la brevedad.
      Escribe *MENU* para volver al inicio.`;
    } else {  
       mensaje = `Hubo un error registrando tu solicitud. Por favor, intenta de nuevo más tarde.
                  Escribe *MENU* para volver al inicio.`;
    }
  
    delete sessions[from];
    return mensaje;
  };

  // Texto reutilizable para la pregunta de rangos de luz
  const textoRangosLuz = `¿Cuál es el rango de gasto de luz que haces al mes?

A) $2,500 o menos
B) $2,500 a $10,000
C) $10,000 a $40,000
D) $40,000 a $100,000
E) $100,000+`;

  // =======================
  // COMANDOS GLOBALES
  // =======================
  const cmd = msg?.toLowerCase();

  const menuPrincipal = `👋 Hola!! soy el asesor de Energie Consultores, para poder brindar apoyo dime:

A) Quiero ser Cliente
B) Soy Cliente
C) Soy Staff`;

  if (cmd === "menu") {
    sessions[from] = { step: 1, lastActivity: Date.now() };
    reply = menuPrincipal;
    return send(res, reply);
  }

  if (cmd === "salir") {
    delete sessions[from];
    reply = "👋 Sesión finalizada. Escribe *MENU* para comenzar de nuevo.";
    return send(res, reply);
  }
    
  if (user.step === 0) {
    user.step = 1;
    reply = menuPrincipal;
    return send(res, reply);
  }

  // =======================
  // FLUJO PRINCIPAL
  // =======================
  switch (user.step) {

    // STATE 1 — FILTRO DE ENTRADA (S0)
    case 1:
      if (cmd === "a" || cmd === "quiero ser cliente") {
        reply = `¿De qué servicio te interesa una propuesta a tu medida?

A) Paneles Solares
B) Calentadores Solares
C) Diagnóstico Energético
D) Alumbrado Público
E) Otro`;
        user.step = 100; 
      } else if (cmd === "b" || cmd === "soy cliente") {
        reply = `🛠️ Escribe tu número de FOLIO de 4 dígitos, o escribe *NUEVO* si no tienes folio:`;
        user.step = 200; 
      } else if (cmd === "c" || cmd === "soy staff") {
        reply = `🔒 Acceso PERSONAL. Ingresa tu CLAVE de usuario:`;
        user.step = 300; 
      } else {
        reply = "❌ Por favor selecciona A, B o C.";
      }
      break;

    // ==========================================
    // RAMA 100: QUIERO SER CLIENTE
    // ==========================================
    case 100: // C1 - Tipo de servicio
      if (!tiposCotizacion[cmd]) {
        reply = "❌ Por favor selecciona una opción válida (A, B, C, D o E).";
        break;
      }
      user.cotizacionTipo = tiposCotizacion[cmd];
      
      if (user.cotizacionTipo === "Paneles Solares") {
        reply = `¿De qué ciudad y estado nos escribes?`;
        user.step = 105;
      } else if (user.cotizacionTipo === "Diagnóstico Energético") {
        reply = `¿El servicio es para sector privado o público?

A) Privado
B) Municipio
C) Gobierno del Estado`;
        user.step = 115;
      } else if (user.cotizacionTipo === "Calentadores Solares") {
        reply = `Tu servicio es para:

A) Casa
B) Hotel 
C) Alberca
D) Otro`;
        user.step = 120;
      } else if (user.cotizacionTipo === "Alumbrado Público") {
        reply = `🅰️ ¿Quieres adquirir led?
🅱️ Requieres un proyecto eléctrico`;
        user.step = 130;
      } else if (user.cotizacionTipo === "Otro") {
        reply = `Por favor especifica, ¿qué deseas?`;
        user.step = 140;
      }
      break;

    // --- NUEVO PASO: Ciudad y Estado para Paneles Solares ---
    case 105:
      user.ciudadEstado = msg;
      reply = `Proporcionanos tu nombre:`;
      user.step = 110;
      break;

    // --- SUB-RAMA: Diagnóstico Energético ---
    case 115:
      if (!["a", "b", "c", "privado", "municipio", "gobierno del estado", "gobierno"].includes(cmd)) {
        reply = "❌ Por favor selecciona A, B o C.";
        break;
      }
      user.sector = msg;
      reply = `¿De qué ciudad y estado nos escribes?`;
      user.step = 116;
      break;

    case 116:
      user.ciudadEstado = msg;
      reply = `Proporcionanos tu nombre:`;
      user.step = 110;
      break;

    // --- SUB-RAMA COMÚN: Paneles Solares / Diagnóstico Energético ---
    case 110: 
      user.nombre = msg;
      reply = `Proporciona tu recibo en imagen o pdf, si no lo tienes a la mano escribe NO LO TENGO`;
      user.step = 111;
      break;

    case 111: 
      if (cmd === "no lo tengo") {
        if (user.cotizacionTipo === "Diagnóstico Energético") {
          reply = textoRangosLuz;
          user.step = 114;
        } else {
          reply = `Tu servicio es:

A) Doméstico
B) Comercial
C) Industrial`;
          user.step = 112;
        }
      } else {
        user.evidenciaRecibo = mediaUrl ? mediaUrl : msg;
        user.mediaUrl = mediaUrl;
        reply = await darFolioYDespedir();
      }
      break;

    case 112: 
      if (!["a", "b", "c", "domestico", "doméstico", "comercial", "industrial"].includes(cmd)) {
        reply = "❌ Por favor selecciona A, B o C.";
        break;
      }
      user.servicioTipo = msg;
      reply = textoRangosLuz;
      user.step = 114;
      break;

    case 114: 
      if (!["a", "b", "c", "d", "e"].includes(cmd)) {
        reply = "❌ Por favor selecciona una opción válida (A, B, C, D o E).";
        break;
      }
      user.rangoLuz = msg;
      reply = await darFolioYDespedir();
      break;

    // --- SUB-RAMA: Calentadores Solares ---
    case 120:
      if (!["a", "b", "c", "d", "casa", "hotel", "alberca", "otro"].includes(cmd)) {
        reply = "❌ Por favor selecciona A, B, C o D.";
        break;
      }
      user.calentadorUso = msg;
      // Salto directo a pedir ciudad y estado omitiendo el sector privado/público
      reply = `¿De qué ciudad y estado nos escribes?`;
      user.step = 124;
      break;

    case 124:
      user.ciudadEstado = msg;
      reply = `¿Cuánto pagas al mes en gas?`;
      user.step = 123;
      break;

    case 123:
      user.pagoGas = msg;
      reply = `Proporcionanos tu nombre:`;
      user.step = 121;
      break;
      
    case 121:
      user.nombre = msg;
      reply = await darFolioYDespedir();
      break;

    // --- SUB-RAMA: Alumbrado Público ---
    case 130:
      if (!["a", "b", "led", "proyecto", "proyecto eléctrico", "proyecto electrico"].includes(cmd)) {
        reply = "❌ Por favor selecciona 🅰️ o 🅱️.";
        break;
      }
      user.alumbradoOpcion = msg;
      reply = `¿El servicio es para sector privado o público?

A) Privado
B) Municipio
C) Gobierno del Estado`;
      user.step = 132;
      break;
      
    case 132:
      if (!["a", "b", "c", "privado", "municipio", "gobierno del estado", "gobierno"].includes(cmd)) {
        reply = "❌ Por favor selecciona A, B o C.";
        break;
      }
      user.sector = msg;
      reply = `¿De qué ciudad y estado nos escribes?`;
      user.step = 133;
      break;

    case 133:
      user.ciudadEstado = msg;
      reply = `Proporcionanos tu nombre:`;
      user.step = 131;
      break;

    case 131:
      user.nombre = msg;
      reply = await darFolioYDespedir();
      break;

    // --- SUB-RAMA: Otro ---
    case 140:
      user.otroEspecificacion = msg; 
      reply = `Proporcionanos tu nombre:`;
      user.step = 141;
      break;
      
    case 141:
      user.nombre = msg;
      reply = await darFolioYDespedir();
      break;

    // ==========================================
    // RAMA 200: SOY CLIENTE -> SOPORTE
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
      await enviarSoporte(user);
      reply = `✅ Falla registrada correctamente. Nuestro equipo de mantenimiento lo revisará.

Escribe *MENU* para volver al inicio.`; 
      delete sessions[from];
      break;

    case 205: // SOPORTE - Factura/Garantía/Otro
      user.soporteDetalle = msg; 
      await enviarSoporte(user);
      reply = `✅ Tu solicitud ha sido registrada y asignada.

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;
      
    // ==========================================
    // RAMA 300: PERSONAL - Validación y Menú
    // ==========================================
    case 300: // P1 - Validación de clave
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
        user.step = 310; 
      } else if (user.moduloPersonal === "VISITA") {
        reply = `📋 Módulo Visita. 
Por favor, escribe el Nombre del TITULAR de CFE, el RPU y la TARIFA:`; 
        user.step = 320; 
      } else if (user.moduloPersonal === "MONITOREO") {
        reply = `📸 Por favor, envía la FOTO del monitor físico existente (Obligatorio):`; 
        user.step = 330; 
      } else if (user.moduloPersonal === "SUPERVISION") {
        reply = `🏗️ ¿En qué momento de la obra te encuentras?

A) INICIO DE OBRA
B) DURANTE OBRA
C) FIN DE OBRA`; 
        user.step = 340; 
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

    case 3101: 
      const input = msg.replace(/\s/g, ''); 
      if (input.includes('1') || input.includes('2') || input.includes('3') || input.includes('4')) {
         user.mttoChecklistConfirmado = true;
         user.mttoTareasRealizadas = msg; 
         
         reply = `✅ Tareas registradas. 
         
📸 Ahora, por favor envía las *FOTOS de evidencia mínimas* (paneles, gabinete, app inversor, evidencia monitoreo). 
Cuando termines de subir las fotos, escribe la palabra *LISTO*:`;
         user.step = 311;
      } else {
         reply = `⚠️ Debes registrar al menos una tarea realizada para continuar. 
         
Por favor, escribe el número o números de las tareas que completaste (ej. 1 o 1,3):`;
      }
      break;

    case 311: 
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

    case 312: 
      user.mttoCierre = msg; 
      const operacionId = await crearOperacion(user);

      if (operacionId) {
        await enviarMantenimiento(user, operacionId);
      }
      reply = `✅ *Ticket de Mantenimiento Preventivo cerrado exitosamente.* Buen trabajo.

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    // ==========================================
    // RAMA 320: PERSONAL -> VISITA TÉCNICA (PV)
    // ==========================================
    case 320: 
      user.visDatosCfe = msg; 
      reply = `📸 Excelente. Ahora envía la *FOTO del Medidor* (Obligatoria):`; 
      user.step = 321;
      break;

    case 321: 
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

    case 322: 
      user.visInmuebleParams = msg; 
      reply = `⚡ Siguientes datos:
1️⃣ *Sombras y Gas*: (ej. SIN SOMBRAS, GAS NO)
2️⃣ *Transformador y Acometida*: (ej. POSTE, AÉREA)
3️⃣ *Distancia al trafo (m)*:`; 
      user.step = 323;
      break;

    case 323: 
      user.visTrafoParams = msg; 
      reply = `🔌 Instalación eléctrica:
1️⃣ *Suministro*: (MONO / BIFÁSICO / TRIFÁSICO)
2️⃣ *Protección*: (FUSIBLES / TERMOMAGNÉTICO + Amperaje)
3️⃣ *Tierra física*: (SI / NO y distancia en m)`; 
      user.step = 324;
      break;

    case 324: 
      user.visElecParams = msg; 
      reply = `📏 *Distancias y Preferencias*:
1️⃣ Distancia PANEL a INVERSOR (m):
2️⃣ Distancia INVERSOR a TABLERO (m):
3️⃣ Preferencias del cliente: (ej. NO ver paneles, NO ver tubería)`; 
      user.step = 325;
      break;

    case 325: 
      user.visDistPreferencias = msg; 
      reply = `📸 *Evidencia Fotográfica* (Envía las fotos necesarias):
- Azotea/Sitio
- Ruta tubería
- Centro carga abierto
- Muro para inversor

Cuando termines de enviar las fotos, escribe la palabra *LISTO*.`; 
      user.step = 326;
      break;

    case 326: 
      if (cmd !== "listo") {
        reply = "✅ Foto recibida. Envía la siguiente o escribe *LISTO*.";
        break;
      }
      reply = `✍️ Por último, envía la *FOTO DEL DIBUJO/CROQUIS* de instalación (Obligatorio):`; 
      user.step = 327;
      break;

    case 327: 
      if (!mediaUrl) {
         reply = "⚠️ Adjunta la foto del croquis."; 
         break;
      }
      user.visCroquis = mediaUrl; 
      const operacionIdC = await crearOperacion(user);

      if (operacionIdC) {
        await enviarVisita(user, operacionIdC);
      }
      reply = `✅ *Visita Técnica finalizada.* Estatus: INFO COMPLETA (Pasando a diseño/cotización).

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    // ==========================================
    // RAMA 330: PERSONAL -> MONITOREO (MON)
    // ==========================================
    case 330: 
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

    case 334: 
      user.monEvidenciaFinal = mediaUrl; 

      const operacionIdCR = await crearOperacion(user);

      if (operacionIdCR) {
        await enviarMonitoreo(user, operacionIdCR);
      }
      reply = `✅ *Ticket de Monitoreo actualizado exitosamente.*

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    case 335: 
      user.monPlan = msg; 
      reply = `✅ *Ticket de Monitoreo actualizado exitosamente (Pendiente de acción).*

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    // ==========================================
    // RAMA 340: PERSONAL -> SUPERVISIÓN (SUP)
    // ==========================================
    case 340: 
      if (cmd === "a" || cmd === "inicio") {
        user.supMomento = "INICIO_OBRA";
        reply = `🏗️ *INICIO DE OBRA*.
Por favor, envía la FOTO de los *materiales entregados*:`; 
        user.step = 341;
      } else if (["b", "c", "durante", "fin"].includes(cmd)) {
        user.supMomento = "PROCESO_FIN_OBRA";
        reply = `🏗️ *DURANTE / FIN DE OBRA*.
Sube las evidencias del proceso (mínimo 6 fotos). 
Cuando termines de subir las fotos, escribe tu *COMENTARIO/REPORTE*:`;
        user.step = 345;
      } else {
        reply = "❌ Selecciona A, B o C.";
      }
      break;

    case 341: 
      user.supFotoMateriales = mediaUrl; 
      reply = `📸 Recibido. Ahora envía la foto de *Firma del instalador* (recibió material):`; 
      user.step = 342;
      break;

    case 342: 
      user.supFotoInstalador = mediaUrl; 
      reply = `📸 Recibido. Por último, envía la foto de *Firma del cliente*:`; 
      user.step = 343;
      break;

    case 343: 
      user.supFotoCliente = mediaUrl;
      const operacionIdS = await crearOperacion(user);

      if (operacionIdS) {
        await enviarSupervision(user, operacionIdS);
      }
      reply = `✅ *Supervisión de Inicio de Obra registrada.*

Escribe *MENU* para volver al inicio.`;
      delete sessions[from];
      break;

    case 345: 
      user.supComentario = msg;
      reply = `✅ Cierre de reporte. Selecciona el estatus final:

A) OK
B) DESVIACIÓN MENOR
C) DESVIACIÓN MAYOR
D) DETENER POR SEGURIDAD`;
      user.step = 346;
      break;

    case 346: 
      user.supEstatus = msg;
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
function send(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.type("text/xml").send(twiml.toString());
}
 
async function enviarClienteRegistro(user) {
  console.log("📋 Registrando cliente en el sistema...",user);

  const url = `${URL_API}/clientes/registro`;

  try {
    const payload = {
      nombre: user.nombre,
      telefono: user.from,
      direccion: user.ciudadEstado,
      cotizacionTipo: user.cotizacionTipo,
      alumbradoOpcion: user.alumbradoOpcion, 
      calentadorUso: user.calentadorUso,
      otroEspecificacion: user.otroEspecificacion,
      pagoGas: user.pagoGas,
      servicioTipo: user.servicioTipo,
      rangoLuz: user.rangoLuz
    };

    const response = await axios.post(url, payload);
    return response.data;

  } catch (error) {
    console.error("❌ Error cliente:", error.message);
    return "Error al registrar cliente. Por favor, intenta de nuevo más tarde.";
  }
}

async function enviarSoporte(user) {

  const url = `${URL_API}/soporte/reporte`;

  try {

    const payload = {
      folioSoporte: user.folioSoporte,
      tipoSoporte: user.tipoSoporte || "GENERAL",
      fallaLat: user.fallaLat,
      fallaLng: user.fallaLng,
      fallaDesc: user.fallaDesc,
      soporteDetalle: user.soporteDetalle,
      telefono: user.from
    };

    const response = await axios.post(url, payload);
    return response.data;

  } catch (error) {
    console.error("❌ Error soporte:", error.message);
    return null;
  }
}

async function crearOperacion(user) {

  const url = `${URL_API}/api/staff/operacion`;

  try {

    const payload = {
      modulo: user.moduloPersonal,
      clienteNombre: user.clienteNombre,
      lat: user.lat,
      lng: user.lng,
      telefono: user.from
    };

    const response = await axios.post(url, payload);
    return response.data?.operacionId;

  } catch (error) {
    console.error("❌ Error operacion:", error.message);
    return null;
  }
}

async function enviarMantenimiento(user, operacionId) {

  return axios.post(`${URL_API}/staff/mantenimiento`, {
    operacionId,
    tipo: user.mttoTipo,
    tareas: user.mttoTareasRealizadas,
    estatus: user.mttoCierre
  });

}

async function enviarVisita(user, operacionId) {

  return axios.post(`${URL_API}/staff/visita`, {
    operacionId,
    datosCfe: user.visDatosCfe,
    fotoMedidor: user.visFotoMedidor,
    inmueble: user.visInmuebleParams,
    trafo: user.visTrafoParams,
    electrico: user.visElecParams,
    distancias: user.visDistPreferencias,
    croquis: user.visCroquis
  });

}

async function enviarMonitoreo(user, operacionId) {

  return axios.post(`${URL_API}/staff/monitoreo`, {
    operacionId,
    foto: user.monFoto,
    wifi: user.monWifi,
    hallazgo: user.monHallazgo,
    evidencia: user.monEvidenciaFinal,
    plan: user.monPlan
  });

}

async function enviarEvidencia(user, folio) {

  const url = `${URL_API}/evidencia`;

  try {

    if (!user.mediaUrl && !user.evidenciaRecibo) {
      return null;
    }
  
    const form = new FormData();

    form.append("folio", folio);
 
    const mediaResponse = await axios.get(user.mediaUrl, {
      responseType: "arraybuffer",  
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    });

    const contentType = mediaResponse.headers["content-type"] || "image/jpeg";
    const buffer = Buffer.from(mediaResponse.data, "binary");
 
    form.append("evidencia", buffer, {
      filename: "evidencia.jpg",
      contentType,
    }); 

    const headers = form.getHeaders();

    const response = await axios.post(url, form.getBuffer(), {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
 

    return true

  } catch (error) {
    console.error("❌ Error evidencia:", error.message);
    return null;
  }
}


app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor de SASP Energie corriendo...");
});
