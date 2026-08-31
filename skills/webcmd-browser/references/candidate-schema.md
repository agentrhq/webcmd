# Candidate schema

Record only a qualifying observation. Do not capture trivial page loads, no-op clicks, or restated memory.

```bash
webcmd site memory candidate add <product> \
  --kind <kind> --claim <claim> --evidence <evidence> --consequence <consequence> -f json
```

Kinds: `action_space`, `better_path`, `access`, `high_consequence`, `repeated_mistake`.

| field | rule |
| --- | --- |
| `--kind` | One of the five kinds. |
| `--claim` | Short reusable claim. |
| `--evidence` | Bounded secret-free evidence from this task. |
| `--consequence` | Why a later agent should care. |
| `--hostname` | Only when it differs from the product key. |

`high_consequence` is an immediate warning: capture it as soon as the danger is observed. Other kinds wait for a real consequence, not a successful no-op.

Never record passwords, cookies, tokens, or secret-bearing fields. Inspect with `candidate search`, `show`, and `list`; do not dump environment from search or list.

```bash
webcmd site memory candidate search <product> --query "<tokens>" -f json
webcmd site memory candidate show <product> <id> -f json
webcmd site memory candidate list <product> -f json
```
