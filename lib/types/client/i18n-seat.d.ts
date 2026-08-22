/**
 * Module-level i18n translator seat for dsh-term client components.
 *
 * Set once in src/client/index.ts via bindI18n(). Components import this
 * module and call getT() to get the current translation function. Because
 * ctx.locale.bind() returns a function that reads the active locale at
 * call time (not at bind time), simply re-reading getT() on each render
 * keeps everything in sync when the user switches language.
 *
 * @module dsh-term/client/i18n-seat
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
export declare function bindI18n(t: TranslateNS<'dsh-term'>): void;
export declare function getT(): TranslateNS<'dsh-term'>;
//# sourceMappingURL=i18n-seat.d.ts.map