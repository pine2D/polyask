import type { MetaRepository } from './meta-repository';

export const GLOBAL_PROMPT_SHORTCUT_META_KEY = 'globalPromptShortcut';

/** Device-local only: no state item/outbox, sync projection, or business backup. Reset clears meta. */
export class GlobalPromptShortcutRepository {
  constructor(private readonly meta: MetaRepository) {}
  read(): unknown { return this.meta.get(GLOBAL_PROMPT_SHORTCUT_META_KEY); }
  write(accelerator: string | null): void { this.meta.put(GLOBAL_PROMPT_SHORTCUT_META_KEY, accelerator); }
}
