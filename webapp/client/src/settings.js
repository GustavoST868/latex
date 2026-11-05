import { el, icon, openModal } from './util.js';
import { S } from './state.js';
import {
  getTheme, setTheme, getPref, setPref, applyFontSize, FONT_SIZES,
  EDITOR_THEMES, EDITOR_FONTS, LINE_HEIGHTS, applyEditorAppearance,
} from './prefs.js';
import { updateSettings } from './project.js';
import { editorPref, applyEditorPrefs } from './editor.js';
import { aiStatus, aiPref, setAiPref, pickModel } from './ai.js';
import { applyAiVisibility } from './chat.js';

// Ollama status and model list arrive after the tab is drawn
function aiModelRows() {
  const box = el('div', {}, el('p', { className: 'hint-text' }, 'Procurando o Ollama…'));
  aiStatus({ refresh: true }).then(status => {
    if (!status.available) {
      box.replaceChildren(el('p', { className: 'ai-settings-status err' }, icon('error'),
        `Ollama não encontrado (${status.url || 'http://127.0.0.1:11434'}). Instale em ollama.com e rode "ollama pull qwen3.5:9b".`));
      return;
    }
    const models = status.models;
    box.replaceChildren(
      el('p', { className: 'ai-settings-status ok' }, icon('check_circle'), `Conectado ao Ollama · ${models.length} modelo(s) instalado(s)`),
      row('Modelo', 'Modelos maiores escrevem melhor, mas respondem mais devagar', models.length
        ? select(models.map(m => [m.name, m.size ? `${m.name} (${m.size})` : m.name]), pickModel(models), v => {
          setAiPref('model', v);
          const chatModel = document.getElementById('ai-model');
          if (chatModel) chatModel.value = v;
        })
        : el('span', { className: 'hint-text' }, 'Nenhum modelo instalado')),
    );
  });
  return box;
}

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

const onOff = key => select([['true', 'Ativado'], ['false', 'Desativado']], editorPref(key), v => {
  setPref(`editor.${key}`, v === 'true');
  applyEditorPrefs();
});

const TABS = [
  {
    id: 'editor',
    label: 'Editor',
    icon: 'edit_note',
    render: () => [
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
      row('Atalhos de teclado', 'Modo de edição do Vim ou do Emacs', select(
        [['default', 'Padrão'], ['vim', 'Vim'], ['emacs', 'Emacs']],
        editorPref('keybindings'),
        v => { setPref('editor.keybindings', v); applyEditorPrefs(); },
      )),
    ],
  },
  {
    id: 'compiler',
    label: 'Compilador',
    icon: 'build',
    render: () => {
      if (!S.project || !S.settings) {
        return [el('p', { className: 'hint-text' }, 'Abra um projeto para mudar as opções de compilação dele.')];
      }
      return [
        row('Compilador', null, select(
          [['pdflatex', 'pdfLaTeX'], ['xelatex', 'XeLaTeX'], ['lualatex', 'LuaLaTeX']],
          S.settings.compiler,
          v => updateSettings({ compiler: v }),
        )),
        row('Documento principal', null, select(
          texFiles(S.files).map(p => [p, p]),
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
      ];
    },
  },
  {
    id: 'ai',
    label: 'IA',
    icon: 'auto_awesome',
    render: () => [
      row('Assistente de IA', 'Chat no painel lateral, Ctrl+J no editor e "Perguntar à IA" nos erros', select(
        [['true', 'Ativado'], ['false', 'Desativado']],
        editorPref('ai'),
        v => { setPref('editor.ai', v === 'true'); applyEditorPrefs(); applyAiVisibility(); },
      )),
      aiModelRows(),
      row('Raciocínio', 'Modelos que pensam antes de responder (qwen3.5, gemma4) acertam mais, mas demoram bem mais', select(
        [['false', 'Desativado (mais rápido)'], ['true', 'Ativado']],
        aiPref('think'),
        v => setAiPref('think', v === 'true'),
      )),
      row('Contexto enviado no chat', 'A seleção sempre vai junto com a pergunta', select(
        [['nearby', 'Trecho perto do cursor'], ['file', 'Arquivo inteiro'], ['none', 'Nenhum']],
        aiPref('context'),
        v => { setAiPref('context', v); const s = document.getElementById('ai-context-mode'); if (s) s.value = v; },
      )),
      el('p', { className: 'hint-text' }, 'Tudo roda no seu computador, pelo Ollama: o texto dos seus projetos não é enviado para a internet.'),
    ],
  },
  {
    id: 'appearance',
    label: 'Aparência',
    icon: 'palette',
    render: () => {
      const pref = key => v => { setPref(key, v); applyEditorAppearance(); };
      return [
        row('Tema da interface', null, select(
          [['system', 'Igual ao sistema'], ['light', 'Claro'], ['dark', 'Escuro']],
          getTheme(),
          v => setTheme(v),
        )),
        row('Tema do editor', 'Cores do texto e do fundo do código', select(EDITOR_THEMES, getPref('editorTheme', 'default'), pref('editorTheme'))),
        row('Fonte do editor', null, select(EDITOR_FONTS.map(([id, label]) => [id, label]), getPref('editorFont', 'jetbrains'), pref('editorFont'))),
        row('Tamanho da fonte', null, select(
          FONT_SIZES.map(s => [s, `${s}px`]),
          getPref('fontSize', 13),
          v => { setPref('fontSize', Number(v)); applyFontSize(Number(v)); },
        )),
        row('Espaçamento entre linhas', null, select(LINE_HEIGHTS.map(([id, label]) => [id, label]), getPref('lineHeight', 'normal'), pref('lineHeight'))),
      ];
    },
  },
];

// `tabId` is optional (menus pass a click event)
export function openSettings(tabId) {
  const content = el('div', { className: 'settings-content' });
  const tabs = el('nav', { className: 'settings-tabs', role: 'tablist' });
  const show = id => {
    const tab = TABS.find(t => t.id === id) || TABS[0];
    setPref('settings.tab', tab.id);
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab.id));
    content.replaceChildren(...tab.render());
  };
  tabs.append(...TABS.map(t => el('button', { role: 'tab', 'data-tab': t.id, onclick: () => show(t.id) }, icon(t.icon), t.label)));
  openModal({ title: 'Configurações', body: el('div', { className: 'settings' }, tabs, content), wide: true });
  show(typeof tabId === 'string' ? tabId : getPref('settings.tab', 'editor'));
}
