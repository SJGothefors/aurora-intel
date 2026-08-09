# Local model: privacy, context and performance

[Documentation home](../INDEX.md) · [Technical documentation](INDEX.md) · [Security](SECURITY.md) · [Prompts](PROMPTS.md) · [User documentation](../user/INDEX.md)

## No cloud API

Aurora does not call an online model API. `dev:ai` and the packaged offline start launch `llama-server` on literal `127.0.0.1`. The application calls its OpenAI-compatible local `/v1/chat/completions` route. No OpenAI, Anthropic or other cloud account/API key is used or stored.

At every start the supervisor generates a random 256-bit local bearer key. It passes it only in the child-process environment as `LLAMA_API_KEY` and `AURORA_LLM_API_KEY`. It is not written to configuration, the database, command arguments or logs, and disappears when the processes stop. This key prevents casual use by another local process; it is not a substitute for a controlled operating system account.

## What enters a request

Requests are stateless. Aurora selects only the relevant bounded material for each task:

- the current report or question;
- up to the configured case/evidence limit;
- relevant excerpts selected from local `knowledge/*.md`;
- active controlled vocabulary and likelihood scale;
- optional manually entered weather for consolidated assessments.

The whole database is not blindly copied into every prompt. Source text is treated as untrusted data, JSON output is schema checked, and AI-selected controlled terms are validated before save.

## Context window and cleanup

The model context is finite (the pinned configuration uses an 8192-token context). It cannot remain “full” across calls because Aurora sends a fresh bounded request for every job; there is no conversation history accumulating in the application. llama.cpp may reuse an internal prompt/KV cache for speed, but it is runtime memory and is released on shutdown. Completed job payloads are cleared, results are pruned by age/count, and knowledge/case excerpts have hard size limits. Therefore a separate conversational garbage collector is neither needed nor desirable.

## Speed

The first request may be slower while the model loads and its prompt cache warms. The deterministic labeled-7S parser bypasses the model where possible. Aurora starts one llama processing slot because its own AI queue is sequential; extra idle slots only reserve more context memory. Knowledge, case evidence and generated output are tightly bounded, and Q&A uses a short-answer limit instead of allowing a 600-token completion. Consolidated assessments are debounced so several quick edits produce one job, not one per keystroke.

Speed still depends on model size, quantization, CPU/GPU acceleration and prompt length. The supplied trace showed requests consuming the full former 600-token output allowance and spending additional time processing more than 3,300 prompt tokens. The current limits address both causes. A smaller approved model can be faster but must be accuracy-tested; Aurora must never add a remote fallback.

For production, benchmark the approved hardware with representative Swedish 7S reports and retain accuracy results. Do not add a remote fallback; if the model is stopped, Aurora must show AI unavailable and keep manual functions working.
