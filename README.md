# Kimi K3 (Moonshot API) - No Bugs Given

**Kimi K3 (Moonshot API)**
*by No Bugs Given*

> Use Moonshot AI's Kimi models directly inside VS Code Copilot Chat.

This extension is a native **Language Model Chat Provider** for VS Code. It adds Moonshot AI's Kimi models to the standard GitHub Copilot Chat **model picker** — no separate chat window, no custom UI, no proxy server. Your prompts go straight from VS Code to Moonshot's official API, authenticated with your own API key.

```
VS Code  →  this extension  →  Moonshot API (api.moonshot.ai)
```

That's the whole path. There is no No Bugs Given server, no telemetry, no analytics, and no third party ever sees your key or your code.

---

## Features

- **Native model picker integration** — Kimi models appear alongside your other models in Copilot Chat via VS Code's stable [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) (BYOK).
- **Streaming responses** — tokens render in Copilot Chat as they arrive.
- **Agent mode & tool calling** — full tool-call lifecycle: VS Code sends tool definitions, Kimi requests tool calls, VS Code executes them, and the results flow back into the conversation.
- **Vision / multimodal input** — paste or attach images on all three models.
- **Edit mode, agent mode, ask mode** — anywhere VS Code lets you pick a model.
- **Cancellation** — pressing Stop aborts the HTTP request cleanly.
- **Secure key storage** — the API key lives only in VS Code Secret Storage (OS keychain), never in `settings.json`, workspace files, or logs.
- **Multi-turn conversations** with full history preservation.
- **Token budgeting** via a documented, CJK-aware token estimator.

## Supported Models

| Model     | API ID      | Purpose                                                           |
| --------- | ----------- | ----------------------------------------------------------------- |
| Kimi K3   | `kimi-k3`   | Flagship coding, reasoning and agent model — 1M token context     |
| Kimi K2.6 | `kimi-k2.6` | Coding, reasoning and general AI work — 256K token context        |
| Kimi K2.5 | `kimi-k2.5` | General Kimi model — 256K token context ⚠️ deprecated by Moonshot |

> **Note on Kimi K2.5:** Moonshot's [model documentation](https://platform.kimi.ai/docs/models) lists `kimi-k2.5` as discontinued (August 31, 2026). It is still exposed here for completeness and for compatible gateways, but requests may fail — prefer **Kimi K3**.

All three models support image input and tool/function calling per Moonshot's documentation. Reasoning traces from Kimi K3 / K2.6 thinking mode are consumed by the extension but not dumped into chat — only the final answer streams.

## Getting Started

### Quick Start

1. Install the extension.
2. Obtain a Moonshot API key from the [Moonshot platform console](https://platform.kimi.ai/console/api-keys).
3. Open the Command Palette (`Cmd/Ctrl+Shift+P`).
4. Run **`Kimi: Set API Key`**.
5. Paste your API key (input is masked).
6. Open Copilot Chat.
7. Open the model picker.
8. Select **Kimi K3**, **Kimi K2.6**, or **Kimi K2.5** under *Kimi K3 (Moonshot API) - No Bugs Given*.
9. Start chatting — or switch to Agent mode for tool-using workflows.

On first install the extension shows a one-time welcome pointing you at `Kimi: Set API Key`.

## Setting Your API Key

Your Moonshot API key is stored **exclusively** in VS Code's Secret Storage (backed by macOS Keychain / Windows Credential Manager / Linux libsecret). It is never:

- written to `settings.json` or any file
- included in logs or the Output panel
- sent anywhere except the configured Moonshot API endpoint

| Command                    | What it does                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `Kimi: Set API Key`        | Secure, password-masked input; stores the key and refreshes the model picker                        |
| `Kimi: Manage API Key`     | Menu: Set/Replace key, Test connection, Reset key, Open docs, Get an API key, Endpoint settings     |
| `Kimi: Reset API Key`      | Confirmation prompt, then deletes the stored key                                                    |
| `Kimi: Test API Connection`| Lightweight `GET /models` check — validates key + connectivity **without** spending chat tokens     |

`Kimi: Manage API Key` is also wired as the provider's management action in VS Code's language-model management UI.

If no key is configured, the provider stays silent while VS Code enumerates providers in the background, and offers a one-click setup prompt only when you explicitly interact with it.

## Selecting a Kimi Model

After setting your key, open Copilot Chat and click the model picker (bottom of the chat input). You'll see:

```
Kimi K3 (Moonshot API) - No Bugs Given
├── Kimi K3
├── Kimi K2.6
└── Kimi K2.5
```

Pick one and chat as usual. The selection works in Ask, Edit, and Agent mode.

## Agent Mode / Tool Calling

In Agent mode, VS Code passes its registered language-model tools to Kimi. This extension implements the complete tool-call lifecycle over Moonshot's OpenAI-compatible function calling:

1. VS Code tool definitions → Moonshot `tools` / `tool_choice` (`required` is honored).
2. Streamed tool-call deltas are reassembled into complete calls (id, name, JSON arguments).
3. Calls are emitted to VS Code as `LanguageModelToolCallPart`s — never flattened into text.
4. Tool results return as proper `tool`-role messages with matching `tool_call_id`s.

## Commands

| Command                    | ID                                  |
| -------------------------- | ----------------------------------- |
| `Kimi: Set API Key`        | `nobugsgivenKimi.setApiKey`         |
| `Kimi: Reset API Key`      | `nobugsgivenKimi.resetApiKey`       |
| `Kimi: Manage API Key`     | `nobugsgivenKimi.manageApiKey`      |
| `Kimi: Test API Connection`| `nobugsgivenKimi.testApiConnection` |

## Security

- Key storage: VS Code **SecretStorage** only.
- Network: requests go **only** to the configured API base URL (default `https://api.moonshot.ai/v1`). The host being contacted is shown in diagnostics and connection tests.
- Logging: the *Kimi - No Bugs Given* output channel never logs keys or Authorization headers; every log line passes through a key-masking sanitizer as defense in depth.
- **No telemetry. No analytics. No proxy. No No Bugs Given server.**

## Settings

| Setting             | Default                         | Description                                                                                          |
| ------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `kimi.apiBaseUrl`   | `https://api.moonshot.ai/v1`    | Advanced: API base URL for development/testing or Moonshot-compatible gateways. Contains no credentials. |
| `kimi.diagnostics`  | `false`                         | Verbose (sanitized) request/response diagnostics in the output channel.                               |

## Troubleshooting

| Symptom                                   | What to do                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Models don't appear in the picker         | Run `Kimi: Test API Connection`. If the key is missing/invalid, run `Kimi: Set API Key`.                            |
| "Invalid API key" (401)                   | Replace the key via `Kimi: Manage API Key` → *Replace API Key*.                                                     |
| "Rate limit reached" (429)                | Wait for the suggested retry window; check your Moonshot plan's rate limits.                                         |
| Requests time out / network error         | Verify connectivity to `api.moonshot.ai`, or check `kimi.apiBaseUrl` if you customized it. The failing host is named in the error. |
| `kimi-k2.5` returns model-not-found       | Moonshot has discontinued K2.5 — switch to Kimi K3.                                                                  |
| Want to see what's happening              | Enable `kimi.diagnostics` and open the *Kimi - No Bugs Given* output channel.                                        |

**Billing:** usage is billed by Moonshot AI against your API key, entirely separate from your GitHub Copilot subscription.

## Requirements

- VS Code **1.104.0** or newer (the first release with the stable Language Model Chat Provider API).
- A Moonshot API key.
- Access to GitHub Copilot Chat (models contributed through this API are available to Copilot Chat users; Business/Enterprise admins may gate BYOK providers via policy).

## Privacy

Prompts, file context, and tool results you send in chat are transmitted directly to Moonshot AI under your own API key and are subject to [Moonshot's policies](https://platform.kimi.ai/docs). This extension collects nothing, stores nothing besides the secret key, and phones nowhere else.

## Development

```bash
npm install
npm run compile   # type-check + build to out/
npm test          # unit tests (no credentials needed)
npm run lint      # eslint
npm run package   # produces a .vsix via @vscode/vsce
```

Press **F5** in VS Code to launch an Extension Development Host.

Optional live integration tests (auto-skipped without a key):

```bash
KIMI_INTEGRATION=1 MOONSHOT_API_KEY=sk-... npm test
```

## License

MIT — No Bugs Given (see `LICENSE` in the repository)
