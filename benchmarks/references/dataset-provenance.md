# Dataset Provenance

| File | Bytes | SHA-256 | Tasks |
|---|---:|---|---:|
| `BU_Bench_V1.json` | local editable source | computed at run time | 100 |
| `Stealth_Bench_V1.enc` | 192,048 | `d9a842e6cf924929b25b39d1d96b6aa9eb89e05fe942598dfda85bf468d7cfda` | 80 |

BU Bench loads from the ignored local `BU_Bench_V1.json`. It contains five 20-task sections: WebBenchREAD, Online Mind2Web 2, InteractionTests, GAIA public validation, and BrowseComp. GAIA and BrowseComp provide 40 explicit answers; the other 60 rely on semantic evidence judging. Set `"enabled": false` on a task to exclude it while preserving its `task_id` and raw array index; absent `enabled` means enabled. Keep all 100 array slots—do not delete or reorder them, because the official interleaving depends on five fixed 20-task sections.

The Stealth raw view contains 80 tasks. The official 71-task view excludes categories hCaptcha, GeeTest, and Temu Slider (task IDs 60–66 and 75), removes unprotected DeviantArt task 80, maps task IDs 76 and 78 to Akamai, task 77 to Cloudflare, task 79 to Others, and merges remaining Shape, Kasada, and Custom Antibot cases into Others.

WebBench, Mind2Web 2, and BrowseComp are identified upstream as MIT-licensed. GAIA has no explicit license; retain only the upstream public validation selection. Never commit or publish plaintext datasets, prompts, answers, transcripts, screenshots, or local results. Do not use the tasks for model training.
