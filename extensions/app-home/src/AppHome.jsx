import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// Titles are saved as market adaptations (translations with a marketId), the same thing
// Translate & Adapt saves under "Adapt for <market>". The product's own title is never changed,
// and regular translations made elsewhere are left alone: an adaptation only takes priority over them.
const KEY = 'title';
const PAGE_SIZE = 25;

export default async () => {
  render(<App />, document.body);
};

/** Admin API (direct access from the app home). */
async function adminGraphql(query, variables) {
  const response = await fetch('shopify:admin/api/2026-07/graphql.json', {
    method: 'POST',
    body: JSON.stringify({query, variables}),
  });
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

function App() {
  const [productId, setProductId] = useState(/** @type {string | null} */ (null));

  return productId ? (
    <ProductTitles productId={productId} onBack={() => setProductId(null)} />
  ) : (
    <ProductList onOpen={setProductId} />
  );
}

/* ------------------------------------------------------------------ */
/* Product list                                                        */
/* ------------------------------------------------------------------ */

/** Search text → Admin API product query (matches anywhere in the title). */
const searchQuery = (text) => {
  const term = text.trim().replace(/["\\]/g, '');
  return term ? `title:*${term}*` : null;
};

const STATUS_TONE = {ACTIVE: 'success', DRAFT: 'info', ARCHIVED: 'neutral'};
const STATUS_LABEL = {ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived', UNLISTED: 'Unlisted'};

function ProductList({onOpen}) {
  const [search, setSearch] = useState('');
  // Cursor of the page to load: {after} for next, {before} for previous, {} for the first page.
  const [cursor, setCursor] = useState(/** @type {{after?: string, before?: string}} */ ({}));
  const [products, setProducts] = useState([]);
  const [pageInfo, setPageInfo] = useState({hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Debounced search: typing resets to the first page.
  const [query, setQuery] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchQuery(search));
      setCursor({});
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const page = cursor.before ? {last: PAGE_SIZE, before: cursor.before} : {first: PAGE_SIZE, after: cursor.after ?? null};
    adminGraphql(`#graphql
      query TitleProducts($first: Int, $last: Int, $after: String, $before: String, $query: String) {
        products(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: TITLE) {
          nodes {
            id
            title
            status
            featuredMedia { preview { image { url(transform: {maxWidth: 80, maxHeight: 80}) altText } } }
          }
          pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        }
      }`, {...page, query})
      .then((data) => {
        if (cancelled) return;
        setProducts(data.products.nodes);
        setPageInfo(data.products.pageInfo);
      })
      .catch((e) => !cancelled && setError(`Couldn't load the products: ${e.message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, cursor]);

  return (
    <s-page heading="Product titles">
      {error && (
        <s-banner tone="critical" heading="Something went wrong">
          {error}
        </s-banner>
      )}

      <s-section padding="none">
        <s-table
          paginate
          loading={loading}
          hasNextPage={pageInfo.hasNextPage}
          hasPreviousPage={pageInfo.hasPreviousPage}
          onNextPage={() => setCursor({after: pageInfo.endCursor})}
          onPreviousPage={() => setCursor({before: pageInfo.startCursor})}
        >
          <s-grid slot="filters" gap="small-200">
            <s-search-field
              label="Search products"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search products"
              value={search}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
          </s-grid>

          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header listSlot="secondary">Status</s-table-header>
          </s-table-header-row>

          <s-table-body>
            {products.map((product) => {
              const linkId = `open-${product.id.split('/').pop()}`;
              const image = product.featuredMedia?.preview?.image;
              return (
                <s-table-row key={product.id} clickDelegate={linkId}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-thumbnail src={image?.url} alt={image?.altText ?? product.title} size="small" />
                      <s-link id={linkId} onClick={() => onOpen(product.id)}>
                        {product.title}
                      </s-link>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[product.status] ?? 'neutral'}>
                      {STATUS_LABEL[product.status] ?? product.status}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>

        {!loading && !products.length && !error && (
          <s-box padding="base">
            <s-paragraph>No products found.</s-paragraph>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

/* ------------------------------------------------------------------ */
/* One product: a title field per store language                      */
/* ------------------------------------------------------------------ */

/** "pt-BR" → "pt_BR" (GraphQL alias-safe). */
const aliasFor = (locale) => locale.replace(/[^a-zA-Z0-9]/g, '_');

/**
 * Reads, for every language: the regular translation (what customers see when no title is set
 * here) and the adaptation saved in each market.
 */
function translationsQuery(locales, markets) {
  const fields = [];
  for (const locale of locales) {
    const alias = aliasFor(locale);
    fields.push(`base_${alias}: translations(locale: "${locale}") { key value }`);
    markets.forEach((market, i) => {
      fields.push(`m${i}_${alias}: translations(locale: "${locale}", marketId: "${market.id}") { key value outdated }`);
    });
  }
  return `query TitleTranslations($id: ID!) {
    translatableResource(resourceId: $id) {
      ${fields.join('\n      ')}
    }
  }`;
}

const titleOf = (translations) => translations?.find((t) => t.key === KEY);

const languageLabel = ({name, primary, published}) => {
  if (primary) return `${name} (default language)`;
  return published ? name : `${name} (not published yet)`;
};

function ProductTitles({productId, onBack}) {
  const [product, setProduct] = useState(/** @type {any} */ (null));
  const [digest, setDigest] = useState('');
  const [markets, setMarkets] = useState(/** @type {{id: string, name: string}[]} */ ([]));
  // One entry per store language: {locale, name, primary, published, fallback, saved, savedIn, outdated, mixed}
  const [languages, setLanguages] = useState([]);
  const [values, setValues] = useState(/** @type {Record<string, string>} */ ({}));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await adminGraphql(`#graphql
        query TitleProduct($id: ID!) {
          product(id: $id) {
            id
            title
            featuredMedia { preview { image { url(transform: {maxWidth: 120, maxHeight: 120}) altText } } }
          }
          translatableResource(resourceId: $id) {
            translatableContent { key digest }
          }
          shopLocales { locale name primary published }
          markets(first: 250) { nodes { id name } }
        }`, {id: productId});

      if (!data.product) throw new Error('Product not found.');

      const shopLocales = [...data.shopLocales].sort(
        (a, b) => Number(b.primary) - Number(a.primary) || Number(b.published) - Number(a.published) || a.name.localeCompare(b.name),
      );
      const marketList = data.markets.nodes;
      const translations = (
        await adminGraphql(translationsQuery(shopLocales.map((l) => l.locale), marketList), {id: productId})
      ).translatableResource;

      const list = shopLocales.map((shopLocale) => {
        const alias = aliasFor(shopLocale.locale);
        const perMarket = marketList.map((_, i) => titleOf(translations[`m${i}_${alias}`]));
        const saved = perMarket.find((t) => t?.value)?.value ?? '';
        const savedIn = perMarket.filter((t) => t?.value).length;
        return {
          ...shopLocale,
          // What customers see when the field is empty: the regular translation, else the product title.
          fallback: (!shopLocale.primary && titleOf(translations[`base_${alias}`])?.value) || data.product.title,
          saved,
          savedIn,
          outdated: perMarket.some((t) => t?.outdated),
          mixed: new Set(perMarket.map((t) => t?.value ?? '')).size > 1,
        };
      });

      setProduct(data.product);
      setDigest(titleOf(data.translatableResource.translatableContent)?.digest ?? '');
      setMarkets(marketList);
      setLanguages(list);
      setValues(Object.fromEntries(list.map((l) => [l.locale, l.saved])));
    } catch (e) {
      setError(`Couldn't load the product: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [productId]);

  // A language needs saving when its value changed, or when its markets disagree / are missing it
  // (e.g. a market added after the title was saved), or when the saved title is outdated.
  const pending = languages.filter((l) => {
    const value = (values[l.locale] ?? '').trim();
    if (value !== l.saved) return true;
    if (!value) return false;
    return l.mixed || l.outdated || l.savedIn < markets.length;
  });

  async function save() {
    setSaving(true);
    setError('');
    try {
      const marketIds = markets.map((m) => m.id);
      for (const language of pending) {
        const value = (values[language.locale] ?? '').trim();
        if (value) {
          const data = await adminGraphql(`#graphql
            mutation SaveTitle($id: ID!, $translations: [TranslationInput!]!) {
              translationsRegister(resourceId: $id, translations: $translations) {
                userErrors { field message }
              }
            }`, {
            id: productId,
            translations: marketIds.map((marketId) => ({
              key: KEY,
              locale: language.locale,
              value,
              translatableContentDigest: digest,
              marketId,
            })),
          });
          const userErrors = data.translationsRegister.userErrors;
          if (userErrors.length) throw new Error(`${language.name}: ${userErrors.map((e) => e.message).join('; ')}`);
        } else {
          const data = await adminGraphql(`#graphql
            mutation RemoveTitle($id: ID!, $locales: [String!]!, $marketIds: [ID!]) {
              translationsRemove(resourceId: $id, translationKeys: ["title"], locales: $locales, marketIds: $marketIds) {
                userErrors { field message }
              }
            }`, {id: productId, locales: [language.locale], marketIds});
          const userErrors = data.translationsRemove.userErrors;
          if (userErrors.length) throw new Error(`${language.name}: ${userErrors.map((e) => e.message).join('; ')}`);
        }
      }
      shopify.toast.show('Titles saved');
      await load();
    } catch (e) {
      setError(`Couldn't save the titles: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  const dirty = pending.length > 0;
  const image = product?.featuredMedia?.preview?.image;

  return (
    <s-page heading={product?.title ?? 'Product'}>
      <s-link slot="breadcrumb-actions" onClick={onBack}>
        Product titles
      </s-link>
      <s-button slot="primary-action" variant="primary" onClick={save} disabled={loading || !dirty} loading={saving}>
        Save
      </s-button>
      <s-button slot="secondary-actions" onClick={onBack}>
        {dirty ? 'Discard and go back' : 'Back'}
      </s-button>

      {error && (
        <s-banner tone="critical" heading="Something went wrong">
          {error}
        </s-banner>
      )}

      {loading ? (
        <s-section>
          <s-spinner accessibilityLabel="Loading product" />
        </s-section>
      ) : (
        product && (
          <s-section heading="Title shown to customers">
            <s-stack gap="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-thumbnail src={image?.url} alt={image?.altText ?? product.title} size="base" />
                <s-stack gap="small-300">
                  <s-text type="strong">{product.title}</s-text>
                  <s-text color="subdued">Product title in Shopify (not changed by this app)</s-text>
                </s-stack>
              </s-stack>

              <s-paragraph>
                Set the title customers see in the store, cart, checkout and order for each language. Leave a field
                empty to show the product's own title. Saving applies the title in all {markets.length} market
                {markets.length === 1 ? '' : 's'}.
              </s-paragraph>

              {!markets.length && (
                <s-banner tone="warning" heading="No markets">
                  Titles are saved per market, and this store has none.
                </s-banner>
              )}

              {languages.map((language) => {
                const value = values[language.locale] ?? '';
                const shown = value.trim() || language.fallback;
                const notes = [`Customers see: ${shown}`];
                if (language.saved && language.outdated) notes.push('The product title changed since this was saved: save again to keep it current.');
                if (language.saved && (language.mixed || language.savedIn < markets.length)) {
                  notes.push(`Set in ${language.savedIn} of ${markets.length} markets: save to apply it to all.`);
                }
                return (
                  <s-text-field
                    key={language.locale}
                    label={languageLabel(language)}
                    placeholder={language.fallback}
                    value={value}
                    details={notes.join(' ')}
                    onInput={(event) => setValues({...values, [language.locale]: event.currentTarget.value})}
                  />
                );
              })}
            </s-stack>
          </s-section>
        )
      )}
    </s-page>
  );
}
