# Contributing

Issues and pull requests are welcome. For a larger change, open an issue first. The
[board](https://github.com/users/enojen/projects/2) shows what is in progress and what comes
next; pick a task from it or open a new one. A task has three parts: why, what, and when it
is done.

1. Fork the repository and make a branch from `main`.
2. Run `bun install`.
3. Keep the code rules in [`CLAUDE.md`](CLAUDE.md): write a failing test first, then the code.
4. Before you open the pull request, run the checks:

   ```sh
   bunx tsc --noEmit
   bun test cli domain server rules
   bunx biome format --write cli domain server rules
   bunx biome check --formatter-enabled=false cli domain server rules
   bunx knip
   ```

5. Keep one change per pull request. If the change alters what a command does, update
   [`docs/reference.md`](docs/reference.md) in the same pull request.

By contributing, you agree that your work is licensed under the [MIT License](LICENSE).
