/**
 * 国际化模块：dsh-term Host 端中英文翻译。
 *
 * 用法：
 *   const t = createTranslator('en')
 *   t('msg.sessionExited', 0)  // → "Session exited (code 0)"
 *
 * @module dsh-term/gateway/i18n
 */

export type Lang = 'zh' | 'en'

type Dict = Record<string, string>

const zh: Dict = {
  // ── pty-service.ts / TerminalPanel.tsx ──
  'msg.sessionExited': '[dsh-term] 进程已退出（code {0}）',
  'msg.spawnFailed': '[dsh-term] 启动失败: {0}',
  'ui.panel.title': '终端',
  'ui.panel.addTabTitle': '新建终端',
  'ui.panel.collapseTitle': '收起',
  'ui.panel.emptyHint': '点击 + 新建终端',
  'ui.dock.label': '终端',
  'ui.tab.closeAria': '关闭 {0}',
  'ui.panel.shellTitle': 'Shell',
  'ui.shell.bash': 'Bash',
  'ui.shell.zsh': 'Zsh',
  'ui.shell.powershell': 'PowerShell',
  'ui.shell.cmd': '命令提示符',
  'ui.shell.gitbash': 'Git Bash',
}

const en: Dict = {
  'msg.sessionExited': '[dsh-term] Process exited (code {0})',
  'msg.spawnFailed': '[dsh-term] Spawn failed: {0}',
  'ui.panel.title': 'Terminal',
  'ui.panel.addTabTitle': 'New Terminal',
  'ui.panel.collapseTitle': 'Collapse',
  'ui.panel.emptyHint': 'Click + to create a terminal',
  'ui.dock.label': 'Terminal',
  'ui.tab.closeAria': 'Close {0}',
  'ui.panel.shellTitle': 'Shell',
  'ui.shell.bash': 'Bash',
  'ui.shell.zsh': 'Zsh',
  'ui.shell.powershell': 'PowerShell',
  'ui.shell.cmd': 'Command Prompt',
  'ui.shell.gitbash': 'Git Bash',
}

const dicts: Record<Lang, Dict> = { zh, en }

export class Translator {
  constructor(readonly lang: Lang) {}

  t(key: string, ...args: (string | number)[]): string {
    const dict = dicts[this.lang] ?? zh
    let s = dict[key] ?? zh[key] ?? key
    for (let i = 0; i < args.length; i++) {
      s = s.replaceAll(`{${i}}`, String(args[i]))
    }
    return s
  }
}

export function createTranslator(lang: Lang): Translator {
  return new Translator(lang)
}
