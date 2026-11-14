CREATE TABLE assistant_knowledge (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent varchar(80) UNIQUE NOT NULL,
  question varchar(300) NOT NULL,
  answer varchar(2000) NOT NULL,
  keywords text[] NOT NULL,
  audience varchar(20) NOT NULL DEFAULT 'ALL'
    CHECK (audience IN ('ALL','LAWYER','CLIENT','SUPERVISOR')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversations_user ON assistant_conversations(user_id,updated_at DESC);

CREATE TABLE assistant_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(10) NOT NULL CHECK (role IN ('USER','ASSISTANT')),
  content varchar(3000) NOT NULL,
  matched_knowledge_id integer REFERENCES assistant_knowledge(id),
  confidence numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_messages_timeline ON assistant_messages(conversation_id,id);
CREATE INDEX assistant_messages_user_usage ON assistant_messages(user_id,created_at DESC) WHERE role='USER';

INSERT INTO assistant_knowledge(intent,question,answer,keywords,audience) VALUES
('welcome','¿Qué puede hacer este asistente?','Soy Lexi, el asistente informativo de LEX-CORPUS. Puedo explicar cómo usar causas, clientes, agenda, documentos, notificaciones, importación y seguridad. Mis respuestas provienen de un banco revisado; no reemplazo a un abogado ni entrego asesoría jurídica.',ARRAY['ayuda','hacer','puedes','asistente','lexi'],'ALL'),
('legal_advice','¿Puedes darme asesoría legal?','No. Puedo explicar el funcionamiento de LEX-CORPUS y conceptos generales del proceso, pero no interpreto una causa ni recomiendo acciones legales. Para una decisión jurídica debes contactar al abogado responsable.',ARRAY['asesoria','legal','consejo','demandar','recomiendas','abogado'],'ALL'),
('saj','¿LEX-CORPUS reemplaza al SAJ?','No. LEX-CORPUS complementa al SAJ para organizar trabajo, documentos y comunicaciones. El registro oficial de la causa continúa en los sistemas institucionales correspondientes.',ARRAY['saj','reemplaza','oficial','poder','judicial'],'ALL'),
('case_create','¿Cómo registro una causa?','Como abogado, abre “Registrar causa”, selecciona el cliente, completa carátula, materia, tribunal y prioridad, y guarda. La referencia interna se genera automáticamente.',ARRAY['crear','registrar','nueva','causa','caso'],'LAWYER'),
('case_edit','¿Cómo edito una causa?','Abre el detalle de la causa y selecciona “Editar causa”. Si otra sesión cambió la información, LEX-CORPUS conservará tu borrador y te pedirá revisar la versión más reciente.',ARRAY['editar','modificar','cambiar','causa','datos'],'LAWYER'),
('case_archive','¿Cómo archivo una causa?','Desde el detalle de una causa activa selecciona “Archivar causa” y confirma. El archivo es lógico: conserva historial y documentos, pero impide nuevas modificaciones operativas.',ARRAY['archivar','cerrar','eliminar','borrar','causa'],'LAWYER'),
('case_status','¿Dónde veo el estado de mi causa?','En “Mis causas” abre la causa correspondiente. Allí verás estado, tribunal, prioridad, próxima fecha y las comunicaciones que el abogado haya publicado para el cliente.',ARRAY['estado','avance','ver','causa','como','va'],'CLIENT'),
('case_history','¿Puedo ver el historial de mi causa?','Sí. En el detalle aparecen las comunicaciones publicadas y sus fechas. Los avances internos de gestión y las notas privadas permanecen restringidos al equipo jurídico.',ARRAY['historial','linea','tiempo','anteriores','movimientos'],'CLIENT'),
('client_create','¿Cómo creo una cuenta de cliente?','En “Mis clientes”, completa nombre, correo y teléfono. Se mostrará una contraseña temporal una sola vez; entrégala por un canal seguro. El cliente deberá cambiarla al ingresar.',ARRAY['crear','cliente','cuenta','alta','registrar'],'LAWYER'),
('password_change','¿Cómo cambio mi contraseña?','En “Mi perfil y seguridad” ingresa tu contraseña actual y una nueva de al menos 12 caracteres. Al guardar, las sesiones anteriores quedan revocadas.',ARRAY['cambiar','clave','contrasena','password','seguridad'],'ALL'),
('password_recovery','Olvidé mi contraseña, ¿qué hago?','En la pantalla de inicio selecciona “¿Olvidaste tu contraseña?”. Ingresa tu correo y sigue el enlace de recuperación. El enlace vence y solo puede utilizarse una vez.',ARRAY['olvide','recuperar','contrasena','clave','acceso'],'ALL'),
('profile','¿Cómo actualizo mis datos?','Abre “Mi perfil” para modificar nombre, correo y teléfono. El sistema valida que el correo no esté utilizado por otra cuenta.',ARRAY['perfil','nombre','correo','telefono','datos','actualizar'],'ALL'),
('agenda','¿Dónde veo mis pendientes?','Abre “Agenda y pendientes”. Puedes elegir un rango de fechas, abrir la causa relacionada y marcar un pendiente como realizado.',ARRAY['agenda','pendientes','plazos','fechas','recordatorios'],'ALL'),
('deadline_create','¿Cómo agrego un recordatorio?','En el detalle de una causa usa “Registrar fecha y recordatorio”, escribe el pendiente y selecciona fecha y hora. Aparecerá en tu agenda.',ARRAY['agregar','crear','recordatorio','fecha','plazo'],'LAWYER'),
('excel_import','¿Cómo importo causas desde Excel?','Abre “Importar desde Excel”, descarga la plantilla, carga un archivo .xlsx, revisa el mapeo y la vista previa, y confirma solo las filas válidas. El sistema descarta duplicados y filas con errores.',ARRAY['excel','importar','planilla','xlsx','carga','masiva'],'LAWYER'),
('excel_error','¿Por qué una fila de Excel fue rechazada?','La vista previa indica el motivo exacto. Revisa correo del cliente, campos obligatorios, materia, prioridad, fechas, duplicados y que el cliente pertenezca a tu cartera.',ARRAY['excel','error','fila','rechazada','invalida','duplicado'],'LAWYER'),
('documents','¿Dónde están los documentos de una causa?','En el detalle de la causa encontrarás “Documentos de la causa”. Los archivos visibles para clientes pueden descargarse allí; los documentos internos no se exponen al portal cliente.',ARRAY['documentos','archivos','repositorio','descargar','adjuntos'],'ALL'),
('document_request','¿Cómo solicito un documento al cliente?','En el detalle de la causa usa “Solicitar documento”, indica qué necesitas y una fecha límite opcional. El cliente recibirá una notificación y podrá responder cargando el archivo.',ARRAY['solicitar','pedir','documento','cliente','archivo'],'LAWYER'),
('document_reply','¿Cómo respondo una solicitud de documento?','Abre la causa y revisa “Solicitudes documentales”. En “Documentos de la causa” selecciona el archivo y súbelo; la solicitud pendiente quedará cumplida.',ARRAY['responder','subir','entregar','documento','solicitud'],'CLIENT'),
('notifications','¿Dónde veo mis notificaciones?','Abre “Notificaciones”. Allí aparecen nuevos estados, solicitudes documentales y movimientos confirmados. Puedes abrir la causa relacionada y marcar cada aviso como leído.',ARRAY['notificaciones','avisos','alertas','mensajes','bandeja'],'ALL'),
('communication','¿Cómo envío una actualización al cliente?','En el detalle de la causa escribe el estado en “Comunicación trazable”, elige bandeja interna, correo o WhatsApp y envía. El historial conserva fecha, autor, canal y estado de entrega.',ARRAY['enviar','estado','actualizacion','comunicar','cliente'],'LAWYER'),
('ingestion','¿Qué es la bandeja de movimientos?','Permite procesar texto o notificaciones recibidas, detectar referencia, fecha y tribunal, y preparar un resumen. Nada llega al cliente hasta que el abogado lo revisa y confirma.',ARRAY['ingesta','bandeja','movimientos','pjud','correo','procesar'],'LAWYER'),
('ai_real','¿Este asistente usa inteligencia artificial real?','Este chat funciona con un banco de respuestas y coincidencia tolerante a errores de escritura. No envía tus preguntas a un modelo externo ni genera costos por consulta.',ARRAY['ia','inteligencia','artificial','real','modelo','chatgpt'],'ALL'),
('privacy','¿Quién puede ver mis datos?','Cada rol accede solo a lo necesario. El cliente ve sus propias causas y documentos autorizados; el abogado ve su cartera; coordinación posee supervisión de solo lectura. Las notas internas no se muestran al cliente.',ARRAY['privacidad','datos','ver','permisos','roles','notas'],'ALL'),
('session','¿Por qué se cerró mi sesión?','Por seguridad, la sesión expira por inactividad o al alcanzar su duración máxima. Antes del cierre se muestra una advertencia para confirmar que continúas activo.',ARRAY['sesion','cerro','expira','inactividad','salio'],'ALL'),
('priority','¿Qué significan las prioridades?','Alta, Media y Baja ayudan al abogado a ordenar su trabajo. Son una clasificación interna de gestión y no representan la urgencia oficial definida por un tribunal.',ARRAY['prioridad','alta','media','baja','urgencia'],'ALL'),
('supervision','¿Qué puede hacer coordinación jurídica?','Coordinación puede consultar causas de todos los abogados, aplicar filtros, revisar avances y detectar casos que requieren atención. Su acceso es de solo lectura.',ARRAY['coordinacion','supervisor','supervision','equipo','abogados'],'SUPERVISOR'),
('limits','¿Cuántas preguntas puedo hacer?','Cada usuario puede realizar hasta 20 preguntas por día. El límite simula el control de consumo de una IA externa y se reinicia al comenzar un nuevo día.',ARRAY['limite','preguntas','cuantas','cuota','disponibles'],'ALL'),
('contact','No encontré la respuesta que buscaba','Prueba con una frase corta indicando la función, por ejemplo “importar Excel”, “subir documento” o “recuperar contraseña”. Si la duda es jurídica o específica de una causa, contacta al abogado responsable.',ARRAY['no','entiendo','respuesta','contacto','ayuda','otra'],'ALL');
