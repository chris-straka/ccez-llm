# Google News relay (z)

llm.ccez.uk's news runs in Pages Functions (`functions/api/`), but Google
refuses requests from Cloudflare's servers (503 for every header set;
Jina and GDELT refuse or throttle them too, checked 2026-11-05). The
site's two Google calls (a feed, a story link's publisher URL) come
through this relay on z instead; articles and pictures still load from
Cloudflare.

- `news-relay.ts`: `GET /rss?url=https://news.google.com/rss…` and
  `GET /decode?link=…`, nothing else, behind `x-relay-token`. Shares its
  decoding with the functions (`src/lib/web-fetch.ts`).
- `install.sh`: bundles it to `~/.local/share/ccez-news-relay/`, runs it
  at login (`uk.ccez.news-relay`, launchd keeps it up), publishes
  127.0.0.1:8799 through Tailscale Funnel at
  `https://z.tailfe37c2.ts.net:10000`. Run it again after changing the
  relay.
- Token: `~/.config/ccez-news-relay/token` (made once by the installer),
  the same value as the Pages secret `RELAY_TOKEN`:
  `npx wrangler pages secret put RELAY_TOKEN --project-name personalized-llm-client < ~/.config/ccez-news-relay/token`.

Costs nothing: Funnel is free, the functions sit in Cloudflare's free
tier, and answers are cached for ten minutes. If z is off, the website's
headlines are off; the app is unaffected.
