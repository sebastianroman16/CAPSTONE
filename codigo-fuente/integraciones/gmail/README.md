# Reenvío automático de avisos del Poder Judicial (Gmail)

Este script deja que los avisos del Poder Judicial lleguen solos a la **Bandeja de movimientos** de LEX-CORPUS.

**Cómo funciona:**

1. Cada abogado reenvía automáticamente sus avisos a un Gmail central del sistema.
2. Cada 5 minutos, un script en ese Gmail busca los avisos nuevos y reconoce a qué abogado iban dirigidos.
3. El script envía el texto a LEX-CORPUS.
4. El abogado revisa la sugerencia en su bandeja y la confirma antes de que la vea el cliente.

Es gratis: usa Google Apps Script, que viene con cualquier cuenta de Gmail.

> Solo se envía el **texto** del correo. Los Excel y PDF adjuntos se siguen subiendo a mano en la bandeja.

---

## Antes de empezar

- **LEX-CORPUS debe estar accesible desde internet.** Si la aplicación corre solo en tu computador, abre un acceso temporal (paso 6).
- **El backend debe tener una clave secreta.** En `codigo-fuente/backend/.env` define `INGESTION_WEBHOOK_SECRET` con un texto largo y difícil de adivinar, y reinicia el backend. Ese mismo texto se usa en el paso 3.
- **Cada abogado debe existir en LEX-CORPUS con el mismo correo en que recibe los avisos.** Es la forma en que el sistema sabe de quién es cada aviso. Si hace falta, el abogado lo cambia en **Mi perfil**.

---

## Paso 1. Crear el Gmail central

Crea una cuenta de Gmail solo para el sistema, por ejemplo `lexcorpus.avisos@gmail.com`. No la uses para otra cosa.

## Paso 2. Pegar el script

1. Con esa cuenta abierta, entra a <https://script.google.com> y pulsa **Nuevo proyecto**.
2. Arriba, cambia el nombre "Proyecto sin título" por **LEX-CORPUS avisos**.
3. En el archivo `Código.gs`, borra todo lo que trae y pega completo el contenido de `lexcorpus-avisos.js` (está en esta misma carpeta).
4. Guarda con el ícono del disquete.

## Paso 3. Configurar la dirección y la clave

1. En el menú de la izquierda, entra a **Configuración del proyecto** (el ícono del engranaje).
2. Al final de la página, en **Propiedades de la secuencia de comandos**, pulsa **Agregar propiedad** y crea:

| Propiedad | Valor |
|---|---|
| `LEXCORPUS_URL` | La dirección pública de la aplicación, por ejemplo `https://algo.trycloudflare.com` |
| `WEBHOOK_SECRET` | El mismo texto de `INGESTION_WEBHOOK_SECRET` del backend |
| `BUSQUEDA` | Opcional. Qué correos revisar. Si no la pones, se usa `from:pjud.cl` |

3. Pulsa **Guardar propiedades de la secuencia de comandos**.

## Paso 4. Activarlo

1. Vuelve al **Editor** (ícono `< >`).
2. Arriba, en la lista de funciones, elige **instalar** y pulsa **Ejecutar**.
3. Google pedirá permisos. Elige la cuenta central.
4. Si aparece "Google no verificó esta aplicación", entra a **Configuración avanzada** y luego a **Ir a LEX-CORPUS avisos**. Es normal: el script es tuyo y no está publicado.
5. Acepta los permisos.
6. En el **Registro de ejecución** debe aparecer:
   - `Instalado: revisará los avisos cada 5 minutos.`
   - `Conexión con LEX-CORPUS: código 200`.

Desde ese momento revisa el Gmail cada 5 minutos, sin que tengas que hacer nada más.

## Paso 5. Reenvío desde el correo de cada abogado (Gmail)

Se hace una vez por abogado, en **su** cuenta de Gmail:

1. Abre **Configuración** (engranaje) → **Ver todos los ajustes** → **Reenvío y correo POP/IMAP**.
2. Pulsa **Agregar una dirección de reenvío**, escribe el Gmail central y confirma. Google manda un **código** al Gmail central: cópialo y pégalo en el campo de confirmación.
3. No actives "reenviar todo". En vez de eso, crea un filtro para que solo se reenvíen los avisos:
   - Ve a **Filtros y direcciones bloqueadas** → **Crear un filtro nuevo**.
   - En **De**, escribe `pjud.cl` → **Crear filtro**.
   - Marca **Reenviarlo a** y elige el Gmail central → **Crear filtro**.

> Si el abogado usa correo institucional, por ejemplo Outlook de la corporación, el reenvío a cuentas externas puede estar bloqueado. En ese caso hay que pedir autorización al área de informática.

## Paso 6. Acceso temporal desde internet (solo para la demostración)

Si la aplicación corre en tu Mac, el script no puede llegar a ella. Para abrir un acceso temporal gratuito:

```
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

1. La Terminal mostrará una dirección como `https://palabras-al-azar.trycloudflare.com`.
2. Cópiala en la propiedad `LEXCORPUS_URL` (paso 3).
3. Deja esa Terminal abierta mientras dure la demostración.

> La dirección **cambia cada vez** que ejecutas el comando. Actualiza `LEXCORPUS_URL` cada vez y ejecuta `probarConexion` para comprobarlo. Para que funcione de forma permanente, la aplicación tiene que estar desplegada.

---

## Probarlo en la demostración

Los avisos reales llegan desde `pjud.cl`. Para una prueba sin esperar uno:

1. En la cuenta Gmail del abogado de prueba, crea el filtro del paso 5, pero con **Asunto** `PRUEBA PJUD` en vez de **De** `pjud.cl`.
2. En la propiedad `BUSQUEDA` del script, pon `subject:"PRUEBA PJUD"`.
3. Desde cualquier correo, envía al Gmail del abogado un mensaje con asunto `PRUEBA PJUD causa C-4521-2026` y un texto como este:

   > En la causa RIT C-4521-2026 del 2° Juzgado de Familia de Santiago, se cita a las partes a audiencia preparatoria para el día 15 de diciembre de 2026 a las 09:30 horas.

4. En menos de 5 minutos el aviso aparece en la **Bandeja de movimientos** del abogado, con la fecha, la hora y el tribunal detectados. Para no esperar, en el script elige la función `procesarAvisos` y pulsa **Ejecutar**.

## Cómo revisar qué pasó

En el Gmail central, cada aviso queda con una etiqueta:

- **LEX-CORPUS/procesado**: llegó a la bandeja del abogado.
- **LEX-CORPUS/error**: no se pudo enviar. Por ejemplo, el correo no corresponde a ningún abogado de LEX-CORPUS, o el aviso venía sin texto.

En el script, el menú **Ejecuciones** muestra el registro de cada revisión, con el motivo de cada error.

| Mensaje en el registro | Qué hacer |
|---|---|
| `Secreto del webhook incorrecto o no configurado.` | `WEBHOOK_SECRET` no coincide con `INGESTION_WEBHOOK_SECRET` del backend. |
| `La dirección LEXCORPUS_URL no corresponde a la aplicación.` | Revisa la dirección: debe ser la del backend o la del acceso temporal, sin `/api` al final. |
| `La aplicación no respondió` | La aplicación o el acceso temporal están apagados. El aviso se reintenta solo en la siguiente revisión. |
| `No existe un abogado activo para el destinatario indicado.` | El correo del abogado en LEX-CORPUS no es el mismo en que recibe los avisos. |

Si un aviso quedó en **error** y ya corregiste la causa, quítale la etiqueta en Gmail y se procesará en la siguiente revisión. LEX-CORPUS nunca crea dos veces el mismo aviso.
