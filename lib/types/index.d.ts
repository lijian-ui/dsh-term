/**
 * dsh-term host half: mounts the PTY session service and the /dsh-term/*
 * routes on the shared webserver. The browser half (src/client) renders the
 * panel UI against these routes — no dsh source changes.
 * @module dsh-term
 */
import type { Context } from '@deepseek-ai/cordis';
/** Required services: the route registry. */
export declare const inject: string[];
/** Model-facing announcement: plugin presence. */
export declare const DSH_TERM_GUIDANCE = "\u672C\u673A\u5DF2\u5B89\u88C5 dsh-term \u63D2\u4EF6\uFF08DSH Web GUI \u7684\u9762\u677F\u5F0F\u7EC8\u7AEF\uFF09\uFF1A\u7528\u6237\u53EF\u5728\u804A\u5929\u533A\u6253\u5F00\u672C\u5730\u7EC8\u7AEF\uFF08\u771F\u5B9E PTY\uFF0C\u9ED8\u8BA4 powershell/bash\uFF09\uFF0C\u591A\u6807\u7B7E\u5E76\u5B58\u3001\u4F1A\u8BDD\u6301\u4E45\uFF1B\u7528\u6237\u63D0\u5230\u300C\u7EC8\u7AEF / \u6253\u5F00\u7EC8\u7AEF / \u6267\u884C\u547D\u4EE4\u300D\u65F6\u5373\u6307\u672C\u63D2\u4EF6\uFF0C\u8BF7\u636E\u6B64\u534F\u4F5C\u3002";
/**
 * Mount the PTY service and its routes.
 * @param ctx - context carrying the webServer service.
 */
export declare const apply: typeof applyImpl;
declare function applyImpl(ctx: Context): void;
export {};
//# sourceMappingURL=index.d.ts.map