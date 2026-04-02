import { streamText, pipeUIMessageStreamToResponse } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { Request, Response } from 'express';
import { SYSTEM_PROMPT } from './system-prompt';

// Tools отключены в демо-режиме. При запуске полного AI-конструктора:
// import { queryKipData, ... } from './tools';
// и добавить tools + stopWhen: stepCountIs(8) в streamText()

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
    });

    pipeUIMessageStreamToResponse({ response: res, stream: result.toUIMessageStream() });
  } catch (err) {
    console.error('[ai-reports] Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
}
