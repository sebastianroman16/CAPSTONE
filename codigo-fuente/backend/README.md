# LEX-CORPUS backend

NestJS 11 con módulos de autenticación, usuarios, causas y conexión PostgreSQL mediante `pg`. SQL parametrizado y migraciones versionadas; no se sincroniza ni modifica el esquema automáticamente al iniciar.

```sh
npm ci
cp .env.example .env
# Editar SEED_PASSWORD antes de ejecutar db:seed
npm run db:migrate
npm run db:seed
npm run start:dev
```

```sh
npm run build
npm start
npm test
```

- `src/auth`: sesiones opacas revocables, cookies HttpOnly, bloqueo temporal por intentos fallidos y hash de contraseña scrypt con sal individual.
- `src/cases`: reglas de acceso por propietario, DTOs, operaciones e importación segura de causas desde Excel.
- `src/users`: consulta de clientes asociados al abogado.
- `src/database`: pool de PostgreSQL y cierre ordenado.
- `src/product`: agenda, comunicaciones, documentos, notificaciones e ingesta confirmable.
- `src/assistant`: asistente simulado, coincidencia aproximada, historial y cuotas.
- `migrations`: esquema SQL versionado.
- `scripts`: migración transaccional y datos ficticios explícitos.
- `test`: pruebas HTTP de integración con esquema PostgreSQL aislado.

`GET /api/health` comprueba PostgreSQL. Las sesiones tienen un máximo absoluto de 8 horas y expiran también por inactividad: el frontend avisa a los 3 minutos, muestra una cuenta regresiva de 10 segundos y `POST /api/auth/extend` confirma la continuidad contra el servidor. El backend valida su propia marca de actividad (con un pequeño margen de red), por lo que manipular el temporizador del navegador no permite revivir una sesión. El cierre revoca la sesión y conserva el registro para trazabilidad. Los endpoints de lectura tampoco devuelven contraseñas ni tokens.

Cada petición autenticada renueva `last_seen_at` de manera atómica. La interfaz envía como máximo un pulso por minuto cuando detecta interacción real; si no hay interacción, no mantiene la sesión artificialmente activa.

## Importación de causas desde Excel

Un abogado puede cargar un `.xlsx` de hasta 5 MB y 500 causas desde `POST /api/case-imports`. El flujo conserva el archivo sólo como datos normalizados en un lote temporal de 30 minutos: primero propone el mapeo de columnas, luego valida clientes, campos y duplicados, y finalmente importa únicamente las filas válidas. Los clientes deben existir, estar activos y pertenecer a la cartera del abogado; el servidor asigna siempre `lawyer_id` desde la sesión y nunca desde la planilla.

No se aceptan macros, fórmulas, enlaces ni celdas con errores. Cada lote sólo puede consultarlo y confirmarlo su propietario. La confirmación revalida dentro de una transacción serializable y no permite importar el mismo lote dos veces. La migración `006_case_imports.sql` crea los lotes temporales y sus restricciones.

## Modelo de datos reforzado

La migración `004_domain_hardening.sql` agrega historial temporal de asignaciones abogado-cliente, participantes de causa, historial de estados, plazos, documentos versionados, solicitudes documentales, notificaciones, recuperación de contraseña y auditoría. Los triggers de PostgreSQL validan que los roles y la cartera correspondan antes de aceptar una causa y mantienen sincronizados los participantes principales. La auditoría excluye deliberadamente hashes de contraseña y notas internas.

El servidor escucha en loopback para desarrollo. Para un despliegue en contenedores será necesario configurar la interfaz de escucha, el reverse proxy HTTPS y las credenciales del entorno. Con `NODE_ENV=production` la cookie usa `Secure` y el seed se rechaza.

En producción la API rechaza peticiones que no lleguen mediante HTTPS (directamente o con `X-Forwarded-Proto: https` desde un proxy de confianza). La contraseña del login queda cifrada en tránsito por TLS y solo se compara en el servidor contra un hash `scrypt` con sal; no se almacena ni se registra en texto plano. No se utiliza cifrado reversible en JavaScript porque no agrega protección frente a un atacante de red y expondría el mecanismo de descifrado al cliente.

[Guía completa del entorno](../README.md).

## Flujos de producto completados

La migración `007_complete_product_flows.sql` agrega cambio obligatorio de contraseña, comunicaciones e ingesta. Los plazos, documentos, solicitudes y notificaciones de la migración 004 cuentan ahora con API e interfaz. Los archivos se guardan fuera de PostgreSQL en `DOCUMENT_STORAGE_PATH`; la base conserva metadatos, versión y checksum.

Las migraciones 009 y 010 agregan idempotencia para correo entrante, trazabilidad de respuestas documentales, administración de cuentas, participación de clientes con más de un abogado y un historial explícito de reasignaciones. El coordinador puede consultar `/api/admin/users`, revocar o reactivar accesos, reasignar causas y revisar `/api/admin/audit`. Toda reasignación mantiene la causa y sus documentos, incrementa su versión y registra responsable anterior, nuevo responsable, autor y motivo.

Los envíos externos usan `NOTIFICATION_WEBHOOK_URL`, con un payload que incluye `channel`, `to` y `message`. La recuperación usa `RESET_DELIVERY_WEBHOOK_URL`. En desarrollo, si no hay webhook, la API entrega un token de prueba; en producción nunca lo expone.

El alta de un cliente desde una causa puede entregar las credenciales mediante `CLIENT_CREDENTIALS_WEBHOOK_URL`. El payload incluye `to`, `name`, `temporaryPassword`, `loginUrl` y la plantilla `client-welcome`. El cliente queda marcado para cambiar obligatoriamente esa clave: mientras no lo haga, la API solo permite consultar/editar el perfil, renovar la sesión, cambiar la contraseña o cerrarla.

Para ingesta automática, configura un secreto robusto en `INGESTION_WEBHOOK_SECRET` y conecta el proveedor de correo a `POST /api/webhooks/ingestion/email`. Debe enviar el encabezado `X-Ingestion-Secret` y JSON con `messageId`, `lawyerEmail`, `subject` y `text`. `messageId` es idempotente: reenviar el mismo correo no duplica movimientos.

La bandeja de ingesta exige confirmación humana. `GEMINI_API_KEY` habilita el resumen asistido; si falta o falla, la extracción por reglas continúa operativa. Confirmar un movimiento crea una comunicación y una notificación visibles para el cliente.

## Asistente simulado Lexi

La migración `008_simulated_assistant.sql` crea el banco `assistant_knowledge`, conversaciones y mensajes vinculados al `user_id`. El banco inicial cubre uso de causas, clientes, agenda, documentos, notificaciones, seguridad, importación, roles y límites del producto.

El servidor normaliza mayúsculas y tildes, elimina palabras vacías y calcula coincidencias aproximadas mediante distancia de edición. Así tolera errores habituales sin presentar una respuesta de baja confianza como cierta. Cada usuario dispone de 20 preguntas al día y el endpoint aplica además un máximo de ocho envíos por minuto. Lexi explica el producto, pero no entrega asesoría jurídica ni envía información a un modelo externo.

## Coordinación jurídica

- `GET /api/supervision`: solo `SUPERVISOR`; filtros opcionales `lawyerId`, `status`, `stage`, `attention=needed`, `q` y `page` (desde 1). Devuelve resumen global, cifras por abogado y hasta 20 causas por página. Los filtros afectan la lista, no el resumen global. Consultas con parámetros inválidos responden 400.
- `GET /api/supervision/cases/:id`: detalle global de solo lectura e historial reciente, sin notas privadas.
- `GET /api/cases/:id/progress`: historial autorizado para el abogado responsable o un coordinador; hasta 100 eventos recientes.
- `PATCH /api/cases/:id/progress`: solo el abogado responsable, en causas activas. Cuerpo `{version,stage,summary,nextAction}`. Resumen de 10 a 2000 caracteres; próxima acción de hasta 1000 caracteres (puede estar vacía). Las etapas editables son `ASSESSMENT`, `PREPARATION`, `IN_PROGRESS`, `FOLLOW_UP`, `COMPLETED`; `NOT_REPORTED` se reserva al estado inicial.

Los avances y sus eventos se guardan en una misma sentencia atómica y comparten el contador de versión con edición y archivo (409 si quedó obsoleto). No hay endpoints para modificar roles, reasignar causas ni editar o eliminar eventos. El coordinador no tiene permisos de escritura sobre las causas. El alcance global corresponde a una sola organización; aún no hay separación por sedes o equipos.

## Edición segura de causas

La migración `002_case_version.sql` incorpora `cases.version`, inicialmente 1. Las respuestas de causas incluyen `version`; `PUT /api/cases/:id` exige ese entero junto con los datos del formulario y `PATCH /api/cases/:id/archive` exige `{ "version": 1 }`, usando el valor consultado. Cada operación aceptada incrementa el contador de forma atómica. Una versión antigua responde 409 con `code: CASE_VERSION_CONFLICT`; una versión ausente o inválida responde 400. Se debe consultar la causa actual y revisar los cambios antes de reenviar.
