# Fatty15 Line Title Cleanup

Set the product title customers see, per language, without changing the product itself. Built for
titles like "90-Day Starter Kit - Shopify": the product keeps its title in the admin (and for any
integration that matches on it), while customers see "90-Day Starter Kit" in the store, cart,
checkout and order.

## How it works

The app page (Apps → **Fatty15 Line Title Cleanup**, `extensions/app-home`) lists every product
(search by title, 25 per page). Open a product to get one field per store language
(Settings → Languages, default language first):

- **Empty field:** customers see the product's own title (or, for other languages, its regular
  translation). The placeholder shows that title.
- **Filled field:** customers see this title in that language. Saving stores it in **every market**.
- **Clearing a field** and saving removes the title again.

Titles are saved as **market adaptations**: translations with a `marketId`, the same thing
Translate & Adapt saves under "Adapt for [market]" (so they also show, and can be edited, there).
The product title and regular translations are never changed; an adaptation only takes priority
over them in its market.

The page warns when a saved title needs saving again:

- the product title changed since it was saved (the adaptation is marked outdated), or
- it's missing from some markets, e.g. a market added later.

There is no backend: the page calls the Admin API directly (`[access.admin]` in the app config),
so nothing needs hosting.

## IP allowlist (required to install)

Shopify requires an IP allowlist on custom apps installed on stores outside the organization that
owns the app (since Nov 20, 2026 for new installs). Without it the install screen shows
**"IP allowlist required"**.

This app makes no Admin API requests with its own access token, so it uses **Block all requests**:

1. [Dev Dashboard](https://dev.shopify.com) → **Fatty15 Line Title Cleanup** → **Settings** →
   **IP allowlist** → **Manage**.
2. Access policy: **Block all requests** (leave the IP and ASN fields empty).
3. **Run test** (optional): any requests listed are ones made with the app's token, e.g.
   `shopify app execute` from a developer machine. The app page doesn't make those.
4. Turn on **Enforce IP allowlist** and **Save**.

The app page keeps working: direct API access from admin UI extensions and dev previews are never
blocked. `shopify app execute` with this app's token is blocked (403); test through the app page.

## Access scopes

| Scope                                     | Used for                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `read_products`                           | Product list and product details                                              |
| `read_locales`                            | One field per store language                                                  |
| `read_markets`                            | Saving the title in every market                                              |
| `read_translations`, `write_translations` | Reading and saving the titles (`translationsRegister`, `translationsRemove`)  |

## Develop

The app config is `shopify.app.fatty15-line-title-cleanup.toml`.

```bash
npm install
shopify app dev --store <store> --config fatty15-line-title-cleanup
```

Type-check the page (catches wrong component props):

```bash
npx -p typescript@5 tsc -p extensions/app-home/tsconfig.json --ignoreDeprecations 5.0
```

Deploy a version:

```bash
shopify app deploy --config fatty15-line-title-cleanup
```

## Install on a store

1. Set up the IP allowlist (above), if not done yet.
2. `shopify app deploy --config fatty15-line-title-cleanup`, then install the app on the store
   (custom distribution install link from the Dev Dashboard) and accept the access scopes.
3. Open Apps → **Fatty15 Line Title Cleanup**, open a product and fill the titles.

## Testing a language in checkout

Checkout has no language switcher: it uses the language the buyer browsed in. Publish the language
(Settings → Languages), add it to the market (Settings → Markets → [market] → Languages), then
open the product from its language URL (e.g. `/fr/products/<handle>`), add to cart and check out.

## Notes

- **New markets** don't get existing titles automatically: open the product and save again
  (the page shows "Set in X of Y markets").
- **Uninstalling the app doesn't remove saved titles.** Clear them first, or remove them in
  Translate & Adapt.
- **Order emails** use their own templates (Settings → Notifications); check they show the title
  customers saw, or use `{{ line.title | remove: ' - Shopify' }}` there.
