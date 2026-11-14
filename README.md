# Token Radar

A token launch radar for [make.fun](https://make.fun) competition `token-radar-01`.
It reads a sealed snapshot of the DeFi protocol universe, ranks every pre-token
protocol by **implied value**, gives each one a concrete farm plan, and writes a
static dashboard you can open offline.

## What it does

- Scores **300 protocols**: the 40-protocol watchlist (TVL ≥ $50M, no token on
  record) plus 260 early pre-token protocols below the floor, by TVL.
- Implied value comes from the snapshot's own figures, never from a hand-kept
  list of names:
  - **Category multiple** — the median market-cap-to-TVL ratio of the live-token
    protocols in the same category (snapshot-wide median when a category has
    fewer than 3 live comparables), clamped to 0.05–1.5.
  - **Growth** — 7-day TVL change, clamped to −50…+150%, weight 0.6.
  - **Maturity** — a sweet spot over age: 0.55 at listing, rising to 1.0 at
    2 years, flat to 4 years, easing to 0.85 after that.
  - **Breadth** — +2% per extra chain, up to +10%.
  - `implied = round(tvl × category_multiple × growth_mult × maturity_mult × breadth_mult)`
- Every row gets a 6-step farm plan derived from its category, chains, TVL and
  age, each step with a cost and a time.
- Live-token protocols are set aside with their real market caps, never mixed
  into the ranking.

## The dashboard

`dashboard/` is a static page (no framework, no network): sortable and
filterable board, per-protocol detail view with the model's own inputs and the
farm plan, a live-token view, and a **model sandbox** — move the growth weight,
the maturity peak or the category-multiple scale and the board recomputes live.

## Run it

Node 22, standard library only. No network, no dependencies.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Run it twice and the output is
byte-identical.

## Layout

- `main.ts` — entry point: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the radar-2 model: parsing, scoring, farm plans, the board.
- `vendor/makefun-board.ts` — the make.fun dossier library, shipped byte for byte.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`).
- `screenshots/` — the three submission screenshots (board, detail, filtered).

## License

MIT. See [LICENSE](LICENSE).
