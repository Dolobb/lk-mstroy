import {
  streamText,
  pipeUIMessageStreamToResponse,
  convertToModelMessages,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Request, Response } from 'express';
import { SYSTEM_PROMPT } from './system-prompt';
import { curlStreamFetch } from './curl-fetch';

// Use curl-based fetch to bypass Cloudflare TLS fingerprint blocking
const provider = createAnthropic({
  fetch: curlStreamFetch as unknown as typeof globalThis.fetch,
});

// Tools отключены в демо-режиме. При запуске полного AI-конструктора:
// import { queryKipData, ... } from './tools';
// и добавить tools + stopWhen: stepCountIs(8) в streamText()

export async function chatHandler(req: Request, res: Response) {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // UIMessage[] (from frontend) → ModelMessage[] (for streamText)
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: provider('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
    });

    pipeUIMessageStreamToResponse({ response: res, stream: result.toUIMessageStream() });
  } catch (err) {
    console.error('[ai-reports] Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
}
