import {
  streamText,
  stepCountIs,
  pipeUIMessageStreamToResponse,
  convertToModelMessages,
} from 'ai';
import type { UIMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Request, Response } from 'express';
import { SYSTEM_PROMPT } from './system-prompt';
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
} from './tools';

// Use curl-based fetch to bypass Cloudflare TLS fingerprint blocking
const provider = createAnthropic({
  fetch: curlStreamFetch as unknown as typeof globalThis.fetch,
});

// Strip large data arrays from historical tool results to prevent context bloat.
// The agent will re-query when it needs data — it won't have stale rows in context.
function stripToolData(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg: any) => {
    if (!Array.isArray(msg?.parts)) return msg;
    const parts = msg.parts.map((part: any) => {
      // tool-invocation format: { type: 'tool-invocation', state: 'result', result: {...} }
      if (part.type === 'tool-invocation' && part.result?.data) {
        return {
          ...part,
          result: {
            success: part.result.success,
            count: part.result.count,
            error: part.result.error,
            _note: `${part.result.data?.length ?? '?'} rows stripped — re-query for fresh data`,
          },
        };
      }
      // tool-* format: { type: 'tool-queryKipData', state: 'output-available', output: {...} }
      if (part.type?.startsWith('tool-') && part.type !== 'tool-invocation' && part.output?.data) {
        return {
          ...part,
          output: {
            success: part.output.success,
            count: part.output.count,
            error: part.output.error,
            _note: `${part.output.data?.length ?? '?'} rows stripped — re-query for fresh data`,
          },
        };
      }
      return part;
    });
    return { ...msg, parts };
  });
}

export async function chatHandler(req: Request, res: Response) {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const modelMessages = await convertToModelMessages(stripToolData(messages as UIMessage[]));

    const result = streamText({
      model: provider('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
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
      onError: (err) => console.error('[ai-reports] streamText error:', err),
    });

    Promise.resolve(result.usage)
      .then(u => console.log('[ai-reports] usage:', JSON.stringify(u)))
      .catch(() => {});
    pipeUIMessageStreamToResponse({ response: res, stream: result.toUIMessageStream() });
  } catch (err) {
    console.error('[ai-reports] Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
}
