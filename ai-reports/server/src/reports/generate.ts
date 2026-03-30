import type { Request, Response } from 'express';
import { queryKipData } from './queries/kip';
import { queryDtTripsData } from './queries/dump-trucks';
import { buildKipXlsx } from '../xlsx/templates/kip-template';
import { buildDtTripsXlsx } from '../xlsx/templates/dump-truck-trips-template';

interface GenerateBody {
  reportType: string;
  dateFrom: string;
  dateTo: string;
  columns: string[];
  filters: {
    objectUid?: string;
    departments?: string[];
    vehicles?: string[];
    shiftType?: string;
  };
}

export async function generateHandler(req: Request, res: Response) {
  try {
    const body = req.body as GenerateBody;

    if (!body.reportType || !body.dateFrom || !body.dateTo || !body.columns?.length) {
      return res.status(400).json({ error: 'Missing required fields: reportType, dateFrom, dateTo, columns' });
    }

    let workbook;

    if (body.reportType === 'kip') {
      const data = await queryKipData(body.dateFrom, body.dateTo, {
        departments: body.filters.departments,
        vehicles: body.filters.vehicles,
        shiftType: body.filters.shiftType,
      });

      if (data.length === 0) {
        return res.status(404).json({ error: 'Нет данных за выбранный период' });
      }

      workbook = await buildKipXlsx(data, body.columns, body.dateFrom, body.dateTo);
    } else if (body.reportType === 'dump-truck-trips') {
      const data = await queryDtTripsData(body.dateFrom, body.dateTo, {
        objectUid: body.filters.objectUid,
        vehicles: body.filters.vehicles,
      });

      if (data.length === 0) {
        return res.status(404).json({ error: 'Нет данных за выбранный период' });
      }

      workbook = await buildDtTripsXlsx(data, body.columns);
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
