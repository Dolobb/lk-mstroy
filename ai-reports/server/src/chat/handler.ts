import {
  streamText,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  convertToModelMessages,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Request, Response } from 'express';
import { buildSystemPrompt } from './system-prompt';
import { curlStreamFetch } from './curl-fetch';
import {
  queryKipData,
  queryDumpTruckData,
  queryDumpTruckTrips,
  queryTyagachiData,
  queryGeoData,
  queryRepairs,
  queryVehicleRegistry,
  generateXlsx,
  generateKipReport,
  generateDumpTruckSummary,
  generateTripDetail,
} from './tools';

const tools = {
  queryKipData,
  queryDumpTruckData,
  queryDumpTruckTrips,
  queryTyagachiData,
  queryGeoData,
  queryRepairs,
  queryVehicleRegistry,
  generateXlsx,
  generateKipReport,
  generateDumpTruckSummary,
  generateTripDetail,
};

// Use curl-based fetch to bypass Cloudflare TLS fingerprint blocking
const provider = createAnthropic({
  fetch: curlStreamFetch as unknown as typeof globalThis.fetch,
});

export async function chatHandler(req: Request, res: Response) {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // UIMessage[] (from frontend) → ModelMessage[] (for streamText)
    const modelMessages = await convertToModelMessages(messages, { tools });

    const result = streamText({
      model: provider('claude-haiku-4-5-20251001'),
      system: buildSystemPrompt(),
      messages: modelMessages,
      tools,
      maxOutputTokens: 4096,
      providerOptions: {
        anthropic: {
          toolStreaming: false,
        },
      },
      stopWhen: stepCountIs(12),
    });

    pipeUIMessageStreamToResponse({
      response: res,
      stream: result.toUIMessageStream(),
    });
  } catch (err) {
    console.error('[ai-reports] Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
}
