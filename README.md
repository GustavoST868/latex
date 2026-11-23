# Documentação do Projeto LaTeX Studio

## Visão Geral

Este projeto é um ambiente completo para trabalho com documentos LaTeX, combinando uma aplicação web inspirada no Overleaf com uma estrutura local para compilação via linha de comando. A proposta é oferecer flexibilidade ao usuário, permitindo tanto a edição tradicional através de editores locais quanto uma interface web moderna com visualização em tempo real do PDF gerado.

O repositório está organizado em duas partes principais: a estrutura de documentos LaTeX na raiz e a aplicação web dentro do diretório `webapp/`. Essa divisão permite que o projeto funcione independentemente da interface web, sendo possível editar e compilar os documentos apenas com um editor de texto e o script shell disponibilizado.

---

## Estrutura do Projeto

Na raiz do repositório encontramos os arquivos que constituem o documento LaTeX principal. O arquivo `arquivo.tex` contém uma apresentação acadêmica no formato Beamer, destinada a um trabalho sobre extração de relações ontológicas em artigos científicos do domínio geológico, especificamente focado no Pré-Sal brasileiro. O arquivo `referencias.bib` mantém o banco de dados de referências bibliográficas no formato BibTeX, enquanto o `compilar.sh` automatiza todo o processo de compilação.

O diretório `webapp/` abriga uma aplicação Node.js que fornece uma interface gráfica para edição e compilação de projetos LaTeX. Essa aplicação inclui um servidor Express, uma interface frontend em HTML/CSS/JavaScript, e utiliza WebSockets para comunicação em tempo real entre o servidor e o navegador.

---

## O Documento LaTeX

O arquivo principal `arquivo.tex` é uma apresentação acadêmica desenvolvida com a classe Beamer do LaTeX. A escolha do tema minimalista com cores neutras e a proporção de aspecto 16:9 demonstra uma preocupação com a estética moderna das apresentações. O documento está configurado para o português brasileiro através dos pacotes de internacionalização adequados.

O conteúdo da apresentação aborda um estudo de extração de relações ontológicas utilizando técnicas de processamento de linguagem natural aplicadas a um corpus de artigos científicos sobre o Pré-Sal. O autor, Gustavo Santos Teixeira, está vinculado à Universidade Federal do Rio Grande do Sul, e a apresentação inclui o logotipo do Instituto de Informática da instituição.

As referências bibliográficas são gerenciadas através do arquivo `referencias.bib`, que contém entradas de diferentes tipos como livros, artigos de revista, anais de congressos e relatórios técnicos. O estilo de citação utilizado segue as normas da ABNT através do pacote `abntex2cite`, o que é essencial para trabalhos acadêmicos brasileiros.

---

## Script de Compilação

O arquivo `compilar.sh` é um script Bash que automatiza o processo de compilação do documento LaTeX. A sequência de comandos segue o padrão recomendado para documentos que utilizam bibliografias: primeiro executa o `pdflatex` para gerar os arquivos auxiliares, depois processa as referências com `bibtex`, e finalmente executa mais duas passagens do `pdflatex` para resolver todas as referências cruzadas e gerar o documento final.

Ao final do processo, o script remove os arquivos temporários gerados durante a compilação, como arquivos auxiliares, logs e metadados. Isso mantém o diretório de trabalho limpo, preservando apenas o PDF resultante. O script também inclui um comando comentado para instalação do pacote `texlive-full`, útil para configurar novas máquinas.

---

## Aplicação Web

A aplicação web é o componente mais elaborado do projeto, oferecendo uma experiência similar à de editores online profissionais como o Overleaf. Desenvolvida em Node.js, a aplicação utiliza o framework Express para gerenciar as rotas da API e servir os arquivos estáticos do frontend.

### Arquitetura do Servidor

O servidor `server.js` implementa uma API RESTful completa para gerenciamento de projetos e arquivos. Cada projeto é armazenado como um subdiretório dentro da pasta `webapp/projects/`, permitindo que o usuário trabalhe com múltiplos documentos simultaneamente. A API permite criar, listar, renomear e excluir projetos, além de gerenciar os arquivos dentro de cada projeto.

O sistema de arquivos da API suporta diferentes tipos: arquivos de texto (como .tex, .bib, .txt, .md), PDFs e imagens. Quando um projeto é criado, o servidor automaticamente gera um arquivo `main.tex` com um template básico para que o usuário possa começar a trabalhar imediatamente.

O processo de compilação é executado através de chamadas ao sistema operacional, utilizando os mesmos comandos do script shell local. O servidor mantém uma conexão WebSocket com os clientes para transmitir o log de compilação em tempo real, permitindo que o usuário acompanhe o progresso e identifique erros conforme acontecem.

### Interface do Usuário

O frontend é uma aplicação de página única que apresenta uma interface dividida em dois painéis. À esquerda fica o editor de código com numeração de linhas, e à direita a visualização do PDF gerado. A barra superior contém controles para salvar o documento, compilar o PDF, fazer download do arquivo e visualizar o log de compilação.

O editor implementa funcionalidades essenciais como autocomplete com a tecla Tab para inserir espaços de indentação, atalhos de teclado para salvar (Ctrl+S) e compilar (Ctrl+Enter), e indicadores visuais que mostram o estado atual do documento. Um divisor redimensionável permite ajustar a largura dos painéis conforme a preferência do usuário.

A visualização do PDF utiliza a biblioteca PDF.js, que renderiza o documento diretamente no navegador sem necessidade de plugins externos. O usuário pode navegar pelas páginas, aplicar zoom e baixar o arquivo gerado. Durante a compilação, um painel inferior exibe o log em tempo real, ajudando na depuração de erros de sintaxe ou problemas com referências bibliográficas.

---

## Fluxo de Trabalho

O projeto suporta dois fluxos de trabalho distintos que podem ser utilizados conforme a necessidade do momento. No modo tradicional, o usuário edita os arquivos `.tex` e `.bib` em qualquer editor de texto, executa o script `compilar.sh` para gerar o PDF, e visualiza o resultado em um leitor de PDF externo. Este modo é ideal quando o usuário prefere seu editor de código habitual ou quando não deseja iniciar a aplicação web.

No modo web, o usuário inicia o servidor Node.js e acessa a aplicação através do navegador. Neste modo, toda a edição, compilação e visualização acontecem dentro da mesma interface, eliminando a necessidade de alternar entre diferentes programas. A aplicação detecta automaticamente o primeiro projeto e o arquivo `.tex` principal, carregando-os ao iniciar.

Ao criar um novo projeto pela interface web, o usuário recebe um template básico já configurado com os pacotes essenciais para documentos em português. O sistema também copia automaticamente arquivos existentes do diretório pai como projeto inicial, facilitando a migração de trabalhos já iniciados para a plataforma web.

---

## Dependências e Requisitos

Para utilizar o projeto completo, é necessário ter o Node.js instalado para executar a aplicação web, além da distribuição TeX Live completa para compilar os documentos. O arquivo `package.json` lista as dependências da aplicação web: Express para o servidor HTTP, Multer para upload de arquivos e WebSocket para comunicação em tempo real.

O frontend fica em `webapp/client/` e é empacotado com o Vite em `webapp/dist/`. O PDF.js vem do pacote `pdfjs-dist`, instalado pelo npm. A compilação usa o `latexmk`, que roda `bibtex`/`biber` e `makeindex` quando necessário e guarda os arquivos auxiliares em `.output/`, dentro de cada projeto. As configurações de cada projeto (documento principal, compilador e shell-escape) ficam em `.project.json`. As fontes Inter e JetBrains Mono são carregadas do Google Fonts.

### Instalar como aplicativo (Linux)

```bash
./instalar.sh
```

O instalador baixa e instala tudo o que o app precisa. Pelo gerenciador de pacotes da distribuição (apt, dnf, pacman ou zypper), ele instala o TeX Live com os pacotes usados pelos modelos (abnTeX2, Beamer, português, XeLaTeX, LuaLaTeX e biber), além do `latexmk`, do `texcount` e do `git`. Ele instala apenas o que falta, então a senha de administrador só é pedida quando é preciso. Se o Node.js do sistema não existir ou for anterior à versão 18, o instalador baixa a versão LTS oficial de nodejs.org, confere o checksum e a guarda dentro da pasta do app, sem sudo. No fim, ele pergunta se você quer instalar também o assistente de IA (Ollama e o modelo `qwen3.5:9b`, cerca de 7 GB).

| Opção | Efeito |
|---|---|
| `--texlive-completo` | instala o TeX Live inteiro (`texlive-full`, cerca de 6 GB) em vez da seleção |
| `--ia` / `--sem-ia` | instala o assistente de IA sem perguntar / não pergunta |
| `--sem-dependencias` | não instala programas do sistema, apenas verifica |
| `PASTA_PROJETOS=/outra/pasta` | escolhe onde ficam os projetos |
| `MODELO_IA=gemma3:4b` | escolhe o modelo baixado para a IA |

O app é copiado para `~/.local/share/editor-latex`, ganha o comando `editor-latex` e aparece como **Editor LaTeX** no menu de aplicativos (e na área de trabalho). Ele abre em uma janela própria, com ícone próprio, usando o Chrome, o Chromium, o Edge ou o Brave. O servidor local inicia sozinho e encerra cerca de 20 segundos depois que a última janela fecha. Os projetos ficam em `~/Documentos/Projetos-LaTeX`. Rodar o instalador de novo atualiza o app sem mexer nos projetos, e `./desinstalar.sh` remove o app (e o Node.js próprio, se houver) mas mantém os projetos e os programas do sistema.

### Como executar sem instalar

```bash
./run.sh            # instala dependências, compila o frontend e inicia em http://localhost:3000
```

Para desenvolver o frontend com recarga automática, rode `npm run server` e `npm run dev` em `webapp/` (o Vite encaminha `/api` e `/ws` para o servidor). Variáveis opcionais: `PORT`, `HOST` (padrão `127.0.0.1`), `PROJECTS_DIR`, `NO_OPEN=1`, `EXIT_WHEN_IDLE=<segundos>`, que encerra o servidor quando não há janelas abertas, e `OLLAMA_URL` (padrão `http://127.0.0.1:11434`). O servidor recusa requisições e conexões vindas de outros sites abertos no navegador.

### Recursos no estilo Overleaf

- **Painel de projetos:** filtros Todos, Arquivados e Lixeira; tags; busca; ordenação; ações em lote. Também cria projetos a partir de modelos (em branco, exemplo, artigo, Beamer, ABNT/abnTeX2 e carta), de um `.zip` ou de um repositório Git.
- **Árvore de arquivos:** pastas; menu do botão direito; renomear; mover arrastando; enviar arquivos arrastando do computador; definir o documento principal. A árvore se atualiza quando um arquivo muda fora do app.
- **Sumário do arquivo (Outline):** mostra as seções do arquivo aberto e destaca a seção em que o cursor está.
- **Histórico de versões:** cada projeto guarda versões automáticas em `.history/`, um repositório Git interno e invisível. As versões são criadas ao compilar e a cada 5 minutos de edição. Você pode ver as diferenças, dar nome a uma versão e restaurar um arquivo ou o projeto inteiro.
- **Integração com Git:** commit, pull e push de projetos que são repositórios Git, pelo painel "Git".
- **Configurações:** abas Editor (que inclui os modos Vim e Emacs), Compilador e Aparência (tema do editor, fonte e espaçamento).
- **Paleta de comandos:** `Ctrl+K`.

### Assistente de IA (Ollama)

O assistente usa modelos que rodam no seu computador pelo [Ollama](https://ollama.com), então o texto dos projetos não sai da máquina. Com o Ollama instalado, baixe um modelo (por exemplo, `ollama pull qwen3.5:9b`) e abra o painel **Assistente de IA** (ícone ✨ na barra lateral).

- **Chat:** responde perguntas sobre LaTeX e sobre o documento. Junto com cada pergunta vai a seleção ou o trecho perto do cursor (ou o arquivo inteiro, se você escolher). Cada bloco de código da resposta tem os botões *Inserir no editor* e *Copiar*.
- **Edição no editor (`Ctrl+J`):** selecione um trecho (ou deixe o cursor onde quer escrever), pressione `Ctrl+J` ou clique em *Editar com IA* e diga o que fazer. A proposta aparece embaixo do trecho original, riscado: `Ctrl+Enter` aceita e `Esc` descarta. Dá para desfazer com `Ctrl+Z`.
- **Erros de compilação:** cada erro do log tem o botão *Perguntar à IA*, que envia a mensagem junto com as linhas do código onde o erro aconteceu.
- **Configurações → IA:** liga/desliga o assistente, escolhe o modelo, ativa o raciocínio (melhor, porém mais lento) e define o contexto enviado no chat.

---

## Considerações Finais

Este projeto demonstra uma solução prática para o trabalho com documentos LaTeX, unindo a robustez da compilação local com a conveniência de uma interface web. A modularização do código permite fácil manutenção e extensão, enquanto a estrutura de pastas organizada facilita a navegação entre os diferentes componentes do sistema.

A escolha de tecnologias amplamente utilizadas como Node.js, Express e WebSocket garante compatibilidade com diferentes sistemas operacionais e facilita a contribuição de outros desenvolvedores. A interface, embora minimalista, oferece todas as funcionalidades essenciais para a edição e compilação de documentos acadêmicos em LaTeX.
