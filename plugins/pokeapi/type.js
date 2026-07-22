import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { names, pokeFetch, requireResource } from './utils.js';

cli({
    site: 'pokeapi',
    name: 'type',
    access: 'read',
    description: 'Get Pokémon type details and damage relationships by name or PokéAPI id',
    domain: 'pokeapi.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name-or-id', positional: true, required: true, help: 'Type name slug or numeric id (e.g. fire, 10)' },
    ],
    columns: ['id', 'name', 'generation', 'doubleDamageFrom', 'doubleDamageTo', 'halfDamageFrom', 'halfDamageTo', 'noDamageFrom', 'noDamageTo', 'pokemonCount', 'moveCount', 'url'],
    func: async (args) => {
        const resource = requireResource(args['name-or-id'], 'type');
        const data = await pokeFetch('type', resource);
        const damage = data.damage_relations ?? {};
        return [{
            id: data.id,
            name: data.name,
            generation: data.generation?.name ?? '',
            doubleDamageFrom: names(damage.double_damage_from),
            doubleDamageTo: names(damage.double_damage_to),
            halfDamageFrom: names(damage.half_damage_from),
            halfDamageTo: names(damage.half_damage_to),
            noDamageFrom: names(damage.no_damage_from),
            noDamageTo: names(damage.no_damage_to),
            pokemonCount: Array.isArray(data.pokemon) ? data.pokemon.length : 0,
            moveCount: Array.isArray(data.moves) ? data.moves.length : 0,
            url: `${data.id ? `https://pokeapi.co/api/v2/type/${data.id}/` : ''}`,
        }];
    },
});
