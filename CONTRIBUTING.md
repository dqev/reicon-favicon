# Contributing

Thanks for helping improve favicon.reicon.dev.

## Development

```sh
npm install
npm run dev        # local Worker on the favicon routes
npm run typecheck
npm test
```

## Guidelines

- Keep the Worker fast and cheap. It runs on the Cloudflare Workers **Free** plan
  (10 ms CPU per request), so avoid heavy parsing or extra allocations on the hot
  path. Abort work early when a good enough result is available.
- Add tests for logic in `src/` under `test/`.
- Run `npm run typecheck && npm test` before opening a pull request.
- Match existing code style. No comments unless they explain non-obvious behavior.

## Pull requests

- Keep changes focused; one concern per PR.
- Describe the user-visible effect and any new query params or headers.
- Do not add new runtime dependencies without discussion.
