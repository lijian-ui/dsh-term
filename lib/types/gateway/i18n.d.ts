/**
 * 国际化模块：dsh-term Host 端中英文翻译。
 *
 * 用法：
 *   const t = createTranslator('en')
 *   t('msg.sessionExited', 0)  // → "Session exited (code 0)"
 *
 * @module dsh-term/gateway/i18n
 */
export type Lang = 'zh' | 'en';
export declare class Translator {
    readonly lang: Lang;
    constructor(lang: Lang);
    t(key: string, ...args: (string | number)[]): string;
}
export declare function createTranslator(lang: Lang): Translator;
//# sourceMappingURL=i18n.d.ts.map