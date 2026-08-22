/**
 * dsh-term host half: mounts the PTY session service and the /dsh-term/*
 * routes on the shared webserver. The browser half (src/client) renders the
 * panel UI against these routes — no dsh source changes.
 * @module dsh-term
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { mountOnce } from './mount-once.ts'
import { PtyService } from './host/pty-service.ts'
import { registerTermRoutes } from './host/routes.ts'
import { createTranslator, type Lang } from './gateway/i18n.ts'

/** Required services: the route registry. */
export const inject = ['webServer']

/** Model-facing announcement: plugin presence. */
export const DSH_TERM_GUIDANCE = '本机已安装 dsh-term 插件（DSH Web GUI 的面板式终端）：用户可在聊天区打开本地终端（真实 PTY，默认 powershell/bash），多标签并存、会话持久；用户提到「终端 / 打开终端 / 执行命令」时即指本插件，请据此协作。'

/**
 * Mount the PTY service and its routes.
 * @param ctx - context carrying the webServer service.
 */
export const apply = mountOnce('@lijian-ui/dsh-term', applyImpl)

function applyImpl(ctx: Context): void {
  const pty = new PtyService()

  /** Current language; resolved from dsh global settings. */
  let lang: Lang = 'zh'
  const t = createTranslator(lang)

  /** Resolve the user's language preference from dsh settings. */
  function resolveLang(): Lang {
    try {
      const settings = ctx.get('settings') as
        | { get(ns: unknown): { preference?: string } | undefined }
        | undefined
      if (!settings) return 'zh'
      const section = settings.get(settingsNamespace('locale'))
      return section?.preference === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  }

  // Route registration + pty teardown both ride the effect fiber: the effect
  // callback runs immediately and its return value is the fiber disposer.
  ctx.effect(() => {
    lang = resolveLang()
    // t is a closure over lang; no separate sync needed.
    const disposeRoutes = registerTermRoutes(ctx, pty, () => createTranslator(lang))
    return () => {
      disposeRoutes()
      pty.dispose()
    }
  }, 'dsh-term: routes + pty lifecycle')

  // Listen for global language changes (dsh settings → General → Language).
  ctx.root.on('settings/updated', (ns, next) => {
    if (ns !== settingsNamespace('locale')) return
    const pref = (next as { preference?: string })?.preference
    lang = pref === 'en' ? 'en' : 'zh'
  })
}
