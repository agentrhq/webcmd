import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { pokeFetch, requireResource } from './utils.js';

cli({
    site: 'pokeapi',
    name: 'pokemon',
    access: 'read',
    description: 'Get Pokémon details by name or PokéAPI id',
    domain: 'pokeapi.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name-or-id', positional: true, required: true, help: 'Pokémon name slug or numeric id (e.g. pikachu, 25)' },
    ],
    columns: ['id', 'name', 'types', 'abilities', 'baseExperience', 'height', 'weight', 'stats', 'moveCount', 'sprite', 'url'],
    func: async (args) => {
        const resource = requireResource(args['name-or-id'], 'pokemon');
        const data = await pokeFetch('pokemon', resource);
        const types = (Array.isArray(data.types) ? data.types : [])
            .sort((a, b) => Number(a.slot) - Number(b.slot))
            .map((entry) => entry?.type?.name)
            .filter(Boolean)
            .join(', ');
        const abilities = (Array.isArray(data.abilities) ? data.abilities : [])
            .map((entry) => `${entry?.ability?.name ?? ''}${entry?.is_hidden ? ' (hidden)' : ''}`)
            .filter(Boolean)
            .join(', ');
        const stats = (Array.isArray(data.stats) ? data.stats : [])
            .map((entry) => `${entry?.stat?.name ?? 'unknown'}:${entry?.base_stat ?? ''}`)
            .join(', ');
        return [{
            id: data.id,
            name: data.name,
            types,
            abilities,
            baseExperience: data.base_experience,
            height: data.height,
            weight: data.weight,
            stats,
            moveCount: Array.isArray(data.moves) ? data.moves.length : 0,
            sprite: data.sprites?.front_default ?? '',
            url: data.id ? `https://pokeapi.co/api/v2/pokemon/${data.id}/` : '',
        }];
    },
});
