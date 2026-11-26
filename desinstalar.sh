#!/usr/bin/env bash
# Remove o Editor LaTeX instalado por ./instalar.sh. Os projetos NÃO são apagados.
set -euo pipefail

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/editor-latex"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/editor-latex"
PROJECTS_DIR=""
[ -f "$CONFIG_DIR/config" ] && PROJECTS_DIR="$(sed -n 's/^PROJECTS_DIR=//p' "$CONFIG_DIR/config" | tr -d '"')"

# Remove o serviço do acesso pela tailnet (./instalar.sh --tailscale), se existir
SERVICE_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/editor-latex.service"
if [ -f "$SERVICE_FILE" ]; then
  systemctl --user disable --now editor-latex.service >/dev/null 2>&1 || true
  rm -f "$SERVICE_FILE"
  systemctl --user daemon-reload 2>/dev/null || true
fi

# Encerra o servidor do app, se estiver aberto (só ele: o caminho é único)
pkill -f "$DATA_DIR/app/server.js" 2>/dev/null || true

rm -rf "$DATA_DIR" "$CONFIG_DIR"
rm -f "$HOME/.local/bin/editor-latex"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/editor-latex.desktop"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps/editor-latex.svg"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -n "$DESKTOP_DIR" ] && rm -f "$DESKTOP_DIR/editor-latex.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications" 2>/dev/null || true

echo "Editor LaTeX removido."
[ -n "$PROJECTS_DIR" ] && echo "Seus projetos continuam em: $PROJECTS_DIR" || true
