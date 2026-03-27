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

O frontend utiliza PDF.js via CDN para renderização dos PDFs, eliminando a necessidade de instalação adicional. As fontes Inter e JetBrains Mono são carregadas do Google Fonts, proporcionando uma tipografia moderna e legível tanto no texto corrido quanto no código.

---

## Considerações Finais

Este projeto demonstra uma solução prática para o trabalho com documentos LaTeX, unindo a robustez da compilação local com a conveniência de uma interface web. A modularização do código permite fácil manutenção e extensão, enquanto a estrutura de pastas organizada facilita a navegação entre os diferentes componentes do sistema.

A escolha de tecnologias amplamente utilizadas como Node.js, Express e WebSocket garante compatibilidade com diferentes sistemas operacionais e facilita a contribuição de outros desenvolvedores. A interface, embora minimalista, oferece todas as funcionalidades essenciais para a edição e compilação de documentos acadêmicos em LaTeX.
