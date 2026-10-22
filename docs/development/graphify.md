# Local Graphify tooling

Graphify provides a structural source graph for repository exploration. The project
helper pins Graphify `0.9.93` (the PyPI distribution is named `graphifyy`) and all
29 dependencies in `scripts/dev/graphify-constraints.txt`.

Run from the repository with Node.js 22+, `uv`, and Python 3.12 already available:

```bash
node scripts/dev/graphify.mjs setup
node scripts/dev/graphify.mjs analyze
node scripts/dev/graphify.mjs verify
```

Setup creates an isolated Python environment under the OS temporary directory,
in `thredos-graphify/<project-path-hash>/tool`. This keeps Python interpreter
symlinks outside Next.js/Turbopack's source scan. It uses
`uv pip sync`, exact versions, `--no-build`, and the official
`https://pypi.org/simple` index. It disables Python downloads and ignores uv config
and index environment overrides. A platform without compatible wheels fails;
setup does not fall back to building a source distribution.

The environment and package cache live under that temporary directory; the graph
and analysis cache live under the already ignored `output/` directory. Setup does not install project dependencies, Git hooks,
editor integrations, or model providers.

## Verified offline setup

An optional wheelhouse can avoid all package network access:

```bash
node scripts/dev/graphify.mjs setup --wheelhouse /path/to/graphify-wheelhouse
```

The verified cloud fixture is currently
`/workspace/.cloud-tools/graphify-wheelhouse`. Its `official-provenance.json`
records all 30 wheel filenames and SHA-256 digests checked against official PyPI
metadata. The project constraints file pins that manifest's digest. Setup checks
the manifest, package versions, every wheel checksum, and rejects unlisted wheels
before invoking uv. Installation then uses `--offline --no-index --no-build
--require-hashes` with generated hashed requirements.

That fixture contains Linux x64 / CPython 3.12 wheels. Other platforms need
compatible official PyPI wheels through the default setup. Replacing the trusted
offline wheelhouse requires reviewing and updating its manifest digest in the
constraints file; a self-declared manifest is not sufficient.

## Structural analysis and local exploration

The analysis command runs this exact extraction from the repository root:

```text
graphify extract . --code-only --out output/graphify --max-workers 2 --timing
```

The graph is written to `output/graphify/graphify-out/graph.json`, including the
nested `graphify-out` directory. Verification requires nonempty nodes and edges
and source nodes under `lib/agents/`, `lib/runner/`, and `lib/runtime/`.
`--code-only` uses local AST extraction and skips semantic model analysis.
Every helper invocation sets `GRAPHIFY_NO_AUTO_REFRESH=1` so queries do not
automatically refresh through a model workflow.

```bash
node scripts/dev/graphify.mjs query "Which modules use the canonical agent registry?" --seed lib/agents/repository.ts --budget 1000
node scripts/dev/graphify.mjs explain lib/agents/repository.ts
```

These commands traverse or explain the existing local graph. Rerun `analyze`
explicitly after source changes. A graph is exploration evidence; it does not
replace tests, typechecking, or inspection of current source.

## Cloud environment scope

The setup and graph have been exercised in the current execution environment.
The saved environment configuration interface is not exposed here, so this
helper does not claim to update saved startup configuration or persist an
environment across sessions. The OS may remove the temporary environment. Keep these source files in version
control and rerun setup when preparing another environment or after cleanup.
