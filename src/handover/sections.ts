export interface HandoverSection {
  id: string;
  title: string;
  html: string;
  available: boolean;
}

export interface HandoverSectionLoader {
  id: string;
  title: string;
  /** Trusted application template; the source-specific renderer escapes its values. */
  load: () => Promise<string>;
}

/** Sections share a page, not a source dependency. A failed read leaves the others usable. */
export class HandoverSections {
  private readonly loaders = new Map<string, HandoverSectionLoader>();

  constructor(private readonly log: (message: string) => void = console.warn) {}

  register(section: HandoverSectionLoader): void {
    this.loaders.set(section.id, section);
  }

  async read(): Promise<HandoverSection[]> {
    return await Promise.all(Array.from(this.loaders.values(), async section => {
      try {
        return {id: section.id, title: section.title, html: await section.load(), available: true};
      } catch {
        try {this.log('Handover section read failed; other sections are retained.');} catch { /* Diagnostics cannot hide another section. */ }
        return {id: section.id, title: section.title,
          html: '<p class="handover-notice" role="status">ⓘ This section is temporarily unavailable. Try again shortly.</p>', available: false};
      }
    }));
  }
}
