import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let startedAt: number | null = null;
  let generatedTokens = 0;
  let inputTokens = 0;

  pi.on("agent_start", () => {
    if (startedAt === null) startedAt = Date.now();
  });

  pi.on("agent_end", (event) => {
    for (const message of event.messages) {
      if (message.role === "assistant" && message.usage) {
        generatedTokens += message.usage.output;
        inputTokens += message.usage.input;
      }
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (startedAt === null) return;
    const elapsedMs = Date.now() - startedAt;
    startedAt = null;

    const seconds = elapsedMs / 1000;
    const outputTokensPerSecond = seconds > 0 ? generatedTokens / seconds : 0;
    const inputTokensPerSecond = seconds > 0 ? inputTokens / seconds : 0;
    const summary = `Answered in ${seconds.toFixed(1)}s • ${inputTokens} input tokens (${Math.round(inputTokensPerSecond)} tok/s) • ${generatedTokens} output tokens (${Math.round(outputTokensPerSecond)} tok/s)`;
    generatedTokens = 0;
    inputTokens = 0;
    if (ctx.hasUI) {
      ctx.ui.notify(summary, "info");
    }
  });
}
