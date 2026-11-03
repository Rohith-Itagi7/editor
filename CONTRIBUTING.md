# Contributing

Open an issue first for anything larger than a small fix, so we agree on the direction before you spend time on it.

1. Fork the repo and branch from `main`.
2. `node serve.mjs` runs the editor at http://127.0.0.1:4192/. `npm test` runs the tests.
3. Keep to the layout in `CLAUDE.md` (where things go, and the rules that are easy to break). `tests/architecture.test.mjs` fails on a file that imports from the wrong folder.
4. Open a pull request against `main`. `main` takes no direct pushes; every change goes through a pull request.
