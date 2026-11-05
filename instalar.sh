#!/usr/bin/env bash
# Instala o Editor LaTeX como um aplicativo do computador (Linux).
#
#   ./instalar.sh                 instala ou atualiza
#   PASTA_PROJETOS=~/x ./instalar.sh   escolhe onde ficam os projetos
#
# O que ele faz:
#   - copia o app para ~/.local/share/editor-latex/app e compila a interface
#   - cria o comando "editor-latex" em ~/.local/bin
#   - adiciona "Editor LaTeX" ao menu de aplicativos (e à área de trabalho)
#   - guarda os projetos em ~/Documentos/Projetos-LaTeX (ou PASTA_PROJETOS)
# Rodar de novo atualiza o app sem mexer nos projetos.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/editor-latex"
APP_DIR="$DATA_DIR/app"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/editor-latex"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/editor-latex.desktop"
ICON_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps/editor-latex.svg"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/editor-latex/config"
PORT="${PORTA:-3141}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

# ── Requisitos ────────────────────────────────────────────────────────────────
bold "Verificando requisitos"
command -v node >/dev/null || fail "Node.js não encontrado. Instale com: sudo apt install nodejs npm"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "É preciso o Node.js 18 ou mais novo (encontrado: $(node -v))"
ok "Node.js $(node -v)"
command -v npm >/dev/null || fail "npm não encontrado. Instale com: sudo apt install npm"
ok "npm $(npm -v)"
if command -v latexmk >/dev/null; then ok "latexmk"; else warn "latexmk não encontrado: sem ele não dá para compilar. Instale com: sudo apt install texlive-full latexmk"; fi
for tool in synctex texcount git; do
  if command -v "$tool" >/dev/null; then ok "$tool"; else warn "$tool não encontrado (algumas funções ficam indisponíveis)"; fi
done

BROWSER=""
for b in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge microsoft-edge-stable vivaldi-stable; do
  if command -v "$b" >/dev/null; then BROWSER="$b"; break; fi
done
if [ -n "$BROWSER" ]; then ok "Janela própria usando $BROWSER"; else warn "Nenhum Chrome/Chromium/Edge/Brave encontrado: o app abrirá no navegador padrão"; fi

# ── Pasta dos projetos ────────────────────────────────────────────────────────
if [ -z "${PASTA_PROJETOS:-}" ] && [ -f "$CONFIG_FILE" ]; then
  # Reinstalação: mantém a pasta escolhida antes
  PASTA_PROJETOS="$(sed -n 's/^PROJECTS_DIR=//p' "$CONFIG_FILE" | tr -d '"')"
fi
if [ -z "${PASTA_PROJETOS:-}" ]; then
  DOCS="$(xdg-user-dir DOCUMENTS 2>/dev/null || true)"
  [ -n "$DOCS" ] && [ "$DOCS" != "$HOME" ] || DOCS="$HOME/Documentos"
  PASTA_PROJETOS="$DOCS/Projetos-LaTeX"
fi
mkdir -p "$PASTA_PROJETOS"

# ── Copia e compila o app ─────────────────────────────────────────────────────
bold "Instalando o app em $APP_DIR"
mkdir -p "$APP_DIR"
# Copia o código (sem dependências, build e projetos de desenvolvimento)
tar -C "$REPO_DIR/webapp" \
  --exclude=./node_modules --exclude=./dist --exclude=./projects \
  -cf - . | tar -C "$APP_DIR" -xf -
ok "Arquivos copiados"

(
  cd "$APP_DIR"
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
  npm run build --silent >/dev/null
  npm prune --omit=dev --no-audit --no-fund --loglevel=error >/dev/null
)
ok "Interface compilada"

# Projetos que já estavam no repositório vão para a nova pasta (sem sobrescrever)
if [ -d "$REPO_DIR/webapp/projects" ]; then
  for p in "$REPO_DIR"/webapp/projects/*/; do
    [ -d "$p" ] || continue
    name="$(basename "$p")"
    if [ ! -e "$PASTA_PROJETOS/$name" ]; then
      cp -r "$p" "$PASTA_PROJETOS/$name"
      ok "Projeto \"$name\" copiado para $PASTA_PROJETOS"
    fi
  done
fi

# ── Configuração e lançador ───────────────────────────────────────────────────
mkdir -p "$(dirname "$CONFIG_FILE")" "$BIN_DIR"
cat > "$CONFIG_FILE" <<EOF
# Configuração do Editor LaTeX (lida pelo comando editor-latex)
PROJECTS_DIR="$PASTA_PROJETOS"
PORT=$PORT
EOF
ok "Configuração em $CONFIG_FILE"

cat > "$LAUNCHER" <<'EOF'
#!/usr/bin/env bash
# Abre o Editor LaTeX em uma janela própria, iniciando o servidor local se preciso.
# O servidor encerra sozinho uns segundos depois que a última janela fecha.
set -u
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/editor-latex"
APP_DIR="$DATA_DIR/app"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/editor-latex/config"
LOG_FILE="$DATA_DIR/servidor.log"
PORT=3141
PROJECTS_DIR="$HOME/Documentos/Projetos-LaTeX"
# shellcheck disable=SC1090
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"
URL="http://localhost:$PORT"

running() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

notify() {
  command -v notify-send >/dev/null && notify-send -i editor-latex "Editor LaTeX" "$1"
  echo "$1" >&2
}

if ! running; then
  mkdir -p "$DATA_DIR"
  PORT="$PORT" PROJECTS_DIR="$PROJECTS_DIR" NO_OPEN=1 EXIT_WHEN_IDLE=20 \
    nohup node "$APP_DIR/server.js" >"$LOG_FILE" 2>&1 &
  for _ in $(seq 1 50); do running && break; sleep 0.2; done
  if ! running; then
    notify "O servidor não iniciou. Veja $LOG_FILE"
    exit 1
  fi
fi

for b in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge microsoft-edge-stable vivaldi-stable; do
  if command -v "$b" >/dev/null; then
    # Perfil separado: janela própria, com ícone próprio na barra de tarefas
    exec "$b" --app="$URL" --class=EditorLatex --name=editor-latex \
      --user-data-dir="$DATA_DIR/janela" --no-first-run --no-default-browser-check \
      >/dev/null 2>&1
  fi
done
exec xdg-open "$URL"
EOF
chmod +x "$LAUNCHER"
ok "Comando: $LAUNCHER"

# ── Ícone e atalho no menu ────────────────────────────────────────────────────
mkdir -p "$(dirname "$ICON_FILE")" "$(dirname "$DESKTOP_FILE")"
cp "$REPO_DIR/installer/icon.svg" "$ICON_FILE"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Editor LaTeX
GenericName=Editor de LaTeX
Comment=Escreva documentos LaTeX com visualização do PDF, no estilo do Overleaf
Exec=$LAUNCHER
Icon=editor-latex
Terminal=false
Categories=Office;
Keywords=latex;tex;pdf;overleaf;abnt;
StartupNotify=true
StartupWMClass=EditorLatex
EOF
chmod +x "$DESKTOP_FILE"
command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" 2>/dev/null || true
ok "Atalho no menu de aplicativos"

# Atalho na área de trabalho, quando ela existe
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
if [ -n "$DESKTOP_DIR" ] && [ "$DESKTOP_DIR" != "$HOME" ] && [ -d "$DESKTOP_DIR" ]; then
  cp "$DESKTOP_FILE" "$DESKTOP_DIR/editor-latex.desktop"
  chmod +x "$DESKTOP_DIR/editor-latex.desktop"
  # GNOME só abre atalhos marcados como confiáveis
  command -v gio >/dev/null && gio set "$DESKTOP_DIR/editor-latex.desktop" metadata::trusted true 2>/dev/null || true
  ok "Atalho na área de trabalho"
fi

echo
bold "Pronto! O Editor LaTeX está instalado."
echo "  • Abra pelo menu de aplicativos (procure por \"Editor LaTeX\") ou rode: editor-latex"
echo "  • Seus projetos ficam em: $PASTA_PROJETOS"
echo "  • Para atualizar depois, rode ./instalar.sh de novo; para remover, ./desinstalar.sh"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR não está no PATH; o comando editor-latex só funciona depois de sair e entrar na sessão." ;;
esac
