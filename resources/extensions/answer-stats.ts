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

    const totalSeconds = elapsedMs / 1000;
    const outputTokensPerSecond = totalSeconds > 0 ? generatedTokens / totalSeconds : 0;
    const inputTokensPerSecond = totalSeconds > 0 ? inputTokens / totalSeconds : 0;
    const wholeSeconds = Math.floor(totalSeconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;
    const duration = hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
    const summary = `Answered in ${duration} • ${inputTokens} input tokens (${Math.round(inputTokensPerSecond)} tok/s) • ${generatedTokens} output tokens (${Math.round(outputTokensPerSecond)} tok/s)`;
    generatedTokens = 0;
    inputTokens = 0;
    if (ctx.hasUI) {
      ctx.ui.notify(summary, "info");
    }
  });
}
