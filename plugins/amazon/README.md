# webcmd-plugin-amazon

Webcmd commands for amazon.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/amazon
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd amazon bestsellers` | Amazon Best Sellers pages for category candidate discovery |
| `webcmd amazon discussion` | Amazon review summary and sample customer discussion from product review pages |
| `webcmd amazon login` | Open amazon login |
| `webcmd amazon movers-shakers` | Amazon Movers & Shakers pages for short-term growth signals |
| `webcmd amazon new-releases` | Amazon New Releases pages for early momentum discovery |
| `webcmd amazon offer` | Amazon seller, buy box, and fulfillment facts from the product page |
| `webcmd amazon product` | Amazon product page facts for candidate validation |
| `webcmd amazon search` | Amazon search results for product discovery and coarse filtering |
| `webcmd amazon whoami` | Show the current logged-in amazon account |

## Notes

- A product or review URL from a sibling marketplace (`amazon.co.uk`, `amazon.de`, `amazon.com.au`, …) is read on that marketplace, and the emitted URLs stay on it. A bare ASIN still defaults to `amazon.com`.
