/**
 * Configure Node's global HTTP dispatcher with generous timeouts before any
 * Ollama call happens. Undici's default headersTimeout / bodyTimeout is 60s,
 * which is shorter than prompt-processing + first-token latency for large
 * gemma4 generations on CPU. Without this override, long requests abort with
 * a silent connection error at exactly 60s.
 *
 * This runs once per Node process. Import it from entry points that talk to
 * Ollama (`lib/ai.ts`) before constructing the client.
 */
import { Agent, setGlobalDispatcher } from "undici";

const TEN_MINUTES = 10 * 60 * 1000;

const timeoutMs = Number(process.env.OLLAMA_HTTP_TIMEOUT_MS ?? TEN_MINUTES);

setGlobalDispatcher(
  new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    keepAliveTimeout: timeoutMs,
    connect: { timeout: timeoutMs },
  }),
);
