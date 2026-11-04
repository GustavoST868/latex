// Completion data. Templates use CodeMirror snippet syntax:
// ${name} is a tab stop (same names are linked); fields are visited in order.

// [command, arguments template, short description]
export const COMMANDS = [
  // Document structure
  ['documentclass', '[${options}]{${class}}', 'classe do documento'],
  ['usepackage', '{${package}}', 'carregar pacote'],
  ['title', '{${}}'], ['author', '{${}}'], ['date', '{\\today}'], ['maketitle', ''],
  ['tableofcontents', '', 'sumário'], ['listoffigures', ''], ['listoftables', ''],
  ['part', '{${}}'], ['chapter', '{${}}'], ['section', '{${}}'], ['subsection', '{${}}'],
  ['subsubsection', '{${}}'], ['paragraph', '{${}}'], ['subparagraph', '{${}}'],
  ['section*', '{${}}'], ['subsection*', '{${}}'], ['chapter*', '{${}}'],
  ['appendix', ''], ['input', '{${file}}', 'incluir arquivo'], ['include', '{${file}}', 'incluir arquivo'],
  ['newpage', ''], ['clearpage', ''], ['pagebreak', ''], ['noindent', ''], ['indent', ''],
  ['vspace', '{${}}'], ['hspace', '{${}}'], ['vfill', ''], ['hfill', ''], ['linebreak', ''],
  ['footnote', '{${}}', 'nota de rodapé'], ['thanks', '{${}}'],

  // Text formatting
  ['textbf', '{${}}', 'negrito'], ['textit', '{${}}', 'itálico'], ['emph', '{${}}', 'ênfase'],
  ['underline', '{${}}', 'sublinhado'], ['texttt', '{${}}', 'monoespaçado'], ['textsc', '{${}}', 'versalete'],
  ['textrm', '{${}}'], ['textsf', '{${}}'], ['textsuperscript', '{${}}'], ['textsubscript', '{${}}'],
  ['tiny', ''], ['scriptsize', ''], ['footnotesize', ''], ['small', ''], ['normalsize', ''],
  ['large', ''], ['Large', ''], ['LARGE', ''], ['huge', ''], ['Huge', ''],
  ['centering', ''], ['raggedright', ''], ['raggedleft', ''],
  ['textcolor', '{${color}}{${}}'], ['color', '{${}}'],

  // References
  ['label', '{${}}', 'rótulo'], ['ref', '{${}}', 'referência'], ['eqref', '{${}}', 'referência a equação'],
  ['pageref', '{${}}'], ['autoref', '{${}}'], ['cref', '{${}}'], ['Cref', '{${}}'], ['nameref', '{${}}'],
  ['cite', '{${}}', 'citação'], ['citep', '{${}}'], ['citet', '{${}}'], ['parencite', '{${}}'],
  ['textcite', '{${}}'], ['autocite', '{${}}'], ['citeonline', '{${}}', 'citação (abnTeX2)'], ['nocite', '{${}}'],
  ['bibliography', '{${}}'], ['bibliographystyle', '{${}}'], ['addbibresource', '{${}}'], ['printbibliography', ''],
  ['url', '{${}}'], ['href', '{${url}}{${text}}'],

  // Floats & lists
  ['includegraphics', '[width=${0.8}\\linewidth]{${file}}', 'inserir imagem'],
  ['caption', '{${}}', 'legenda'], ['item', ' ', 'item de lista'],
  ['hline', ''], ['cline', '{${}}'], ['multicolumn', '{${n}}{${c}}{${}}'], ['multirow', '{${n}}{*}{${}}'],
  ['toprule', ''], ['midrule', ''], ['bottomrule', ''],

  // Definitions
  ['newcommand', '{\\${name}}[${n}]{${}}', 'novo comando'], ['renewcommand', '{\\${name}}{${}}'],
  ['newenvironment', '{${name}}{${}}{${}}'], ['DeclareMathOperator', '{\\${name}}{${}}'],

  // Math
  ['frac', '{${num}}{${den}}', 'fração'], ['dfrac', '{${}}{${}}'], ['tfrac', '{${}}{${}}'],
  ['sqrt', '{${}}', 'raiz'], ['sum', '_{${}}^{${}}', 'somatório'], ['prod', '_{${}}^{${}}', 'produtório'],
  ['int', '_{${}}^{${}}', 'integral'], ['iint', ''], ['oint', ''], ['lim', '_{${}}', 'limite'],
  ['binom', '{${}}{${}}'], ['overline', '{${}}'], ['underbrace', '{${}}_{${}}'], ['overbrace', '{${}}^{${}}'],
  ['hat', '{${}}'], ['bar', '{${}}'], ['vec', '{${}}'], ['dot', '{${}}'], ['ddot', '{${}}'], ['tilde', '{${}}'],
  ['mathbb', '{${}}'], ['mathcal', '{${}}'], ['mathbf', '{${}}'], ['mathrm', '{${}}'], ['mathit', '{${}}'],
  ['mathsf', '{${}}'], ['mathfrak', '{${}}'], ['boldsymbol', '{${}}'], ['text', '{${}}'], ['operatorname', '{${}}'],
  ['left', '(${}\\right)'], ['right', ''],
  ['alpha', ''], ['beta', ''], ['gamma', ''], ['delta', ''], ['epsilon', ''], ['varepsilon', ''], ['zeta', ''],
  ['eta', ''], ['theta', ''], ['vartheta', ''], ['iota', ''], ['kappa', ''], ['lambda', ''], ['mu', ''],
  ['nu', ''], ['xi', ''], ['pi', ''], ['rho', ''], ['sigma', ''], ['tau', ''], ['upsilon', ''], ['phi', ''],
  ['varphi', ''], ['chi', ''], ['psi', ''], ['omega', ''],
  ['Gamma', ''], ['Delta', ''], ['Theta', ''], ['Lambda', ''], ['Xi', ''], ['Pi', ''], ['Sigma', ''],
  ['Upsilon', ''], ['Phi', ''], ['Psi', ''], ['Omega', ''],
  ['sin', ''], ['cos', ''], ['tan', ''], ['log', ''], ['ln', ''], ['exp', ''], ['min', ''], ['max', ''],
  ['sup', ''], ['inf', ''], ['det', ''], ['arg', ''],
  ['neq', ''], ['leq', ''], ['geq', ''], ['approx', ''], ['equiv', ''], ['sim', ''], ['propto', ''],
  ['times', ''], ['div', ''], ['cdot', ''], ['pm', ''], ['mp', ''], ['infty', ''], ['partial', ''], ['nabla', ''],
  ['in', ''], ['notin', ''], ['subset', ''], ['subseteq', ''], ['cup', ''], ['cap', ''], ['emptyset', ''],
  ['forall', ''], ['exists', ''], ['neg', ''], ['land', ''], ['lor', ''],
  ['rightarrow', ''], ['leftarrow', ''], ['Rightarrow', ''], ['Leftarrow', ''], ['leftrightarrow', ''],
  ['Leftrightarrow', ''], ['mapsto', ''], ['to', ''], ['ldots', ''], ['cdots', ''], ['vdots', ''], ['ddots', ''],
  ['quad', ''], ['qquad', ''],
];

// [environment, body template]
export const ENVIRONMENTS = [
  ['itemize', '\t\\item ${}'], ['enumerate', '\t\\item ${}'], ['description', '\t\\item[${}] '],
  ['figure', '\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${file}}\n\t\\caption{${caption}}\n\t\\label{fig:${label}}', '[htbp]'],
  ['table', '\t\\centering\n\t\\caption{${caption}}\n\t\\label{tab:${label}}\n\t\\begin{tabular}{${cc}}\n\t\t${}\n\t\\end{tabular}', '[htbp]'],
  ['tabular', '\t${}', '{${cols}}'],
  ['equation', '\t${}'], ['equation*', '\t${}'], ['align', '\t${}'], ['align*', '\t${}'],
  ['gather', '\t${}'], ['gather*', '\t${}'], ['multline', '\t${}'], ['split', '\t${}'],
  ['cases', '\t${}'], ['matrix', '\t${}'], ['pmatrix', '\t${}'], ['bmatrix', '\t${}'], ['array', '\t${}', '{${cols}}'],
  ['center', '\t${}'], ['flushleft', '\t${}'], ['flushright', '\t${}'],
  ['quote', '\t${}'], ['quotation', '\t${}'], ['verbatim', '${}'], ['abstract', '\t${}'],
  ['minipage', '\t${}', '{${0.5}\\linewidth}'], ['frame', '\t${}', '{${title}}'], ['columns', '\t\\column{0.5\\textwidth}\n\t${}'],
  ['block', '\t${}', '{${title}}'], ['lstlisting', '${}'], ['minted', '${}', '{${language}}'],
  ['theorem', '\t${}'], ['lemma', '\t${}'], ['proof', '\t${}'], ['definition', '\t${}'],
  ['thebibliography', '\t\\bibitem{${key}} ${}', '{99}'], ['document', '${}'], ['subfigure', '\t${}', '{0.45\\linewidth}'],
];

export const PACKAGES = [
  'amsmath', 'amssymb', 'amsthm', 'mathtools', 'graphicx', 'xcolor', 'hyperref', 'geometry', 'babel',
  'inputenc', 'fontenc', 'lmodern', 'microtype', 'booktabs', 'multirow', 'array', 'tabularx', 'longtable',
  'float', 'caption', 'subcaption', 'enumitem', 'listings', 'minted', 'tikz', 'pgfplots', 'siunitx',
  'biblatex', 'natbib', 'cleveref', 'csquotes', 'fancyhdr', 'titlesec', 'setspace', 'indentfirst',
  'parskip', 'url', 'verbatim', 'algorithm', 'algorithmic', 'algpseudocode', 'abntex2cite', 'lipsum',
  'blindtext', 'xspace', 'ifthen', 'calc', 'etoolbox', 'appendix', 'pdfpages', 'wrapfig', 'rotating',
  'multicol', 'makeidx', 'glossaries', 'acronym', 'chemfig', 'mhchem', 'physics', 'bm', 'textcomp', 'eurosym',
].sort();

export const CLASSES = [
  'article', 'report', 'book', 'letter', 'beamer', 'memoir', 'scrartcl', 'scrreprt', 'scrbook',
  'abntex2', 'standalone', 'IEEEtran', 'llncs', 'elsarticle', 'revtex4-2', 'moderncv',
];
