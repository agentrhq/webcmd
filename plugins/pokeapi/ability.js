import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { englishEntry, pokeFetch, requireResource } from './utils.js';

cli({
    site: 'pokeapi',
    name: 'ability',
    access: 'read',
    description: 'Get a Pokémon ability by name or PokéAPI id',
    domain: 'pokeapi.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name-or-id', positional: true, required: true, help: 'Ability name slug or numeric id (e.g. static, 9)' },
    ],
    columns: ['id', 'name', 'generation', 'mainSeries', 'pokemonCount', 'effect', 'shortEffect', 'flavorText', 'url'],
    func: async (args) => {
        const resource = requireResource(args['name-or-id'], 'ability');
        const data = await pokeFetch('ability', resource);
        return [{
            id: data.id,
            name: data.name,
            generation: data.generation?.name ?? '',
            mainSeries: Boolean(data.is_main_series),
            pokemonCount: Array.isArray(data.pokemon) ? data.pokemon.length : 0,
            effect: englishEntry(data.effect_entries, 'effect'),
            shortEffect: englishEntry(data.effect_entries, 'short_effect'),
            flavorText: englishEntry(data.flavor_text_entries, 'flavor_text'),
            url: `${data.id ? `https://pokeapi.co/api/v2/ability/${data.id}/` : ''}`,
        }];
    },
});
