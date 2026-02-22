import type { StreamEventMeta } from '../types/api';
import { logger } from './logger';

const SSE_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

interface SSECallbacks {
  onMeta?: (meta: StreamEventMeta) => void;
  onToken?: (token: string) => void;
  onTitleGenerated?: (title: string) => void;
  onDone?: (fullMessage: string) => void;
  onError?: (error: Error) => void;
}

function parseSSEEvents(raw: string): string[] {
  const events: string[] = [];
  const parts = raw.split('\n\n');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        events.push(line.slice(6));
      } else if (line.startsWith('data:')) {
        events.push(line.slice(5));
      }
    }
  }
  return events;
}

export function connectSSE(
  url: string,
  body: Record<string, unknown>,
  token: string,
  callbacks: SSECallbacks,
): AbortController {
  const { onMeta, onToken, onTitleGenerated, onDone, onError } = callbacks;
  const abortController = new AbortController();

  let accumulated = '';
  let metaReceived = false;
  let retryCount = 0;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const clearInactivityTimer = () => {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  };

  const resetInactivityTimer = () => {
    clearInactivityTimer();
    inactivityTimer = setTimeout(() => {
      logger.warn('SSE connection timed out after inactivity', { url, accumulatedLength: accumulated.length });
      abortController.abort();
    }, SSE_TIMEOUT_MS);
  };

  const run = async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();

      if (reader) {
        const decoder = new TextDecoder();
        let buffer = '';

        resetInactivityTimer();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          resetInactivityTimer();

          buffer += decoder.decode(value, { stream: true });

          const lastDoubleNewline = buffer.lastIndexOf('\n\n');
          if (lastDoubleNewline === -1) continue;

          const complete = buffer.slice(0, lastDoubleNewline + 2);
          buffer = buffer.slice(lastDoubleNewline + 2);

          const events = parseSSEEvents(complete);

          for (const eventData of events) {
            if (eventData === '[DONE]') {
              clearInactivityTimer();
              onDone?.(accumulated);
              return;
            }

            try {
              const parsed = JSON.parse(eventData);

              if (!metaReceived && parsed.conversation_id && parsed.message_id) {
                metaReceived = true;
                onMeta?.(parsed);
              } else if (parsed.token !== undefined) {
                accumulated += parsed.token;
                onToken?.(parsed.token);
              } else if (parsed.title_generated !== undefined) {
                onTitleGenerated?.(parsed.title_generated);
              }
            } catch {
              // Skip malformed JSON events
            }
          }
        }

        clearInactivityTimer();

        if (accumulated) {
          onDone?.(accumulated);
        }
      } else {
        const text = await response.text();
        const events = parseSSEEvents(text);

        for (const eventData of events) {
          if (eventData === '[DONE]') {
            onDone?.(accumulated);
            return;
          }

          try {
            const parsed = JSON.parse(eventData);

            if (!metaReceived && parsed.conversation_id && parsed.message_id) {
              metaReceived = true;
              onMeta?.(parsed);
            } else if (parsed.token !== undefined) {
              accumulated += parsed.token;
              onToken?.(parsed.token);
            } else if (parsed.title_generated !== undefined) {
              onTitleGenerated?.(parsed.title_generated);
            }
          } catch {
            // Skip malformed JSON events
          }
        }

        onDone?.(accumulated);
      }
    } catch (error) {
      clearInactivityTimer();

      if ((error as Error).name === 'AbortError') {
        onDone?.(accumulated);
        return;
      }

      // If no tokens were received yet, retry with exponential backoff
      if (!metaReceived && accumulated === '' && retryCount < MAX_RETRIES) {
        retryCount++;
        const delayMs = 1000 * Math.pow(2, retryCount - 1);
        logger.warn('SSE connection error, retrying', {
          url,
          attempt: retryCount,
          maxRetries: MAX_RETRIES,
          delayMs,
          error: (error as Error).message,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        run();
        return;
      }

      // If tokens were already received, salvage the partial response
      if (accumulated) {
        logger.warn('SSE connection lost after receiving partial response, returning accumulated data', {
          url,
          accumulatedLength: accumulated.length,
          error: (error as Error).message,
        });
        onDone?.(accumulated);
        return;
      }

      // No tokens received and retries exhausted
      logger.error('SSE connection failed after all retries', {
        url,
        retries: retryCount,
        error: (error as Error).message,
      });
      onError?.(error as Error);
    }
  };

  run();

  return abortController;
}
