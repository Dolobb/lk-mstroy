import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/** Write body to a temp file and return the path. Caller must clean up. */
function writeTempBody(body: string): string {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `curl-body-${crypto.randomBytes(6).toString('hex')}.json`);
  fs.writeFileSync(tmpFile, body, 'utf-8');
  return tmpFile;
}

function parseHeaders(headers: RequestInit['headers']): [string, string][] {
  if (!headers) return [];
  if (headers instanceof Headers) return Array.from(headers.entries());
  if (Array.isArray(headers)) return headers as [string, string][];
  return Object.entries(headers).filter((e): e is [string, string] => e[1] !== undefined);
}

/**
 * Drop-in fetch replacement that uses curl under the hood.
 * Bypasses Node.js TLS fingerprint which gets blocked by Cloudflare on some networks.
 * Uses temp files for request body to avoid ENAMETOOLONG on Windows.
 */
export const curlFetch: typeof globalThis.fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || 'GET';
  const body = init?.body ? String(init.body) : undefined;

  const args: string[] = [
    '-s',                   // silent
    '-w', '\n__HTTP_STATUS__%{http_code}',  // append status code
    '-X', method,
  ];

  for (const [key, value] of parseHeaders(init?.headers)) {
    args.push('-H', `${key}: ${value}`);
  }

  let tmpFile: string | undefined;
  if (body) {
    tmpFile = writeTempBody(body);
    args.push('--data-binary', `@${tmpFile}`);
  }

  args.push(url);

  try {
    const raw = execFileSync('curl', args, {
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,  // 10MB
    });

    const statusMatch = raw.match(/__HTTP_STATUS__(\d+)$/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;
    const responseBody = raw.replace(/__HTTP_STATUS__\d+$/, '');

    return new Response(responseBody, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    throw new Error(`curl failed: ${err.message}`);
  } finally {
    if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
  }
};

/**
 * Streaming version — uses curl with SSE support.
 * Returns a ReadableStream of chunks.
 * Uses temp files for request body to avoid ENAMETOOLONG on Windows.
 */
export const curlStreamFetch: typeof globalThis.fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || 'GET';
  const body = init?.body ? String(init.body) : undefined;

  const args: string[] = [
    '-s',           // silent
    '-N',           // no-buffer (for streaming)
    '-X', method,
  ];

  for (const [key, value] of parseHeaders(init?.headers)) {
    args.push('-H', `${key}: ${value}`);
  }

  let tmpFile: string | undefined;
  if (body) {
    tmpFile = writeTempBody(body);
    args.push('--data-binary', `@${tmpFile}`);
  }

  args.push(url);

  const curlProc = spawn('curl', args);
  let statusCode = 200;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      curlProc.stdout.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      curlProc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('HTTP/')) {
          const match = text.match(/HTTP\/\S+\s+(\d+)/);
          if (match) statusCode = parseInt(match[1], 10);
        }
      });

      curlProc.on('close', () => {
        // Clean up temp file after curl finishes
        if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
        controller.close();
      });

      curlProc.on('error', (err) => {
        if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
        controller.error(err);
      });
    },
    cancel() {
      curlProc.kill();
      if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    },
  });

  // Wait a tiny bit for the first data to determine status
  await new Promise((resolve) => setTimeout(resolve, 100));

  return new Response(stream, {
    status: statusCode,
    headers: {
      'content-type': 'text/event-stream',
    },
  });
};
