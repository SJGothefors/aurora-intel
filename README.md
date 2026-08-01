# Aurora Intel

Aurora Intel is an offline-first intelligence ledger for reviewing and structuring Swedish 7S observation reports. The application, map, data store, and optional local language model all run on `127.0.0.1`; no cloud service is used at runtime.

The default end-user guide is [docs/README.sv.md](docs/README.sv.md). English documentation is available in [docs/README.en.md](docs/README.en.md).

## Developer quick start

```sh
npm install
npm run build
npm test
npm start
```

Then open `http://127.0.0.1:8474`. For a fully air-gapped release, including portable runtimes, llama.cpp, and a GGUF model, follow [docs/OFFLINE_PACKAGING.md](docs/OFFLINE_PACKAGING.md).
