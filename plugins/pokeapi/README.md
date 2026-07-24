# webcmd-plugin-pokeapi

Read-only Pokémon data commands powered by the public, anonymous [PokéAPI](https://pokeapi.co/).

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/plugins/pokeapi
```

## Commands

| Command | Description |
|---------|-------------|
| `pokeapi pokemon <name-or-id>` | Get a Pokémon's core details, types, abilities, stats, and sprite |
| `pokeapi ability <name-or-id>` | Get an ability's English effect and Pokémon usage summary |
| `pokeapi type <name-or-id>` | Get a type's damage relationships and Pokémon count |

## Examples

```bash
webcmd pokeapi pokemon pikachu
webcmd pokeapi ability 9
webcmd pokeapi type fire
```

All commands use PokéAPI's unauthenticated read-only REST endpoints. Names are lowercase slugs such as `mr-mime`; numeric resource IDs are also accepted.
