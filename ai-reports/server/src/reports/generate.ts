import type { Request, Response } from 'express';
import { queryKipData } from './queries/kip';
import { queryDtTripsData } from './queries/dump-trucks';
import { queryDtOnsiteData } from './queries/dump-trucks-onsite';
import { buildKipXlsx } from '../xlsx/templates/kip-template';
import { buildDtTripsXlsx } from '../xlsx/templates/dump-truck-trips-template';
import { buildDtOnsiteXlsx } from '../xlsx/templates/dump-truck-onsite-template';

interface GenerateBody {
  reportType: string;
  dateFrom: string;
  dateTo: string;
  columns: string[];
  filters: {
    objectUids?: string[];
    departments?: string[];
    vehicles?: string[];
    shiftType?: string;
  };
  splitByDays?: boolean;
  splitByShifts?: boolean;
}

export async function generateHandler(req: Request, res: Response) {
  try {
    const body = req.body as GenerateBody;

    if (!body.reportType || !body.dateFrom || !body.dateTo || !body.columns?.length) {
      return res.status(400).json({ error: 'Missing required fields: reportType, dateFrom, dateTo, columns' });
    }

    let workbook;

    // Фильтр смены приходит нейтральным: 'all' | 'shift1' | 'shift2' (дефолт обе).
    // КИП хранит смену как morning/evening — маппим; самосвалы — shift1/shift2 как есть.
    const shiftNeutral = body.filters.shiftType;
    const kipShift = shiftNeutral === 'shift1' ? 'morning'
      : shiftNeutral === 'shift2' ? 'evening'
      : shiftNeutral;

    if (body.reportType === 'kip') {
      const data = await queryKipData(body.dateFrom, body.dateTo, {
        departments: body.filters.departments,
        vehicles: body.filters.vehicles,
        shiftType: kipShift,
      });

      if (data.length === 0) {
        return res.status(404).json({ error: 'Нет данных за выбранный период' });
      }

      workbook = await buildKipXlsx(data, body.columns, body.dateFrom, body.dateTo, {
        splitByDays: body.splitByDays,
        splitByShifts: body.splitByShifts,
      });
    } else if (body.reportType === 'dump-truck-trips') {
      const data = await queryDtTripsData(body.dateFrom, body.dateTo, {
        objectUids: body.filters.objectUids,
        vehicles: body.filters.vehicles,
        shiftType: shiftNeutral,
      });

      if (data.length === 0) {
        return res.status(404).json({ error: 'Нет данных за выбранный период' });
      }

      workbook = await buildDtTripsXlsx(data, body.columns);
    } else if (body.reportType === 'dump-truck-onsite') {
      const data = await queryDtOnsiteData(body.dateFrom, body.dateTo, {
        objectUids: body.filters.objectUids,
        vehicles: body.filters.vehicles,
        shiftType: shiftNeutral,
      });

      if (data.length === 0) {
        return res.status(404).json({ error: 'Нет данных по месту за выбранный период' });
      }

      workbook = await buildDtOnsiteXlsx(data, body.columns);
    } else {
      return res.status(400).json({ error: `Unknown report type: ${body.reportType}` });
    }

    const filename = `report_${body.reportType}_${body.dateFrom}_${body.dateTo}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[generate] Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
}
