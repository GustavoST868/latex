#!/usr/bin/env bash
# Instala o Editor LaTeX como um aplicativo do computador (Linux), baixando
# e instalando tudo o que ele precisa.
#
#   ./instalar.sh                      instala ou atualiza
#   ./instalar.sh --texlive-completo   instala o TeX Live inteiro (cerca de 6 GB)
#   ./instalar.sh --ia                 instala também o assistente de IA (Ollama + modelo)
#   ./instalar.sh --sem-ia             não pergunta sobre o assistente de IA
#   ./instalar.sh --sem-dependencias   não instala programas do sistema, só verifica
#   PASTA_PROJETOS=~/x ./instalar.sh   escolhe onde ficam os projetos
#   MODELO_IA=gemma3:4b ./instalar.sh --ia   escolhe o modelo baixado para a IA
#
# O que ele faz:
#   - instala pelo gerenciador de pacotes (apt, dnf, pacman ou zypper) o TeX Live
#     com os pacotes usados pelos modelos (abnTeX2, Beamer, português, biber,
#     XeLaTeX, LuaLaTeX), o latexmk, o texcount e o git; pede a senha (sudo)
#     apenas se faltar algum
#   - usa o Node.js do sistema se for 18 ou mais novo; senão, baixa a versão LTS
#     oficial de nodejs.org para dentro da pasta do app (sem sudo)
#   - copia o app para ~/.local/share/editor-latex/app e compila a interface
#   - cria o comando "editor-latex" em ~/.local/bin
#   - adiciona "Editor LaTeX" ao menu de aplicativos (e à área de trabalho)
#   - guarda os projetos em ~/Documentos/Projetos-LaTeX (ou PASTA_PROJETOS)
# Rodar de novo atualiza o app sem mexer nos projetos.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/editor-latex"
APP_DIR="$DATA_DIR/app"
NODE_DIR="$DATA_DIR/node"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/editor-latex"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/editor-latex.desktop"
ICON_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps/editor-latex.svg"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/editor-latex/config"
PORT="${PORTA:-3141}"
AI_MODEL="${MODELO_IA:-qwen3.5:9b}"
OLLAMA_URL="http://127.0.0.1:11434"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

# ── Opções ────────────────────────────────────────────────────────────────────
TEX_FULL=0
WITH_AI=""
INSTALL_DEPS=1
for arg in "$@"; do
  case "$arg" in
    --texlive-completo) TEX_FULL=1 ;;
    --ia) WITH_AI=1 ;;
    --sem-ia) WITH_AI=0 ;;
    --sem-dependencias) INSTALL_DEPS=0 ;;
    -h|--ajuda|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Opção desconhecida: $arg (veja ./instalar.sh --ajuda)" ;;
  esac
done

# O app é instalado para o usuário; o sudo é pedido só para os pacotes do sistema
if [ "$(id -u)" -eq 0 ]; then
  fail "Não rode o instalador com sudo. Rode ./instalar.sh como usuário normal; a senha é pedida quando for preciso."
fi

# ── Gerenciador de pacotes ────────────────────────────────────────────────────
PM=""
for candidate in apt-get dnf pacman zypper; do
  if command -v "$candidate" >/dev/null; then PM="$candidate"; break; fi
done

# lista de pacotes de cada distribuição: base, TeX Live (seleção) e TeX Live completo
case "$PM" in
  apt-get)
    PKGS_BASE=(git curl ca-certificates xdg-utils xdg-user-dirs libnotify-bin)
    PKGS_TEX=(latexmk biber lmodern texlive-latex-base texlive-latex-recommended
      texlive-latex-extra texlive-fonts-recommended texlive-lang-portuguese
      texlive-lang-english texlive-publishers texlive-bibtex-extra texlive-science
      texlive-pictures texlive-xetex texlive-luatex texlive-extra-utils)
    PKGS_TEX_FULL=(texlive-full latexmk biber)
    ;;
  dnf)
    PKGS_BASE=(git curl xdg-utils xdg-user-dirs libnotify)
    PKGS_TEX=(texlive-latexmk biber texlive-lm texlive-synctex texlive-texcount
      texlive-collection-latexrecommended texlive-collection-latexextra
      texlive-collection-fontsrecommended texlive-collection-langportuguese
      texlive-collection-langenglish texlive-collection-publishers
      texlive-collection-bibtexextra texlive-collection-mathscience
      texlive-collection-pictures texlive-collection-xetex texlive-collection-luatex)
    PKGS_TEX_FULL=(texlive-scheme-full biber)
    ;;
  pacman)
    PKGS_BASE=(git curl xdg-utils xdg-user-dirs libnotify)
    PKGS_TEX=(texlive-basic texlive-latex texlive-latexrecommended texlive-latexextra
      texlive-fontsrecommended texlive-langportuguese texlive-publishers
      texlive-bibtexextra texlive-mathscience texlive-pictures texlive-xetex
      texlive-luatex texlive-binextra biber)
    PKGS_TEX_FULL=(texlive texlive-lang biber)
    ;;
  zypper)
    PKGS_BASE=(git curl xdg-utils xdg-user-dirs libnotify-tools)
    PKGS_TEX=(texlive-latexmk biber texlive-lm texlive-synctex texlive-texcount
      texlive-collection-latexrecommended texlive-collection-latexextra
      texlive-collection-fontsrecommended texlive-collection-langportuguese
      texlive-collection-langenglish texlive-collection-publishers
      texlive-collection-bibtexextra texlive-collection-mathscience
      texlive-collection-pictures texlive-collection-xetex texlive-collection-luatex)
    PKGS_TEX_FULL=(texlive-scheme-full biber)
    ;;
esac

# diz se um pacote do sistema já está instalado
pkg_installed() {
  case "$PM" in
    apt-get) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "ok installed" ;;
    dnf|zypper) rpm -q "$1" >/dev/null 2>&1 ;;
    pacman) pacman -Qi "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# instala só os pacotes que faltam (assim, sem nada faltando, não pede senha)
APT_UPDATED=0
install_pkgs() {
  local missing=() p
  for p in "$@"; do pkg_installed "$p" || missing+=("$p"); done
  if [ "${#missing[@]}" -eq 0 ]; then return 0; fi
  info "Instalando: ${missing[*]}"
  info "(será pedida a sua senha de administrador; pode levar vários minutos)"
  case "$PM" in
    apt-get)
      if [ "$APT_UPDATED" -eq 0 ]; then sudo apt-get update -qq; APT_UPDATED=1; fi
      sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}" ;;
    dnf) sudo dnf install -y "${missing[@]}" ;;
    pacman) sudo pacman -S --needed --noconfirm "${missing[@]}" ;;
    zypper) sudo zypper --non-interactive install "${missing[@]}" ;;
  esac
}

# ── Programas do sistema ──────────────────────────────────────────────────────
if [ "$INSTALL_DEPS" -eq 1 ]; then
  if [ -z "$PM" ]; then
    warn "Gerenciador de pacotes não reconhecido (apt, dnf, pacman ou zypper)."
    warn "Instale à mão: TeX Live, latexmk, biber, texcount, git e curl."
  else
    command -v sudo >/dev/null || fail "O sudo não foi encontrado; ele é preciso para instalar os programas do sistema."
    bold "Instalando programas do sistema (via $PM)"
    install_pkgs "${PKGS_BASE[@]}"
    ok "Utilitários (git, curl, xdg-utils)"
    if [ "$TEX_FULL" -eq 1 ]; then
      install_pkgs "${PKGS_TEX_FULL[@]}"
      ok "TeX Live completo"
    else
      install_pkgs "${PKGS_TEX[@]}"
      ok "TeX Live (LaTeX, abnTeX2, Beamer, português, XeLaTeX, LuaLaTeX, biber, latexmk)"
    fi
  fi
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
# diz se o node e o npm do PATH servem (versão 18 ou mais nova)
node_usable() {
  command -v node >/dev/null && command -v npm >/dev/null || return 1
  [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]
}

# baixa a versão LTS mais recente do Node.js para dentro da pasta do app
download_node() {
  local arch tmp version file
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l) arch=armv7l ;;
    *) fail "Arquitetura $(uname -m) sem Node.js pronto; instale o Node.js 18+ à mão." ;;
  esac
  command -v curl >/dev/null || fail "O curl é preciso para baixar o Node.js."
  tmp="$(mktemp -d)"
  version="$(curl -fsSL https://nodejs.org/dist/index.tab | awk -F'\t' 'NR > 1 && $10 != "-" { print $1; exit }')"
  [ -n "$version" ] || fail "Não foi possível descobrir a versão LTS do Node.js (sem internet?)."
  file="node-$version-linux-$arch.tar.gz"
  info "Baixando Node.js $version"
  curl -fsSL "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  curl -fL --progress-bar "https://nodejs.org/dist/$version/$file" -o "$tmp/$file"
  (cd "$tmp" && grep "  $file\$" SHASUMS256.txt | sha256sum -c --quiet -) \
    || fail "O arquivo baixado do Node.js não confere com o checksum oficial."
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
}

bold "Verificando o Node.js"
NODE_BIN="node"
if node_usable; then
  ok "Node.js $(node -v) do sistema"
else
  if [ ! -x "$NODE_DIR/bin/node" ] || ! PATH="$NODE_DIR/bin:$PATH" node_usable; then
    [ "$INSTALL_DEPS" -eq 1 ] || fail "É preciso o Node.js 18 ou mais novo (rode sem --sem-dependencias para baixá-lo)."
    download_node
  fi
  export PATH="$NODE_DIR/bin:$PATH"
  NODE_BIN="$NODE_DIR/bin/node"
  ok "Node.js $(node -v) próprio do app, em $NODE_DIR"
fi
ok "npm $(npm -v)"

# ── Verificação final das ferramentas ─────────────────────────────────────────
bold "Verificando ferramentas"
if command -v latexmk >/dev/null; then ok "latexmk"; else warn "latexmk não encontrado: sem ele não dá para compilar."; fi
for tool in pdflatex xelatex lualatex biber synctex texcount git; do
  if command -v "$tool" >/dev/null; then ok "$tool"; else warn "$tool não encontrado (algumas funções ficam indisponíveis)"; fi
done

BROWSER=""
for b in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge microsoft-edge-stable vivaldi-stable; do
  if command -v "$b" >/dev/null; then BROWSER="$b"; break; fi
done
if [ -n "$BROWSER" ]; then ok "Janela própria usando $BROWSER"; else warn "Nenhum Chrome/Chromium/Edge/Brave encontrado: o app abrirá no navegador padrão"; fi

# ── Assistente de IA (opcional) ───────────────────────────────────────────────
# diz se o servidor do Ollama está respondendo
ollama_up() { curl -fsS "$OLLAMA_URL/api/tags" >/dev/null 2>&1; }

if [ -z "$WITH_AI" ]; then
  if command -v ollama >/dev/null; then
    WITH_AI=1
  elif [ -t 0 ] && [ "$INSTALL_DEPS" -eq 1 ]; then
    echo
    read -r -p "  Instalar também o assistente de IA (Ollama + modelo $AI_MODEL, cerca de 7 GB)? [s/N] " answer || answer=""
    case "$answer" in s|S|sim|Sim|SIM|y|Y) WITH_AI=1 ;; *) WITH_AI=0 ;; esac
  else
    WITH_AI=0
  fi
fi

if [ "$WITH_AI" -eq 1 ]; then
  bold "Assistente de IA (Ollama)"
  if ! command -v ollama >/dev/null; then
    command -v curl >/dev/null || fail "O curl é preciso para baixar o Ollama."
    tmp="$(mktemp -d)"
    curl -fsSL https://ollama.com/install.sh -o "$tmp/ollama-install.sh"
    info "Instalando o Ollama (será pedida a sua senha)"
    sh "$tmp/ollama-install.sh"
    rm -rf "$tmp"
  fi
  ok "Ollama $(ollama --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)+' | head -1)"
  # sem o serviço do systemd, sobe o servidor só para baixar o modelo
  OLLAMA_PID=""
  if ! ollama_up; then
    nohup ollama serve >/dev/null 2>&1 &
    OLLAMA_PID=$!
    for _ in $(seq 1 50); do ollama_up && break; sleep 0.2; done
  fi
  if ! ollama_up; then
    warn "O Ollama não respondeu; baixe o modelo depois com: ollama pull $AI_MODEL"
  elif [ "$(ollama list 2>/dev/null | tail -n +2 | wc -l)" -gt 0 ]; then
    ok "Modelo já instalado ($(ollama list | awk 'NR == 2 { print $1 }'))"
  else
    info "Baixando o modelo $AI_MODEL"
    if ollama pull "$AI_MODEL"; then ok "Modelo $AI_MODEL"; else warn "Falha ao baixar o modelo; tente depois com: ollama pull $AI_MODEL"; fi
  fi
  [ -n "$OLLAMA_PID" ] && kill "$OLLAMA_PID" 2>/dev/null || true
fi

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
  export NPM_CONFIG_UPDATE_NOTIFIER=false
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
NODE_BIN="$NODE_BIN"
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
NODE_BIN=node
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
    nohup "$NODE_BIN" "$APP_DIR/server.js" >"$LOG_FILE" 2>&1 &
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
