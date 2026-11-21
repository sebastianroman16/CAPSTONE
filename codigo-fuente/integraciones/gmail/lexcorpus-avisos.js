/**
 * LEX-CORPUS · Reenvío de avisos del Poder Judicial desde un Gmail central.
 *
 * Se pega completo en un proyecto de Google Apps Script del Gmail central del sistema
 * (instrucciones en README.md de esta carpeta). Cada 5 minutos busca los avisos nuevos,
 * identifica al abogado destinatario y envía el texto al webhook de ingesta de LEX-CORPUS
 * (POST /api/webhooks/ingestion/email). El abogado revisa la sugerencia en su bandeja
 * antes de que llegue al cliente.
 *
 * Configuración (Configuración del proyecto → Propiedades de la secuencia de comandos):
 *   LEXCORPUS_URL     Dirección pública de la aplicación, por ejemplo https://xxxx.trycloudflare.com
 *   WEBHOOK_SECRET    El mismo valor de INGESTION_WEBHOOK_SECRET en el backend.
 *   BUSQUEDA          (opcional) Qué correos procesar. Por defecto: from:pjud.cl
 *
 * Las funciones de la primera parte no usan servicios de Google, por eso se prueban
 * en Node (backend/test/gmail-avisos.test.mjs).
 */

var ETIQUETA_PROCESADO = "LEX-CORPUS/procesado";
var ETIQUETA_ERROR = "LEX-CORPUS/error";
var BUSQUEDA_POR_DEFECTO = "from:pjud.cl";
var MAXIMO_HILOS_POR_EJECUCION = 30;
var MAXIMO_TEXTO = 100000;

// ---------------------------------------------------------------------------
// Parte 1: lógica sin servicios de Google (probada en Node)
// ---------------------------------------------------------------------------

/** Extrae las direcciones de correo de un encabezado ("Ana <ana@x.cl>, b@y.cl"), en minúsculas y sin repetir. */
function extraerCorreos(valor) {
  if (!valor) return [];
  var encontrados = String(valor).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  var unicos = [];
  for (var i = 0; i < encontrados.length; i++) {
    var correo = encontrados[i].toLowerCase();
    if (unicos.indexOf(correo) === -1) unicos.push(correo);
  }
  return unicos;
}

/**
 * Identifica al abogado al que iba dirigido el aviso.
 * Cuando el abogado reenvía automáticamente, el correo conserva el destinatario original;
 * Gmail además agrega X-Forwarded-For con la casilla que reenvió. Se usa, en orden:
 * X-Forwarded-For, Para, Cc y, si el abogado reenvió el correo a mano, el remitente (De).
 * Siempre se descarta la casilla central.
 */
function identificarAbogado(encabezados, correoCentral) {
  var central = String(correoCentral || "").toLowerCase();
  var fuentes = [encabezados.reenviadoPor, encabezados.para, encabezados.cc, encabezados.de];
  for (var i = 0; i < fuentes.length; i++) {
    var correos = extraerCorreos(fuentes[i]);
    for (var j = 0; j < correos.length; j++) {
      if (correos[j] !== central) return correos[j];
    }
  }
  return null;
}

/**
 * Arma el cuerpo que espera el webhook. Devuelve { payload } o { error } si el aviso no se puede enviar.
 * messageId usa el Message-ID del correo para que el backend no procese dos veces el mismo aviso.
 */
function armarEnvio(mensaje, correoCentral) {
  var abogado = identificarAbogado(mensaje, correoCentral);
  if (!abogado) return { error: "No se encontró el correo del abogado destinatario." };
  var texto = String(mensaje.texto || "").replace(/\r\n/g, "\n").trim();
  if (texto.length < 10) return { error: "El aviso no tiene texto suficiente para analizar." };
  var asunto = String(mensaje.asunto || "").trim();
  if (asunto.length < 3) asunto = "Aviso sin asunto";
  var id = String(mensaje.messageId || mensaje.idGmail || "").trim();
  if (id.length < 3) return { error: "El aviso no tiene identificador." };
  return {
    payload: {
      messageId: id.slice(0, 255),
      lawyerEmail: abogado,
      subject: asunto.slice(0, 255),
      text: texto.slice(0, MAXIMO_TEXTO),
    },
  };
}

/**
 * Decide qué hacer según la respuesta del webhook:
 *  procesado  → etiquetar como procesado.
 *  error      → etiquetar como error (no tiene arreglo reintentando, por ejemplo abogado no registrado).
 *  reintentar → no etiquetar; se vuelve a intentar en la próxima ejecución (aplicación caída o saturada).
 *  detener    → la configuración está mal (secreto o dirección); se detiene la ejecución.
 */
function clasificarRespuesta(codigo, cuerpo) {
  var mensaje = "";
  try {
    var datos = JSON.parse(cuerpo || "{}");
    mensaje = Array.isArray(datos.message) ? datos.message.join(" ") : String(datos.message || "");
  } catch (e) {
    mensaje = "";
  }
  if (codigo >= 200 && codigo < 300) return { accion: "procesado", detalle: mensaje };
  if (codigo === 401 || codigo === 403) return { accion: "detener", detalle: "Secreto del webhook incorrecto o no configurado." };
  if (codigo === 404 && /abogado/i.test(mensaje)) return { accion: "error", detalle: mensaje };
  if (codigo === 404) return { accion: "detener", detalle: "La dirección LEXCORPUS_URL no corresponde a la aplicación." };
  if (codigo === 400 || codigo === 413 || codigo === 422) return { accion: "error", detalle: mensaje || "La aplicación rechazó el aviso." };
  return { accion: "reintentar", detalle: "La aplicación no respondió (código " + codigo + ")." };
}

/** Dirección completa del webhook a partir de la dirección pública de la aplicación. */
function direccionWebhook(base) {
  var limpia = String(base || "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
  if (!/^https?:\/\//.test(limpia)) return null;
  return limpia + "/api/webhooks/ingestion/email";
}

// ---------------------------------------------------------------------------
// Parte 2: funciones que se ejecutan en Google Apps Script
// ---------------------------------------------------------------------------

/** Ejecutar una vez: crea las etiquetas y deja programada la revisión cada 5 minutos. */
function instalar() {
  GmailApp.getUserLabelByName(ETIQUETA_PROCESADO) || GmailApp.createLabel(ETIQUETA_PROCESADO);
  GmailApp.getUserLabelByName(ETIQUETA_ERROR) || GmailApp.createLabel(ETIQUETA_ERROR);
  var disparadores = ScriptApp.getProjectTriggers();
  for (var i = 0; i < disparadores.length; i++) {
    if (disparadores[i].getHandlerFunction() === "procesarAvisos") ScriptApp.deleteTrigger(disparadores[i]);
  }
  ScriptApp.newTrigger("procesarAvisos").timeBased().everyMinutes(5).create();
  Logger.log("Instalado: revisará los avisos cada 5 minutos.");
  probarConexion();
}

/** Comprueba que la aplicación responde en la dirección configurada. */
function probarConexion() {
  var props = PropertiesService.getScriptProperties();
  var webhook = direccionWebhook(props.getProperty("LEXCORPUS_URL"));
  if (!webhook) throw new Error("Falta la propiedad LEXCORPUS_URL (debe empezar con https://).");
  if (!props.getProperty("WEBHOOK_SECRET")) throw new Error("Falta la propiedad WEBHOOK_SECRET.");
  var salud = webhook.replace("/webhooks/ingestion/email", "/health");
  var respuesta = UrlFetchApp.fetch(salud, { muteHttpExceptions: true });
  Logger.log("Conexión con LEX-CORPUS: código " + respuesta.getResponseCode() + " · " + respuesta.getContentText());
}

/** Revisa los avisos nuevos y los envía a LEX-CORPUS. La ejecuta el disparador cada 5 minutos. */
function procesarAvisos() {
  var bloqueo = LockService.getScriptLock();
  if (!bloqueo.tryLock(1000)) return; // otra ejecución sigue en curso
  try {
    var props = PropertiesService.getScriptProperties();
    var webhook = direccionWebhook(props.getProperty("LEXCORPUS_URL"));
    var secreto = props.getProperty("WEBHOOK_SECRET");
    if (!webhook || !secreto) throw new Error("Configura LEXCORPUS_URL y WEBHOOK_SECRET antes de procesar avisos.");
    var busqueda = (props.getProperty("BUSQUEDA") || BUSQUEDA_POR_DEFECTO) +
      " -label:" + ETIQUETA_PROCESADO.replace("/", "-") + " -label:" + ETIQUETA_ERROR.replace("/", "-");
    var procesado = GmailApp.getUserLabelByName(ETIQUETA_PROCESADO) || GmailApp.createLabel(ETIQUETA_PROCESADO);
    var conError = GmailApp.getUserLabelByName(ETIQUETA_ERROR) || GmailApp.createLabel(ETIQUETA_ERROR);
    var central = Session.getEffectiveUser().getEmail();
    var hilos = GmailApp.search(busqueda, 0, MAXIMO_HILOS_POR_EJECUCION);

    for (var i = 0; i < hilos.length; i++) {
      var mensajes = hilos[i].getMessages();
      var resultadoHilo = "procesado";
      for (var j = 0; j < mensajes.length; j++) {
        var m = mensajes[j];
        var envio = armarEnvio({
          reenviadoPor: m.getHeader("X-Forwarded-For"),
          para: m.getTo(),
          cc: m.getCc(),
          de: m.getFrom(),
          asunto: m.getSubject(),
          texto: m.getPlainBody(),
          messageId: m.getHeader("Message-ID"),
          idGmail: m.getId(),
        }, central);
        if (envio.error) {
          Logger.log("Aviso \"" + m.getSubject() + "\": " + envio.error);
          resultadoHilo = "error";
          continue;
        }
        var respuesta = UrlFetchApp.fetch(webhook, {
          method: "post",
          contentType: "application/json",
          headers: { "x-ingestion-secret": secreto },
          payload: JSON.stringify(envio.payload),
          muteHttpExceptions: true,
        });
        var decision = clasificarRespuesta(respuesta.getResponseCode(), respuesta.getContentText());
        if (decision.accion === "detener") throw new Error(decision.detalle);
        if (decision.accion === "reintentar") { resultadoHilo = "reintentar"; Logger.log(decision.detalle); break; }
        if (decision.accion === "error") { resultadoHilo = "error"; Logger.log("Aviso \"" + m.getSubject() + "\": " + decision.detalle); }
      }
      if (resultadoHilo === "procesado") hilos[i].addLabel(procesado);
      else if (resultadoHilo === "error") hilos[i].addLabel(conError);
      else break; // la aplicación no responde: se reintenta todo en la próxima ejecución
    }
  } finally {
    bloqueo.releaseLock();
  }
}

// Permite probar la parte 1 en Node. En Apps Script "module" no existe y esto se ignora.
if (typeof module !== "undefined") {
  module.exports = { extraerCorreos: extraerCorreos, identificarAbogado: identificarAbogado, armarEnvio: armarEnvio, clasificarRespuesta: clasificarRespuesta, direccionWebhook: direccionWebhook };
}
