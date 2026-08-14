# Cuba Softbol — Roster, Estadísticas y Resultados

Sitio del equipo Cuba Softbol: roster con fotos, estadísticas de bateo/lanzadores/defensa por partido y de temporada, y resultados de partidos. Modo administrador con contraseña para cargar datos.

**Sitio en vivo:** https://cuba-softbol.netlify.app

## Cómo está armado

- **Frontend**: HTML/CSS/JS planos (`index.html`, `styles.css`, `app.js`), sin build ni frameworks.
- **Datos**: viven en **Airtable**, no en el navegador. Todos comparten el mismo roster/estadísticas/resultados.
- **Backend**: funciones serverless de **Netlify** (`netlify/functions/*.js`) que hacen de intermediario entre el sitio y Airtable — así el token de Airtable y la contraseña de admin nunca quedan expuestos en el código que ve el navegador.
- **Hosting**: Netlify, desplegado automáticamente desde GitHub (`master` = producción).

```
Navegador → Netlify Functions (players.js, games.js, upload-photo.js, login.js) → Airtable
```

## Estructura de archivos

```
index.html                    Toda la estructura de la página (roster, estadísticas, resultados, modales)
styles.css                    Todos los estilos
app.js                        Toda la lógica: fetch de datos, render, modo admin, modales
netlify.toml                  Config de Netlify (publish dir + functions dir)
netlify/functions/_lib.js     Helpers compartidos: llamadas a Airtable, chequeo de contraseña admin
netlify/functions/players.js  GET del roster
netlify/functions/games.js    GET/POST/PATCH/DELETE de partidos
netlify/functions/upload-photo.js  Sube la foto de un jugador a Airtable (Attachment field)
netlify/functions/login.js    Valida la contraseña de admin
assets/logo.png                Logo del equipo
```

## Esquema de Airtable

Base con dos tablas (los nombres de tabla no distinguen mayúsculas, pero los de **campo sí**, deben ser exactos):

### Tabla `Players`
| Campo | Tipo |
|---|---|
| `Name` | Single line text (campo principal) |
| `Number` | Single line text |
| `Photo` | Attachment |

### Tabla `Games`
| Campo | Tipo |
|---|---|
| `Date` | Date |
| `Opponent` | Single line text |
| `ScoreUs` | Number |
| `ScoreThem` | Number |
| `PlayerStats` | Long text — JSON `{ [playerId]: {AB,R,H,2B,3B,HR,RBI,BB,SO,SB} }` |
| `PitcherStats` | Long text — JSON `{ [nombreLanzador]: {IP,H,R,ER,BB,SO,HR} }` (nombre libre, no vinculado a `Players`) |
| `DefenseStats` | Long text — JSON `{ [playerId]: {POS,PO,A,E} }` |

Los campos `*Stats` guardan JSON como texto plano; las funciones de Netlify (`games.js`) hacen el `JSON.parse`/`JSON.stringify` en ambas direcciones.

## Variables de entorno (Netlify → Project configuration → Environment variables)

| Variable | Qué es |
|---|---|
| `AIRTABLE_TOKEN` | Personal Access Token de Airtable (scopes `data.records:read` + `data.records:write`, con acceso a esta base) |
| `AIRTABLE_BASE_ID` | ID de la base (empieza con `app...`) |
| `ADMIN_PASSWORD` | Contraseña del modo entrenador/admin |
| `AIRTABLE_PLAYERS_TABLE` | Opcional, default `Players` |
| `AIRTABLE_GAMES_TABLE` | Opcional, default `Games` |

Después de cambiar una variable hay que volver a desplegar (**Deploys → Trigger deploy**) para que se aplique.

## Cómo hacer cambios

1. El código vive en GitHub: **https://github.com/dprida26/cuba-softball**
2. Edita los archivos (localmente, con un editor, o pidiéndole a Claude que lo haga).
3. Para cambios de riesgo medio/alto, o que agregan un campo nuevo de Airtable: crea una rama y un Pull Request — Netlify genera automáticamente una URL de vista previa (`deploy-preview-N--cuba-softbol.netlify.app`) con datos reales de Airtable para probar antes de tocar producción.
4. Fusiona a `master` cuando esté aprobado → Netlify despliega solo a `cuba-softbol.netlify.app`.

```bash
git checkout -b nombre-de-la-rama
# ...editar...
git add -A
git commit -m "Descripción del cambio"
git push -u origin nombre-de-la-rama
# abrir PR en GitHub, revisar el deploy preview, luego fusionar a master
```

Para cambios chicos y de bajo riesgo (ajustes de CSS, texto) se puede subir directo a `master`.

## Notas importantes

- Los `IP` (entradas lanzadas) usan la notación real de béisbol: el dígito después del punto son *outs* (0, 1 o 2), no décimas — 1.2 + 1.1 = 3.0, no 2.3. Por eso el campo IP en el formulario es un contador (botones −/+), no texto libre.
- Los adjuntos de Airtable (fotos) tienen URLs que **expiran y se regeneran** — por eso el sitio siempre pide el roster fresco a Airtable en cada carga en vez de guardar las URLs.
- El pitcheo se identifica por **nombre de texto libre** (con autocompletado del roster), no por ID de jugador, porque cualquier jugador puede lanzar en un partido dado.
