# Desktop Monitor ECS

App de barra de menú para macOS (Electron) que monitoriza AWS ECS en modo solo lectura: clusters, servicios con su estado de despliegue, tareas (activas, desplegándose, desactivándose, detenidas) e instancias de contenedor.

## Instalación (usuarios)

Con [Homebrew](https://brew.sh):

```bash
brew tap elrincondeisma/tap
brew trust elrincondeisma/tap   # Homebrew moderno lo exige para taps de terceros
brew install --cask ecs-monitor
```

> La app no está firmada con certificado de Apple; el cask elimina la cuarentena automáticamente al instalar. Si en su lugar descargas el `.dmg` de [Releases](../../releases), tras moverla a Aplicaciones ejecuta `xattr -cr "/Applications/ECS Monitor.app"`.

## Requisitos

- Node.js 20+
- Credenciales AWS en `~/.aws/credentials` / `~/.aws/config` (la app lista tus perfiles)
- Permisos IAM de lectura: `ecs:ListClusters`, `ecs:DescribeClusters`, `ecs:ListServices`, `ecs:DescribeServices`, `ecs:ListTasks`, `ecs:DescribeTasks`, `ecs:ListContainerInstances`, `ecs:DescribeContainerInstances`

## Uso

```bash
npm install
npm start
```

Aparece un icono en la barra de menú:

- **Clic izquierdo**: abre/cierra el panel de estado
- **Clic derecho**: menú con opción de salir
- El icono muestra `⟳N` cuando hay N despliegues o tareas en transición (solo de tus favoritos si tienes alguno), y `!` si hay error de conexión

En el panel eliges perfil AWS, región e intervalo de refresco (15s/30s/60s/manual). La selección se guarda entre sesiones.

### Pestañas

- **Clusters**: todos los clusters de la región, colapsables, con buscador para filtrar por nombre de cluster o servicio. Cada cluster y cada servicio tiene una estrella ☆ para fijarlo en favoritos.
- **★ Favoritos**: tus clusters/servicios fijados siempre a la vista con sus tareas, más un feed de **Actividad** que registra cada tarea creada o destruida (comparando refrescos consecutivos). Las tareas recién creadas llevan la etiqueta `nueva` durante 10 minutos.

Los favoritos se guardan por perfil y región. El botón 🔔 activa/desactiva las notificaciones de macOS cuando se crea o destruye una tarea de tus favoritos.

## Estados

| Color | Significado |
|---|---|
| 🟢 verde | Servicio estable / tarea RUNNING / instancia ACTIVE |
| 🟡 ámbar | Despliegue en curso / tarea PROVISIONING-PENDING-ACTIVATING |
| 🟠 naranja | Tarea desactivándose (DEACTIVATING/STOPPING) / servicio degradado / instancia DRAINING |
| 🔴 rojo | Despliegue fallido / health check unhealthy / agente desconectado |
| ⚪ gris | Tareas detenidas (colapsadas, con su `stoppedReason`) |

## Distribución (mantenedor)

La app se distribuye gratis y sin certificado de Apple: GitHub Releases + tap de Homebrew.

1. **Publicar una versión** (un solo comando, requiere working tree limpio):
   ```bash
   npm run release         # 0.1.0 -> 0.1.1 (bugfixes)
   npm run release:minor   # 0.1.0 -> 0.2.0 (funcionalidad nueva)
   npm run release:major   # 0.1.0 -> 1.0.0 (cambios grandes)
   ```
   Esto sube la versión en `package.json`, commitea, crea el tag y lo pushea. GitHub Actions (`.github/workflows/release.yml`) construye el `.dmg` y `.zip` universales (Intel + Apple Silicon, sin firma) y los publica en Releases.

2. **El tap se actualiza solo**: al terminar el build, el workflow envía un `repository_dispatch` a `elrincondeisma/homebrew-tap` con la versión y el sha256, y el workflow del tap actualiza `Casks/ecs-monitor.rb`. Requiere el secret `TAP_TOKEN` en este repo (el mismo PAT que usa keypet). Si falta el secret, se puede actualizar a mano: `shasum -a 256 ECSMonitor-X.Y.Z-universal.zip` y editar versión y sha en el cask.

Build local de prueba: `npm run pack` (genera `dist/mac-arm64/ECS Monitor.app` sin empaquetar). Build completo: `npm run dist`.

> Nota: al no estar firmada, los usuarios necesitan `--no-quarantine` o `xattr -cr`. Si algún día quieres eliminar esa fricción, basta con añadir firma + notarización al workflow (requiere cuenta Apple Developer, 99 $/año).

## Estructura

- `src/main.js` — proceso main: tray, ventana popup, IPC, ajustes
- `src/ecs.js` — llamadas al AWS SDK v3 (paginación y batching incluidos)
- `src/preload.js` — puente seguro main ↔ renderer (contextIsolation)
- `src/renderer/` — UI del popup (vanilla JS, sin framework)
- `scripts/gen-icons.js` — regenera los iconos template del tray
