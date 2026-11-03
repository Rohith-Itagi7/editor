# Editor

![A file connected to a GitHub repo: its tokens come into the theme, three agents build its components, and a screen is made from them](https://raw.githubusercontent.com/michael-jordan-coder/editor/media/agent-github.gif)

A design editor where agents design in your file, from your product's own code. Connect a GitHub repo and
the repo's CSS variables become the file's tokens, agents build a Components page from its `components/ui`,
and every screen they make after that is put together from those components. Every node is a real HTML
element, so what you see is what ships. Live sync between people, and any MCP agent (Claude Code, Codex)
can work in the open file.

Above, at up to 8x: Connect, Import, three agents building the components, three more building a Settings
screen from them. Four minutes in all. [Full video](https://github.com/michael-jordan-coder/editor/blob/media/agent-github.mp4).

## Run

```bash
node serve.mjs    # http://127.0.0.1:4192/
npm start         # the same, as a Mac, Windows or Linux app
npm test
```

Put `ANTHROPIC_API_KEY` in `.env.local` for the agent panel, and `GITHUB_TOKEN` to connect a private repo.
Fonts come from Google Fonts, so it needs the internet once per page load.

## What is in it

Pages, a design panel, theme tokens as one block of CSS, a Pen and vector networks, comments with mentions,
copy and paste of HTML and images, Import URL, Play (a frame as its own page), Share (read-only links), sign-in
when you want it, and export to PNG, PDF, JSX or Tailwind.

Agents reach it over MCP at `/mcp` (in the app: File ▸ Connect Agents). Each tool runs in the page that has the
file open, so an agent's edit is one undo step, is saved, and reaches everyone else live, with the agent's own
pointer on the canvas. The agent panel runs up to ten of them at once on one request.

[CLAUDE.md](CLAUDE.md) has the layout of the code and where things go; [CONTRIBUTING.md](CONTRIBUTING.md) how to send a change.

## License

MIT, see [LICENSE](LICENSE).
