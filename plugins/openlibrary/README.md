# Open Library Webcmd plugin

Anonymous, read-only access to Open Library's public catalog APIs.

## Commands

```sh
webcmd openlibrary search "the lord of the rings" --limit 5
webcmd openlibrary subject science_fiction --limit 5
webcmd openlibrary work OL45883W
```

- `search` searches by title, author, ISBN, or keywords.
- `subject` browses works under an Open Library subject slug and supports `--offset` pagination.
- `work` returns the catalog record for an Open Library work ID.
