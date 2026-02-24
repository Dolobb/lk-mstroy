import { Pool } from 'pg';

const CYRILLIC_MAP: Record<string, string> = {
  а: 'a',  б: 'b',  в: 'v',  г: 'g',  д: 'd',
  е: 'e',  ё: 'yo', ж: 'zh', з: 'z',  и: 'i',
  й: 'y',  к: 'k',  л: 'l',  м: 'm',  н: 'n',
  о: 'o',  п: 'p',  р: 'r',  с: 's',  т: 't',
  у: 'u',  ф: 'f',  х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sch',ъ: '',   ы: 'y',  ь: '',
  э: 'e',  ю: 'yu', я: 'ya',
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map(char => CYRILLIC_MAP[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Generates a unique uid for a geo.objects record.
 * If base slug is taken → tries base-2, base-3, ...
 */
export async function uniqueObjectUid(pool: Pool, name: string): Promise<string> {
  const base = slugify(name);
  const { rows } = await pool.query<{ uid: string }>(
    'SELECT uid FROM geo.objects WHERE uid LIKE $1 ORDER BY uid',
    [`${base}%`],
  );
  const existing = new Set(rows.map(r => r.uid));

  if (!existing.has(base)) return base;

  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
