import type { Request, Response } from 'express';
import { getColumnsForType } from './columns';
import { queryKipFilters } from './queries/kip';
import { queryDtFilters } from './queries/dump-trucks';

const REPORT_TYPES = [
  { id: 'kip', label: 'Отчёт КИП' },
  { id: 'dump-truck-trips', label: 'Отчёт по рейсам самосвалов' },
];

export async function metaHandler(req: Request, res: Response) {
  try {
    const type = (req.query.type as string) || 'kip';
    const dateFrom = req.query.dateFrom as string;
    const dateTo = req.query.dateTo as string;

    const columns = getColumnsForType(type);

    let filters: Record<string, any> = {};

    if (dateFrom && dateTo) {
      try {
        if (type === 'kip') {
          filters = await queryKipFilters(dateFrom, dateTo);
        } else if (type === 'dump-truck-trips') {
          filters = await queryDtFilters(dateFrom, dateTo);
        }
      } catch (err) {
        console.error('[meta] Filter query error:', err);
        // Return empty filters on error — non-critical
      }
    }

    res.json({ reportTypes: REPORT_TYPES, columns, filters });
  } catch (err) {
    console.error('[meta] Error:', err);
    res.status(500).json({ error: String(err) });
  }
}
