

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


