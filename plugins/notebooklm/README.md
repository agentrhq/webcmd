# webcmd-plugin-notebooklm

Webcmd commands for notebooklm.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/notebooklm
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd notebooklm add-source` | Add a URL, text, or local file source to an existing NotebookLM notebook |
| `webcmd notebooklm create` | Create a new NotebookLM notebook with the given title |
| `webcmd notebooklm current` | Show metadata for the currently opened NotebookLM notebook tab |
| `webcmd notebooklm generate-audio` | Trigger an Audio Overview (Deep Dive podcast) generation for a NotebookLM notebook, using all of its sources |
| `webcmd notebooklm generate-slides` | Trigger a Slide Deck (AI presentation) generation for a NotebookLM notebook, using all of its sources |
| `webcmd notebooklm get` | Get rich metadata for the currently opened NotebookLM notebook |
| `webcmd notebooklm history` | List NotebookLM conversation history threads in the current notebook |
| `webcmd notebooklm list` | List NotebookLM notebooks via in-page batchexecute RPC in the current logged-in session |
| `webcmd notebooklm login` | Open notebooklm login |
| `webcmd notebooklm note-list` | List saved notes from the Studio panel of the current NotebookLM notebook |
| `webcmd notebooklm notes-get` | Get one note from the current NotebookLM notebook by title from the visible note editor |
| `webcmd notebooklm open` | Open one NotebookLM notebook in the adapter session by id or URL |
| `webcmd notebooklm source-fulltext` | Get the extracted fulltext for one source in the currently opened NotebookLM notebook |
| `webcmd notebooklm source-get` | Get one source from the currently opened NotebookLM notebook by id or title |
| `webcmd notebooklm source-guide` | Get the guide summary and keywords for one source in the currently opened NotebookLM notebook |
| `webcmd notebooklm source-list` | List sources for the currently opened NotebookLM notebook |
| `webcmd notebooklm status` | Check NotebookLM page availability and login state in the current Chrome session |
| `webcmd notebooklm summary` | Get the summary block from the currently opened NotebookLM notebook |
| `webcmd notebooklm whoami` | Show the current logged-in notebooklm account |
| `webcmd notebooklm write-note` | Create a Studio note in an existing NotebookLM notebook with the given title and Markdown content |
