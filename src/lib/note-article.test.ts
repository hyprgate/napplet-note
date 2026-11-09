import { describe, expect, it } from 'vitest';
import { articleBlocks, articleMeta } from './note-article';

describe('note article presentation', () => {
  it('reads NIP-23 tags from long-form posts only', () => {
    expect(articleMeta({ kind: 1, tags: [['title', 'x']] })).toBeNull();
    expect(articleMeta({ kind: 30023, tags: [['title', 'Walks'], ['summary', 'On paths'], ['image', 'https://a.example/i.png']] })).toEqual({
      title: 'Walks',
      summary: 'On paths',
      image: 'https://a.example/i.png',
    });
    expect(articleMeta({ kind: 30023, tags: [] })).toEqual({ title: null, summary: null, image: null });
  });

  it('turns headings into blocks and drops one repeating the title', () => {
    expect(articleBlocks('# Walks\n\nFirst para\nstill first\n\n### Later\nSecond', 'Walks')).toEqual([
      { type: 'text', text: 'First para\nstill first' },
      { type: 'heading', level: 3, text: 'Later' },
      { type: 'text', text: 'Second' },
    ]);
  });

  it('keeps a first heading that differs from the title, and non-headings as written', () => {
    expect(articleBlocks('## Intro\n\n#hashtag stays', 'Walks')).toEqual([
      { type: 'heading', level: 2, text: 'Intro' },
      { type: 'text', text: '#hashtag stays' },
    ]);
  });
});
