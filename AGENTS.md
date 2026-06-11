# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Memoria externa: Engram (OBLIGATORIO)

Este proyecto usa **Engram** como memoria persistente entre sesiones. Es la fuente de verdad del contexto que no está en el código.

- **Al empezar**: busca contexto previo con `mem_search` / `mem_context` antes de actuar.
- **De forma proactiva** (sin esperar a que lo pidan): guarda con `mem_save` toda decisión de arquitectura, bug resuelto (con causa raíz), convención, descubrimiento o gotcha. Usa el formato **What / Why / Where / Learned** y un `topic_key` estable para hacer upsert en vez de duplicar.
- **Antes de decir "listo"**: `mem_session_summary` con Goal / Discoveries / Accomplished / Relevant Files.
- Nombre de proyecto en Engram: `desktopmonitorecs`.

## Qué es

App de **barra de menú de macOS** (Electron, sin framework de UI) que monitoriza **AWS ECS** en modo **solo lectura**: clusters, servicios, tareas e instancias de contenedor. Distribución gratuita por Homebrew, **sin certificado de Apple Developer** (decisión firme del proyecto).

## Comandos

```bash
npm start            # desarrollo (electron .)
npm run gen-icons    # regenera iconos del tray y de la app (PNG procedural, sin deps)
npm run pack         # build local sin empaquetar -> dist/mac-*/ECS Monitor.app
npm run dist         # build completo .dmg + .zip

# Publicar una versión (requiere working tree limpio; npm version exige confirmación del usuario)
npm run release          # patch  1.1.0 -> 1.1.1
npm run release:minor    # minor  1.1.0 -> 1.2.0
npm run release:major    # major  1.1.0 -> 2.0.0
```

No hay tests ni linter configurados. Para validar cambios: `node --check <archivo>` + smoke test arrancando la app unos segundos.

> **No publiques releases sin confirmación explícita del usuario.** El comando `npm run release*` pushea a `main` y dispara un pipeline público; pídelo siempre antes.

> La caché de npm de esta máquina tiene permisos rotos: instala con `npm install --cache /tmp/npm-cache-dme`.

## Arquitectura

Electron clásico de 3 capas con `contextIsolation` (sin `nodeIntegration`):

- **`src/main.js`** — proceso main. Tray (clic izq = toggle del popup, clic der = menú), ventana frameless posicionada bajo el icono, atajo global (`⌘⇧E`, configurable), About panel, comprobación de versión nueva contra la GitHub API, y todos los handlers IPC. Las preferencias viven en `userData/settings.json`.
- **`src/ecs.js`** — única capa que habla con AWS (SDK v3). `listProfiles()` lee `~/.aws`; `fetchState({profile, region})` devuelve clusters con services/tasks/instances ya normalizados. **Respeta los límites de la API**: `DescribeServices` máx 10 ítems/llamada, `DescribeTasks`/`DescribeContainerInstances` máx 100 — mantén el batching al añadir llamadas.
- **`src/preload.js`** — `contextBridge` que expone `window.api` (única superficie main↔renderer). Toda nueva IPC pasa por aquí.
- **`src/renderer/`** — UI en vanilla JS. `app.js` tiene la lógica: dos pestañas (Clusters navegable con filtro / Favoritos), categorización de tareas y el **diff entre refrescos** para detectar tareas creadas/destruidas.

Flujo de datos: `renderer` pide estado por IPC → `main` delega en `ecs.js` → el renderer compara con el refresco anterior (por `taskArn`) para alimentar el feed de actividad y las notificaciones.

### Conceptos clave del dominio

- **Categorización de tareas** (`renderer/app.js`): `deploying` (PROVISIONING/PENDING/ACTIVATING), `running`, `stopping` (DEACTIVATING/STOPPING/DEPROVISIONING **o** RUNNING con `desiredStatus=STOPPED`), `stopped`.
- **Favoritos**: se guardan por `profile`+`region` (un cluster entero o un servicio concreto). El diff se resetea al cambiar de perfil/región.
- **Autenticación**: cadena de credenciales del SDK con `fromIni(profile)`. La app no almacena claves.

## Pipeline de distribución (totalmente automático)

`npm run release*` → tag `vX.Y.Z` → **`.github/workflows/release.yml`** construye `.dmg`+`.zip` universales (Intel+ARM, sin firma) y publica la release con `gh release create` → envía un `repository_dispatch` al tap → el workflow del tap actualiza `Casks/ecs-monitor.rb` (versión + sha256) → los usuarios reciben `brew upgrade --cask ecs-monitor`.

- Repo app: `github.com/elrincondeisma/desktop-monitor-ecs`. Tap: `github.com/elrincondeisma/homebrew-tap` (contiene también keypet; sigue sus convenciones).
- El dispatch requiere el secret **`TAP_TOKEN`** (PAT fine-grained con acceso a `homebrew-tap`) en el repo de la app. Si falta, el paso se omite sin fallar y el cask se actualiza a mano.
- **Gotcha**: el build construye con `--publish never` y publica con `gh` en un paso a propósito — `electron-builder --publish always` crea releases draft duplicadas (carrera al subir dmg/zip en paralelo).
- La app no está firmada: el cask quita la cuarentena en `postflight` (`xattr -d com.apple.quarantine`), por eso los usuarios no necesitan `--no-quarantine`. Homebrew moderno sí exige `brew trust elrincondeisma/tap` una vez.

## Convenciones

- **Idioma**: todo en español (UI, comentarios, mensajes de commit, comunicación).
- **Autoría**: Ismael Catala `<ismael@elrincondeisma.com>`.
- **Iconos**: generados por código en `scripts/` (encoders PNG propios, cero dependencias de imagen). No añadas binarios de iconos a mano; edita el script.
- **Sin firma de Apple** es una restricción deliberada, no una carencia: no introduzcas pasos que la requieran (p. ej. auto-update con electron-updater) sin discutirlo.
