

#!/bin/bash

sudo apt install texlive-full;

# Limpa arquivos auxiliares de forma segura
#latexmk -C

# Compila corretamente (inclui bibtex automático)
#latexmk -pdf arquivo.tex
#!/bin/bash

pdflatex arquivo.tex
bibtex arquivo
pdflatex arquivo.tex
pdflatex arquivo.tex

 rm arquivo.aux;
 rm arquivo.bbl;
 rm arquivo.blg;
 rm arquivo.fls;
 rm arquivo.log;
 rm arquivo.out;
 rm arquivo.toc;
 rm arquivo.snm;
 rm arquivo.nav;
 rm arquivo.fdb_latexmk;


