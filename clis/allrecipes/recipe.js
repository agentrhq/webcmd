import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const HOST = /^https?:\/\/(?:www\.)?allrecipes\.com\//i;

function requireUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) throw new ArgumentError('allrecipes recipe URL is required');
    if (!HOST.test(url)) throw new ArgumentError(`URL must be on allrecipes.com, got ${url}`);
    return url;
}

function asText(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
    if (typeof value === 'object') return asText(value.name || value.text);
    return decodeHtml(String(value).trim());
}

function decodeHtml(value) {
    return String(value ?? '')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function instructionText(value) {
    if (!Array.isArray(value)) return asText(value);
    return value
        .map((step) => asText(step?.text || step?.name || step))
        .filter(Boolean)
        .map((step, i) => `${i + 1}. ${step}`)
        .join('\n');
}

export function mapRecipe(recipe, fallbackUrl) {
    const rating = recipe?.aggregateRating || {};
    const ratingCount = rating.ratingCount ?? rating.reviewCount;
    return {
        title: asText(recipe?.name),
        author: asText(recipe?.author),
        rating: rating.ratingValue == null ? null : Number(rating.ratingValue),
        ratingCount: ratingCount == null ? null : Number(ratingCount),
        prepTime: asText(recipe?.prepTime),
        cookTime: asText(recipe?.cookTime),
        totalTime: asText(recipe?.totalTime),
        servings: asText(recipe?.recipeYield),
        calories: asText(recipe?.nutrition?.calories),
        ingredients: Array.isArray(recipe?.recipeIngredient) ? recipe.recipeIngredient.map(asText).join('\n') : '',
        instructions: instructionText(recipe?.recipeInstructions),
        url: asText(recipe?.url) || fallbackUrl,
    };
}

export function buildRecipeScript() {
    return `(() => {
  const bodyText = document.body?.innerText || '';
  if (/Just a moment|Enable JavaScript and cookies to continue/i.test(document.title + '\\n' + bodyText)) {
    return { ok: false, challenge: true };
  }
  const isRecipe = (item) => {
    const type = item && item['@type'];
    return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
  };
  const visit = (item) => {
    if (!item || typeof item !== 'object') return null;
    if (isRecipe(item)) return item;
    if (Array.isArray(item)) {
      for (const child of item) {
        const found = visit(child);
        if (found) return found;
      }
    }
    const graph = item['@graph'];
    return Array.isArray(graph) ? visit(graph) : null;
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = visit(JSON.parse(script.textContent || 'null'));
      if (found) return { ok: true, payload: found, href: location.href };
    } catch {}
  }
  const title = document.querySelector('h1')?.textContent?.trim() || '';
  return title ? { ok: true, payload: { name: title, url: location.href }, href: location.href } : { ok: false };
})()`;
}

cli({
    site: 'allrecipes',
    name: 'recipe',
    access: 'read',
    description: 'Extract an Allrecipes recipe from a recipe URL',
    domain: 'www.allrecipes.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'url', positional: true, required: true, help: 'Allrecipes recipe URL' },
    ],
    columns: ['title', 'author', 'rating', 'ratingCount', 'prepTime', 'cookTime', 'totalTime', 'servings', 'calories', 'ingredients', 'instructions', 'url'],
    func: async (page, args) => {
        const url = requireUrl(args.url);
        await page.goto(url);
        await page.wait(2);
        const result = await page.evaluate(buildRecipeScript());
        if (result?.challenge) {
            throw new CommandExecutionError('Allrecipes showed a browser verification challenge', 'Retry with a logged-in/persistent browser session after the page finishes loading.');
        }
        if (!result?.ok) {
            throw new CommandExecutionError('allrecipes recipe extraction failed', 'Check that the URL points to an Allrecipes recipe page.');
        }
        const row = mapRecipe(result.payload, result.href || url);
        if (!row.title) {
            throw new EmptyResultError('allrecipes recipe', 'The page loaded but no recipe title was found.');
        }
        return [row];
    },
});
