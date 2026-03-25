import { streamText, pipeUIMessageStreamToResponse, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { Request, Response } from 'express';
import { SYSTEM_PROMPT } from './system-prompt';
import {
  queryKipData,
  queryDumpTruckData,
  queryDumpTruckTrips,
  queryTyagachiData,
  queryGeoData,
  queryRepairs,
  queryVehicleRegistry,
  generateXlsx,
} from './tools';

export async function chatHandler(req: Request, res: Response) {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages,
      tools: {
        queryKipData,
        queryDumpTruckData,
        queryDumpTruckTrips,
        queryTyagachiData,
        queryGeoData,
        queryRepairs,
        queryVehicleRegistry,
        generateXlsx,
      },
      stopWhen: stepCountIs(8),
    });

    pipeUIMessageStreamToResponse({ response: res, stream: result.uiMessageStream });
  } catch (err) {
    console.error('[ai-reports] Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
}
