import type { StreamEventMeta } from '../types/api';

export interface SSECallbacks {
  onMeta?: (meta: StreamEventMeta) => void;
  onToken?: (token: string) => void;
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
  const { onMeta, onToken, onDone, onError } = callbacks;
  const abortController = new AbortController();

  let accumulated = '';
  let metaReceived = false;

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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lastDoubleNewline = buffer.lastIndexOf('\n\n');
          if (lastDoubleNewline === -1) continue;

          const complete = buffer.slice(0, lastDoubleNewline + 2);
          buffer = buffer.slice(lastDoubleNewline + 2);

          const events = parseSSEEvents(complete);

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
              }
            } catch {
              // Skip malformed JSON events
            }
          }
        }

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
            }
          } catch {
            // Skip malformed JSON events
          }
        }

        onDone?.(accumulated);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        onDone?.(accumulated);
        return;
      }
      onError?.(error as Error);
    }
  };

  run();

  return abortController;
}

export default connectSSE;
