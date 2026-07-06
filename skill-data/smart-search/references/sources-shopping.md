# Shopping

Use for product search, prices, deals, reputation, and regional e-commerce results.

## Sites

### amazon

- Use for: global product search, price references, and English-language e-commerce
- Before use, run: `webcmd amazon -h`

### coupang

- Use for: Korean e-commerce product search
- Before use, run: `webcmd coupang -h`

## Routing Hints

- If the user names a platform, use that platform directly
- If no platform is named, prefer `amazon` for global products and `coupang` for Korean e-commerce
- If product research starts with an AI source, add an e-commerce site afterward for actual product results
