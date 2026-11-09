export type ArticleBlock =
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'text'; text: string };

export interface ArticleMeta {
  title: string | null;
  summary: string | null;
  image: string | null;
}

const KIND_LONG_FORM = 30023;

function tagValue(tags: string[][], name: string): string | null {
  const value = tags.find((tag) => tag[0] === name)?.[1]?.trim();
  return value ? value : null;
}

/** NIP-23 metadata for a long-form post, or null for anything else. */
export function articleMeta(event: { kind: number; tags: string[][] }): ArticleMeta | null {
  if (event.kind !== KIND_LONG_FORM) return null;
  return {
    title: tagValue(event.tags, 'title'),
    summary: tagValue(event.tags, 'summary'),
    image: tagValue(event.tags, 'image'),
  };
}

/**
 * Splits long-form Markdown into headings and paragraphs, so a post doesn't show
 * literal `#` marks. It isn't a full Markdown renderer: lists, emphasis and tables
 * stay as written. A first heading repeating the title is dropped.
 */
export function articleBlocks(content: string, title: string | null): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  for (const chunk of content.split(/\r?\n\s*\r?\n/)) {
    const lines = chunk.trim().split(/\r?\n/);
    let paragraph: string[] = [];
    const flush = (): void => {
      if (paragraph.length > 0) blocks.push({ type: 'text', text: paragraph.join('\n') });
      paragraph = [];
    };
    for (const line of lines) {
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!heading) {
        if (line.trim()) paragraph.push(line);
        continue;
      }
      flush();
      const text = heading[2] ?? '';
      if (blocks.length === 0 && title && text.toLowerCase() === title.toLowerCase()) continue;
      const depth = heading[1]?.length ?? 1;
      blocks.push({ type: 'heading', level: depth <= 2 ? 2 : depth === 3 ? 3 : 4, text });
    }
    flush();
  }
  return blocks;
}
