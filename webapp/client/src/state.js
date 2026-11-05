export const S = {
  project: null,
  settings: null,      // { mainFile, compiler, shellEscape } from the server
  files: [],           // file tree
  expanded: new Set(), // expanded folder paths
  openFile: null,      // { path, type } currently shown in the editor area
  dirty: false,
  content: '',
  compiling: false,
  pdf: null,
  pdfUrl: null,
  pdfFile: null,
  pdfZoom: 1.3,
};
