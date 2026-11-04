#!/usr/bin/env bash
# Instala dependências (se preciso), compila o frontend e inicia o servidor
set -e
cd "$(dirname "$0")/webapp"
[ -d node_modules ] || npm install
npm start
