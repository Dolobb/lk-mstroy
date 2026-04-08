const ORG_MAP: Record<string, string> = {
  'ТФ "Мостоотряд-36" филиал АО "Мостострой-11"': 'МО-36',
  'ТФ "Мостоотряд-29" филиал АО "Мостострой-11"': 'МО-29',
  'ТФ "Мостоотряд-87" филиал АО "Мостострой-11"': 'МО-87',
  'ТФ "Мостоотряд-15" филиал АО "Мостострой-11"': 'МО-15',
  'ООО БСМ-МОСТ': 'БСМ',
  'ДСУ Мостострой-11': 'ДСУ',
  'СУ Мостострой-11': 'СУ',
  'АО "Мостострой 11"': 'МС-11',
  'АО "Мостострой-11"': 'МС-11',
};

// Normalized lookup: trimmed lowercase → abbreviation
const NORM_MAP = new Map<string, string>(
  Object.entries(ORG_MAP).map(([k, v]) => [k.trim().toLowerCase(), v])
);

export function abbreviateOrg(fullName: string): string {
  if (!fullName) return '—';

  // Exact match
  const exact = ORG_MAP[fullName];
  if (exact) return exact;

  // Normalized match
  const norm = NORM_MAP.get(fullName.trim().toLowerCase());
  if (norm) return norm;

  // Pattern: ТФ "Мостоотряд-XX" ...
  const moMatch = fullName.match(/Мостоотряд[- ]?(\d+)/i);
  if (moMatch) return `МО-${moMatch[1]}`;

  // Pattern: ИП Фамилия → Фамилия
  const ipMatch = fullName.match(/^ИП\s+(.+)/i);
  if (ipMatch) {
    const parts = ipMatch[1]!.trim().split(/\s+/);
    return parts[0] ?? fullName.slice(0, 10) + '…';
  }

  // Fallback: first 10 chars
  return fullName.length > 10 ? fullName.slice(0, 10) + '…' : fullName;
}
