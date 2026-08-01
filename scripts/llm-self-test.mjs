#!/usr/bin/env node
const port = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(port)) process.exit(2);
const apiKey = process.env.AURORA_LLM_API_KEY;
const authHeaders = apiKey ? { authorization: `Bearer ${apiKey}` } : {};

const modelsResponse = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: authHeaders, signal: AbortSignal.timeout(5000) });
if (!modelsResponse.ok) throw new Error(`llama-server model probe returned HTTP ${modelsResponse.status}`);
const models = await modelsResponse.json();
const modelId = models?.data?.[0]?.id;
if (typeof modelId !== "string" || !modelId) throw new Error("llama-server reported no loaded model");

const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", ...authHeaders },
  body: JSON.stringify({
    model: modelId,
    temperature: 0,
    seed: 4242,
    max_tokens: 24,
    messages: [{ role: "user", content: "Return a JSON object with ok set to true." }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "aurora_build_echo",
        strict: true,
        schema: {
          type: "object",
          properties: { ok: { type: "boolean", const: true } },
          required: ["ok"],
          additionalProperties: false
        }
      }
    }
  }),
  signal: AbortSignal.timeout(90000)
});
if (!response.ok) throw new Error(`llama-server returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
const body = await response.json();
const content = body?.choices?.[0]?.message?.content;
if (typeof content !== "string") throw new Error("llama-server response had no message content");
const parsed = JSON.parse(content);
if (parsed.ok !== true || Object.keys(parsed).length !== 1) throw new Error(`Grammar-constrained output was invalid: ${content}`);
console.log("LLM grammar self-test: OK");
