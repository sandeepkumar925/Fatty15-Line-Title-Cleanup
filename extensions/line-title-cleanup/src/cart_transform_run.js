// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

// " - Shopify" at the end of a title, any case, any spacing around the dash.
const SUFFIX = /\s*-\s*shopify\s*$/i;

/**
 * Overrides the title of every line whose product title ends in " - Shopify",
 * so the cart, checkout, order summary and order show the clean name.
 * The product itself is not changed.
 *
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const operations = [];

  for (const line of input.cart.lines) {
    if (line.merchandise.__typename !== 'ProductVariant') continue;

    const title = line.merchandise.product.title;
    if (!SUFFIX.test(title)) continue;

    const cleanTitle = title.replace(SUFFIX, '');
    // Never send a blank title (e.g. a product literally named "- Shopify").
    if (!cleanTitle) continue;

    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        title: cleanTitle,
      },
    });
  }

  return { operations };
}
