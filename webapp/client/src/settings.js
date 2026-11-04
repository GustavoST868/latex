import { el, openModal } from './util.js';
import { S } from './state.js';
import { getTheme, setTheme, getPref, setPref, applyFontSize, FONT_SIZES } from './prefs.js';
import { updateSettings } from './project.js';
import { editorPref, applyEditorPrefs } from './editor.js';

// All .tex paths in the project tree
function texFiles(entries, out = []) {
  for (const f of entries) {
    if (f.type === 'folder') texFiles(f.children || [], out);
    else if (f.name.endsWith('.tex')) out.push(f.path);
  }
  return out;
}

function select(options, value, onChange) {
  const node = el('select', { onchange: e => onChange(e.target.value) },
    options.map(([v, label]) => el('option', { value: v }, label)));
  node.value = String(value);
  return node;
}

function row(label, hint, control) {
  return el('div', { className: 'form-row' },
    el('label', {}, label, hint ? el('span', { className: 'hint' }, hint) : null),
    control);
}

export function openSettings() {
  const body = [
    el('div', { className: 'form-section' }, 'Aparência'),
    row('Tema', null, select(
      [['system', 'Igual ao sistema'], ['light', 'Claro'], ['dark', 'Escuro']],
      getTheme(),
      v => setTheme(v),
    )),
    row('Tamanho da fonte do editor', null, select(
      FONT_SIZES.map(s => [s, `${s}px`]),
      getPref('fontSize', 13),
      v => { setPref('fontSize', Number(v)); applyFontSize(Number(v)); },
    )),
  ];

  const onOff = key => select([['true', 'Ativado'], ['false', 'Desativado']], editorPref(key), v => {
    setPref(`editor.${key}`, v === 'true');
    applyEditorPrefs();
  });
  body.push(
    el('div', { className: 'form-section' }, 'Editor'),
    row('Autocompletar', 'Sugestões de comandos, rótulos, citações e arquivos', onOff('autocomplete')),
    row('Fechar chaves automaticamente', null, onOff('closeBrackets')),
    row('Verificação de código', 'Aponta ambientes \\begin/\\end sem par', onOff('lint')),
    row('Quebra de linha automática', null, onOff('lineWrapping')),
    row('Prévia de fórmulas', 'Mostra a fórmula renderizada com o cursor dentro dela', onOff('mathPreview')),
    row('Corretor ortográfico', 'Usa o dicionário do navegador; clique com o botão direito para ver sugestões', select(
      [['pt-BR', 'Português (Brasil)'], ['en', 'English'], ['off', 'Desativado']],
      editorPref('spellcheck'),
      v => { setPref('editor.spellcheck', v); applyEditorPrefs(); },
    )),
  );

  if (S.project && S.settings) {
    const mains = texFiles(S.files);
    body.push(
      el('div', { className: 'form-section' }, 'Compilação deste projeto'),
      row('Compilador', null, select(
        [['pdflatex', 'pdfLaTeX'], ['xelatex', 'XeLaTeX'], ['lualatex', 'LuaLaTeX']],
        S.settings.compiler,
        v => updateSettings({ compiler: v }),
      )),
      row('Documento principal', null, select(
        mains.map(p => [p, p]),
        S.settings.mainFile || '',
        v => updateSettings({ mainFile: v }),
      )),
      row('Tempo limite', 'A compilação é interrompida depois desse tempo', select(
        [[30, '30 segundos'], [60, '1 minuto'], [120, '2 minutos'], [240, '4 minutos'], [600, '10 minutos']],
        S.settings.timeout || 120,
        v => updateSettings({ timeout: Number(v) }),
      )),
      row('Shell-escape', 'Permite que o documento execute comandos (ex.: minted). Ative só em projetos confiáveis.', select(
        [['false', 'Desativado'], ['true', 'Ativado']],
        S.settings.shellEscape,
        v => updateSettings({ shellEscape: v === 'true' }),
      )),
    );
  }

  openModal({ title: 'Configurações', body });
}
