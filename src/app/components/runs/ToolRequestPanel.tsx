import { useDecideToolCall } from '../../hooks/queries';
import { translateUi } from '../../i18n';
import type { PendingToolCall } from '../../types/schemas';

/** "notes__read_file" -> { tool: "read file", server: "notes" }; built-ins by name. */
export function describeTool(name: string): { tool: string; server: string | null } {
  if (name === 'web_search') return { tool: translateUi('Web search'), server: null };
  const [server, ...rest] = name.split('__');
  if (!rest.length) return { tool: name.replaceAll('_', ' '), server: null };
  return { tool: rest.join('__').replaceAll('_', ' '), server };
}

interface ToolRequestPanelProps {
  runId: string;
  request: PendingToolCall;
}

/** An agent's request to use a tool that waits for the user's allow or deny. */
export default function ToolRequestPanel({ runId, request }: ToolRequestPanelProps) {
  const decide = useDecideToolCall();
  const { tool, server } = describeTool(request.tool_name);
  const send = (decision: 'allow' | 'deny') =>
    decide.mutate({ runId, callId: request.id, decision });

  return (
    <div
      className="cc-run-card__tool-request"
      role="group"
      aria-label={translateUi('Tool request')}
    >
      <p>
        {server
          ? translateUi('The agent wants to use {{tool}} from {{server}}.', { tool, server })
          : translateUi('The agent wants to use {{tool}}.', { tool })}
      </p>
      {Object.keys(request.arguments).length > 0 && (
        <pre>{JSON.stringify(request.arguments, null, 2).slice(0, 1200)}</pre>
      )}
      <div className="cc-run-card__actions">
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={decide.isPending}
          onClick={() => send('allow')}
        >
          {translateUi('Allow')}
        </button>
        <button
          type="button"
          className="cc-btn"
          disabled={decide.isPending}
          onClick={() => send('deny')}
        >
          {translateUi('Deny')}
        </button>
      </div>
    </div>
  );
}
