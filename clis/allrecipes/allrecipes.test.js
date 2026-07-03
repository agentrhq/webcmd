import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { buildRecipeScript, mapRecipe } from './recipe.js';

function page(result) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(result),
    };
}

describe('allrecipes recipe', () => {
    const cmd = getRegistry().get('allrecipes/recipe');

    it('maps JSON-LD recipe data into one row', async () => {
        const p = page({
            ok: true,
            href: 'https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/',
            payload: {
                name: "World's Best Lasagna",
                author: { name: 'John Chandler' },
                aggregateRating: { ratingValue: '4.8', ratingCount: '20500' },
                prepTime: 'PT30M',
                cookTime: 'PT2H30M',
                totalTime: 'PT3H15M',
                recipeYield: ['12 servings'],
                nutrition: { calories: '448 calories' },
                recipeIngredient: ['1 pound sweet Italian sausage', '12 lasagna noodles'],
                recipeInstructions: [{ text: 'Cook sausage.' }, { text: 'Layer noodles.' }],
            },
        });

        const rows = await cmd.func(p, { url: 'https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/' });
        expect(p.goto).toHaveBeenCalledWith('https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/');
        expect(rows).toEqual([{
            title: "World's Best Lasagna",
            author: 'John Chandler',
            rating: 4.8,
            ratingCount: 20500,
            prepTime: 'PT30M',
            cookTime: 'PT2H30M',
            totalTime: 'PT3H15M',
            servings: '12 servings',
            calories: '448 calories',
            ingredients: '1 pound sweet Italian sausage\n12 lasagna noodles',
            instructions: '1. Cook sausage.\n2. Layer noodles.',
            url: 'https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/',
        }]);
    });

    it('rejects non-Allrecipes URLs', async () => {
        await expect(cmd.func(page({}), { url: 'https://example.com/recipe' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('reports browser verification challenges', async () => {
        await expect(cmd.func(page({ ok: false, challenge: true }), {
            url: 'https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/',
        })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError when no title is extracted', async () => {
        await expect(cmd.func(page({ ok: true, payload: {}, href: 'https://www.allrecipes.com/recipe/x/' }), {
            url: 'https://www.allrecipes.com/recipe/x/',
        })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('allrecipes helpers', () => {
    it('builds a JSON-LD extraction script', () => {
        expect(buildRecipeScript()).toContain('application/ld+json');
        expect(buildRecipeScript()).toContain("'@type'");
    });

    it('maps array authors and raw instruction strings', () => {
        expect(mapRecipe({
            name: 'A &amp; B Pie',
            author: [{ name: 'A' }, { name: 'B' }],
            recipeInstructions: ['Bake it &#39;til done.'],
        }, 'https://www.allrecipes.com/recipe/1/pie/')).toMatchObject({
            title: 'A & B Pie',
            author: 'A, B',
            instructions: "1. Bake it 'til done.",
        });
    });
});
