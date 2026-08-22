/**
 * 客户端 i18n 字典：dsh-term 面板的中英文翻译。
 *
 * 通过 ctx.locale.register('dsh-term', dicts) 注册，
 * 组件中用 const t = ctx.locale.bind('dsh-term') 获取翻译函数。
 *
 * @module dsh-term/client-i18n
 */

export const zh = {
  // ── TerminalPanel.tsx ──
  'ui.panel.title': '终端',
  'ui.panel.addTabTitle': '新建终端',
  'ui.panel.collapseTitle': '收起',
  'ui.panel.emptyHint': '点击 + 新建终端',
  'ui.tab.closeAria': '关闭 {0}',
  'msg.sessionExited': '[dsh-term] 进程已退出（code {0}）',
  'msg.spawnFailed': '[dsh-term] 启动失败: {0}',

  // ── Shell 选择器 ──
  'ui.panel.shellTitle': 'Shell',
  'ui.shell.bash': 'Bash',
  'ui.shell.zsh': 'Zsh',
  'ui.shell.powershell': 'PowerShell',
  'ui.shell.cmd': '命令提示符',
  'ui.shell.gitbash': 'Git Bash',

  // ── 终端复用 ──
  'ui.panel.reopenTitle': '恢复终端',
  'ui.panel.backgroundSessions': '后台终端',
  'ui.panel.noBackground': '无后台终端',

  // ── 选中文本 → 添加到对话 ──
  'ui.panel.addToChat': '添加到对话',

  // ── AnimatedDock.tsx / DockItem.tsx ──
  'ui.dock.label': '终端',
}

export const en = {
  // ── TerminalPanel.tsx ──
  'ui.panel.title': 'Terminal',
  'ui.panel.addTabTitle': 'New Terminal',
  'ui.panel.collapseTitle': 'Collapse',
  'ui.panel.emptyHint': 'Click + to create a terminal',
  'ui.tab.closeAria': 'Close {0}',
  'msg.sessionExited': '[dsh-term] Process exited (code {0})',
  'msg.spawnFailed': '[dsh-term] Spawn failed: {0}',

  // ── Shell selector ──
  'ui.panel.shellTitle': 'Shell',
  'ui.shell.bash': 'Bash',
  'ui.shell.zsh': 'Zsh',
  'ui.shell.powershell': 'PowerShell',
  'ui.shell.cmd': 'Command Prompt',
  'ui.shell.gitbash': 'Git Bash',

  // ── Terminal reuse ──
  'ui.panel.reopenTitle': 'Reopen terminal',
  'ui.panel.backgroundSessions': 'Background terminals',
  'ui.panel.noBackground': 'No background terminals',

  // ── Selection → add to chat ──
  'ui.panel.addToChat': 'Add to chat',

  // ── AnimatedDock.tsx / DockItem.tsx ──
  'ui.dock.label': 'Terminal',
}
