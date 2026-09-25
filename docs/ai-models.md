# AI model updates

ClawChat's defaults are `gpt-6-luna` for Codex CLI, `gpt-6-sol` for the
Responses API, and `sonnet` for Claude Code. Explicit environment model pins
remain respected. Claude aliases resolve according to the installed CLI,
provider, account access, and any local alias overrides.

## Change the model

In web/desktop **Settings → AI**, select a provider, then choose or type a model
ID in **AI model** and select **Save model**. **Refresh models** checks again after
a CLI upgrade. Clear the CLI model field to inherit that CLI's own default.
An API model ID cannot be empty. Custom IDs are accepted so future releases do
not require a ClawChat allowlist update.

The choice applies to subsequent ClawChat AI requests, including requests from
Android connected to that server. It does not change existing external CLI
sessions or project execution model overrides. Saving does not generate tokens
or verify that the account can execute a request with the selected model.

Codex CLI suggestions come from the installed binary's `model/list`, with cursor
pagination. A short-lived stdio app-server is used so an older running shared
daemon does not determine the model list. No thread is started or resumed.
The API catalog uses authenticated model discovery. Claude offers version-independent
aliases and manual model IDs. If discovery fails, the UI labels fallback suggestions
without claiming that they are available to the account.

## Persistence

Set `AI_MODELS_FILE` to store model preferences across server restarts. If it is
empty and `AI_PROVIDER_FILE` is configured, ClawChat uses that path plus
`.models.json`. The desktop server already configures `AI_PROVIDER_FILE` in its
app data directory. With neither path configured, the UI reports session-only
storage. In-app saved preferences take precedence over environment defaults;
remove the saved file to return to environment-only configuration.

Writes are atomic. A failed write leaves the running model unchanged.

## Compatibility

The installed Codex CLI 0.157.0 returned GPT-6 Astra, Sol, and Luna during local
read-only discovery. The adapter uses Responses API reasoning with `medium`
effort by default and does not send sampling parameters. Tests exercise GPT-6
request shapes with a mock HTTP transport; account-specific generation access
must be checked in the deployment that will use the model.

References: [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model),
[Codex model discovery](https://learn.chatgpt.com/docs/app-server#list-models-modellist),
[Claude model aliases](https://code.claude.com/docs/en/model-config#model-aliases).
