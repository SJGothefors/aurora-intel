# Default model provenance and redistribution

Aurora's default payload is `llm/models/mistral-7b-instruct-v0.3.Q4_K_M.gguf`. It is not stored in the source repository; the online `prepare_release` step fetches it from the immutable lock entry in `config/versions.lock` and refuses a mismatched SHA-256.

| Item | Pinned value |
|---|---|
| Upstream model | `mistralai/Mistral-7B-Instruct-v0.3` |
| Upstream model type | Instruct fine-tune of Mistral-7B-v0.3 |
| Upstream declared license | Apache License 2.0 |
| GGUF converter/repository | `bartowski/Mistral-7B-Instruct-v0.3-GGUF` |
| Immutable conversion revision | `61fd4167fff3ab01ee1cfe0da183fa27a944db48` |
| Source filename | `Mistral-7B-Instruct-v0.3-Q4_K_M.gguf` |
| Quantization | Q4_K_M |
| Expected bytes | `4,372,812,000` |
| Expected SHA-256 | `1270d22c0fbb3d092fb725d4d96c457b7b687a5f5a715abe1e818da303e562b6` |

The complete applicable Apache-2.0 text is shipped beside this file as `Mistral-7B-Instruct-v0.3-LICENSE.txt` and is included in every prepared release through the `assets/` directory. The upstream model card declares `apache-2.0`; the lock's immutable GGUF revision and digest identify the exact redistributed conversion. Preserve both files with the GGUF when redistributing it outside the Aurora release folder.

References for release review (online maintainer use only):

- `https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3`
- `https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/tree/61fd4167fff3ab01ee1cfe0da183fa27a944db48`

The model may produce inaccurate, biased, or fabricated output. Its presence and license do not constitute security review, military approval, certification, or fitness for operational use. Aurora treats every result as a schema-validated draft requiring human review. An organization distributing this payload remains responsible for its own legal, security, records, and model-risk review.
