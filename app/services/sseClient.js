/**
 * Lightweight SSE (Server-Sent Events) client for React Native.
 *
 * React Native does not natively support EventSource, so this module
 * uses the fetch API with a streaming reader to consume SSE responses.
 *
 * Usage:
 *   const controller = connectSSE(url, body, token, {
 *     onMeta: ({ conversation_id, message_id }) => {},
 *     onToken: (token) => {},
 *     onDone: (fullMessage) => {},
 *     onError: (error) => {},
 *   });
 *
 *   // To abort the stream:
 *   controller.abort();
 */

/**
 * Parse raw SSE text and extract individual events.
 * SSE events are separated by double newlines. Each event line
 * that starts with "data: " has its payload extracted.
 *
 * @param {string} raw - Raw SSE text chunk
 * @returns {string[]} Array of data payloads (without the "data: " prefix)
 */
function parseSSEEvents(raw) {
  const events = [];
  // Split on double newlines to get individual events
  const parts = raw.split('\n\n');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Each event may have multiple lines; we care about "data:" lines
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

/**
 * Connect to an SSE endpoint and process the event stream.
 *
 * @param {string} url - The full URL of the SSE endpoint
 * @param {object} body - The JSON request body
 * @param {string} token - Bearer auth token
 * @param {object} callbacks - Event callbacks
 * @param {function} callbacks.onMeta - Called with { conversation_id, message_id } from the first event
 * @param {function} callbacks.onToken - Called with each token string
 * @param {function} callbacks.onDone - Called with the full accumulated message when stream ends
 * @param {function} callbacks.onError - Called with an Error object on failure
 * @returns {AbortController} Controller that can be used to abort the stream
 */
export function connectSSE(url, body, token, callbacks) {
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
        // Handle HTTP errors
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // Use the reader to consume the stream
      const reader = response.body?.getReader?.();

      if (reader) {
        // Streaming via ReadableStream (works in modern RN with Hermes)
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete events (separated by double newlines)
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

        // If stream ended without [DONE], still notify completion
        if (accumulated) {
          onDone?.(accumulated);
        }
      } else {
        // Fallback: read the entire response as text
        // This path handles environments where ReadableStream is not available
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
      if (error.name === 'AbortError') {
        // Stream was intentionally aborted - still notify with what we have
        onDone?.(accumulated);
        return;
      }
      onError?.(error);
    }
  };

  run();

  return abortController;
}

export default connectSSE;
