# Cask de Homebrew para ECS Monitor.
#
# Este archivo vive en tu repositorio "tap": github.com/TU_USUARIO/homebrew-tap
# en la ruta Casks/ecs-monitor.rb. En cada release hay que actualizar
# `version` y `sha256` (sha256 del zip: `shasum -a 256 ECSMonitor-X.Y.Z-universal.zip`).
#
# Instalación por parte de los usuarios:
#   brew tap TU_USUARIO/tap
#   brew install --cask ecs-monitor --no-quarantine
#
cask "ecs-monitor" do
  version "0.1.0"
  sha256 "REEMPLAZAR_CON_SHA256_DEL_ZIP"

  url "https://github.com/TU_USUARIO/desktop-monitor-ecs/releases/download/v#{version}/ECSMonitor-#{version}-universal.zip"
  name "ECS Monitor"
  desc "Monitor de AWS ECS en la barra de menú: clusters, servicios y tareas"
  homepage "https://github.com/TU_USUARIO/desktop-monitor-ecs"

  app "ECS Monitor.app"

  zap trash: [
    "~/Library/Application Support/desktop-monitor-ecs",
  ]

  caveats <<~EOS
    Esta app no está firmada con un certificado de Apple Developer.
    Si no la instalaste con --no-quarantine, macOS la bloqueará la primera vez.
    Para desbloquearla:
      xattr -cr "/Applications/ECS Monitor.app"
  EOS
end
