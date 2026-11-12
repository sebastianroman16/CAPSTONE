# LEX-CORPUS frontend

Angular 21, componentes standalone, rutas con carga diferida, formularios reactivos y servicios HTTP. Proyecto independiente.

```sh
npm ci
npm start
npm run build
npm test
```

Requiere el backend en `127.0.0.1:3000`. Angular sirve en el puerto 4200. Accede por `http://localhost:4200` para coincidir con `FRONTEND_ORIGIN`.

`proxy.conf.json` redirige `/api/**` al backend. En producción se debe configurar el reverse proxy para servir `/api` desde NestJS bajo el mismo origen y devolver `index.html` para las rutas de Angular. La sesión se mantiene en una cookie HttpOnly; no hay tokens en localStorage.

- `src/app/core`: contratos, autenticación, guards y servicios HTTP.
- `src/app/layout`: navegación y estructura compartida.
- `src/app/features`: inicio de sesión, causas y perfil.
- `src/styles.css`: estilos compartidos derivados de los mockups de Fase 1.

[Guía completa del entorno](../README.md).
