# Código fuente de LEX CORPUS

Esta carpeta contiene la aplicación desarrollada para el proyecto Capstone LEX CORPUS. La solución funciona como una plataforma complementaria para organizar causas jurídicas y consultar información según el rol de cada usuario.

La implementación se divide en tres componentes independientes:

```text
codigo-fuente/
├── frontend/          Aplicación web Angular 21
├── backend/           API REST NestJS 11
└── infraestructura/   PostgreSQL 17 para desarrollo local
```

## Funcionalidades disponibles

- Inicio y cierre de sesión con acceso diferenciado por rol.
- Gestión de causas para abogados: registro, edición, consulta y archivo.
- Búsqueda y filtros por materia, prioridad y estado.
- Portal de consulta para clientes, sin exposición de notas internas.
- Panel de supervisión para coordinación jurídica con acceso de solo lectura.
- Registro e historial de avances de las causas.
- Importación de causas desde Excel con previsualización y validación.
- Protección frente a ediciones concurrentes mediante versión de la causa.
- Control de inactividad, renovación y revocación de sesiones.

## Requisitos

- Node.js 24.x.
- npm 11 o una versión compatible con Node.js 24.
- Docker Desktop con Docker Compose.
- Puertos disponibles:
  - `4200` para Angular.
  - `3000` para NestJS.
  - `55432` para PostgreSQL.

Puedes comprobar las versiones instaladas con:

```bash
node --version
npm --version
docker --version
docker compose version
```

## 1. Iniciar PostgreSQL

Desde la raíz de `codigo-fuente`:

```bash
cd infraestructura
cp .env.example .env
docker compose --env-file .env up -d --wait
```

La configuración de ejemplo utiliza exclusivamente una contraseña de desarrollo local. No debe reutilizarse en producción.

Para comprobar el estado del contenedor:

```bash
docker compose --env-file .env ps
```

## 2. Configurar y ejecutar el backend

Abre una terminal nueva y entra en el backend:

```bash
cd codigo-fuente/backend
npm ci
cp .env.example .env
```

Edita `backend/.env` y define `SEED_PASSWORD` con una contraseña local de al menos 12 caracteres. La variable `DATABASE_URL` debe utilizar la misma contraseña configurada en `infraestructura/.env`.

Ejemplo de configuración local:

```dotenv
DATABASE_URL=postgresql://lex_corpus:lex_local_dev@localhost:55432/lex_corpus
PORT=3000
FRONTEND_ORIGIN=http://localhost:4200
NODE_ENV=development
SEED_PASSWORD=CAMBIAR_POR_UNA_CLAVE_LOCAL
```

Aplica las migraciones, crea los usuarios ficticios e inicia la API:

```bash
npm run db:migrate
npm run db:seed
npm run start:dev
```

La API quedará disponible en `http://localhost:3000/api`. El endpoint `http://localhost:3000/api/health` permite comprobar la conexión con PostgreSQL.

## 3. Ejecutar el frontend

Abre otra terminal:

```bash
cd codigo-fuente/frontend
npm ci
npm start
```

Abre `http://localhost:4200` en el navegador. El proxy de desarrollo envía las solicitudes `/api` al backend local.

## Usuarios de desarrollo

El comando `npm run db:seed` crea cuentas ficticias para probar cada rol:

| Rol | Correo |
|---|---|
| Abogado | `abogado@example.test` |
| Cliente | `cliente@example.test` |
| Coordinador jurídico | `coordinador@example.test` |

Las tres cuentas utilizan el valor local definido en `SEED_PASSWORD`. El seed no reemplaza las contraseñas de cuentas que ya existen.

## Compilación y pruebas

### Backend

Con PostgreSQL activo y `backend/.env` configurado:

```bash
cd codigo-fuente/backend
npm run build
npm test
```

Las pruebas crean un esquema temporal, ejecutan las migraciones y eliminan únicamente ese esquema al finalizar.

### Frontend

```bash
cd codigo-fuente/frontend
npm run build
npm test
```

## Detener el entorno

Detén los procesos de Angular y NestJS con `Ctrl+C`. Para detener PostgreSQL sin borrar los datos:

```bash
cd codigo-fuente/infraestructura
docker compose --env-file .env stop
```

Para retirar los contenedores conservando el volumen:

```bash
docker compose --env-file .env down
```

No uses `docker compose down -v` si necesitas conservar la base de datos local.

## Seguridad y alcance

- Los archivos `.env`, dependencias instaladas y compilaciones no se incluyen en Git.
- Las credenciales y datos incluidos en el seed son ficticios.
- El proyecto corresponde a un entorno académico de desarrollo local.
- Antes de utilizar datos reales se requieren HTTPS, gestión de secretos, respaldos, políticas de conservación, auditoría operativa y una revisión completa de permisos.
- La solución todavía no se integra con SAJ ni con proveedores externos de inteligencia artificial.

## Documentación adicional

- `backend/README.md`: detalles de la API, sesiones, importación y modelo de datos.
- `frontend/README.md`: ejecución y funcionalidades de la interfaz.
- `infraestructura/compose.yaml`: servicio PostgreSQL para desarrollo.
