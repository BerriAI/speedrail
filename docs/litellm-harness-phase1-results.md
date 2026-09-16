# LiteLLM harness phase-1 results

**This campaign does not establish that DeepSeek with this harness is better than Astra with Codex. Four original DeepSeek trials accessed the live checkout outside their historical snapshots, compromising the comparison.** The tables retain raw completed patches that pass every selected reference check, including affected trials; these counts are not an uncontaminated quality score. Some reference checks also impose private implementation details.

The last version in this historical phase is **v13**. Later versions are evaluated separately in the [current campaign report](litellm-harness-results.md). Version 9 received the original 42-run comparison; v11 received a separately frozen seven-run follow-up. A later code review found that mixed team/router queries searched only proxy symbols. V13 fixes that search-area selection, recognizes area names inside Python symbols, and interleaves areas so a large proxy tree cannot consume the scan limit before router code is reached; it has focused regression tests, training replays and a separate seven-run evaluation on these already-known tasks. That final evaluation is post-hoc, not fresh held-out evidence. Do not pool the three harness versions. All three harness versions use the actual Litespeed runner and `fireworks_ai/deepseek-v4p1-flash`. The baseline is the installed Codex CLI with `gpt-6-astra`. Both routes request High reasoning and receive 900 seconds. DeepSeek uses its verified 1,048,576-token context window.

See the [protocol](../scripts/litellm-harness/README.md), [original plan](../scripts/litellm-harness/comparison-plan.json), [follow-up plan](../scripts/litellm-harness/replication-plan.json), [final known-task evaluation](../scripts/litellm-harness/final-evaluation-plan.json), and [all measurements and task revisions](litellm-harness-phase1-results.json).

## Aggregate results

| Route | Raw completed + all checks pass | Out-of-snapshot access | Median seconds | Timeouts | Known DeepSeek token subtotal |
|---|---:|---:|---:|---:|---:|
| Codex / Astra | 9/21 | 0 | 283.7 | 0 | Unavailable |
| LiteLLM v9 / DeepSeek | 8/21 | 4 | 618.4 | 8 | $2.8544 |
| LiteLLM v11 / DeepSeek | 3/7 | 0 | 751.9 | 3 | $1.0147 |
| LiteLLM v13 / DeepSeek (post-hoc) | 3/7 | 0 | 486.2 | 0 | $1.0742 |

Repeated trials of the same task are correlated. Seven curated tasks cannot establish broad superiority. The v11 and v13 evaluations each have one trial per task; do not pool versions or treat their smaller denominators as stronger evidence. V13 was evaluated after prior task outcomes were inspected. Latency is observational because independent tasks ran concurrently on one host.

## Per-task raw completion and acceptance

| Task | Astra | v9 | v11 | v13 post-hoc |
|---|---:|---:|---:|---:|
| openai-schema-patterns | 3/3 | 2/3 | 1/1 | 1/1 |
| databricks-unity | 3/3 | 3/3 | 1/1 | 1/1 |
| mai-image-params | 0/3 | 0/3 | 0/1 | 0/1 |
| bedrock-thinking | 3/3 | 3/3 | 1/1 | 1/1 |
| router-retry-deployment | 0/3 | 0/3 | 0/1 | 0/1 |
| router-request-tags | 0/3 | 0/3 | 0/1 | 0/1 |
| team-router-names | 0/3 | 0/3 | 0/1 | 0/1 |

## Evaluation integrity

The final trace audit found actual live-checkout reads in four v9 trials and one plain-model development run. In particular, one Bedrock run read newer implementation and tests. Passing results from these trials cannot support a fair comparison. All planned trials remain in the tables, visibly marked; no replacement runs were selected to improve the score.

The [review](../scripts/litellm-harness/integrity-review.json) records each affected run. The [audit script](../scripts/litellm-harness/audit.py) flags commands for human inspection; it is a heuristic, not a security boundary. No flags does not prove isolation. Future controlled studies must expose only the task snapshot and installed dependencies to the solver, with the live repository and reference artifacts inaccessible. Offline prose alone did not achieve that here.

## What the reference checks miss or overconstrain

- **MAI image parameters:** several reference checks prescribe an exception subclass and exact prose, whereas the task asks for HTTP 400. The separate post-hoc probe below checks the stated status-code contract. It does not replace the frozen scores.
- **Router request tags:** one of two checks imports `ROUTING_REQUEST_TAGS_METADATA_KEY`, a constant introduced by the human patch. An implementation can preserve caller tags using a different private representation. The other check exercises actual retry selection and logging metadata.
- **Team router names:** several checks call private helpers using newly introduced argument names. Other failures exercise real compression ordering or tagged deployment selection. A raw failing row does not identify which kind occurred.
- **Router retry deployment:** missed async adapter and batch entrypoints are real behavior gaps, not merely naming or diagnostic differences.

Base/reference qualification catches broken environments but does not make a reference test implementation-neutral. These additional issues were identified after candidate freeze and after opening the comparison results. They were not fed back into the frozen candidate.

### Separate MAI HTTP-status probe

The [probe](../scripts/litellm-harness/probes/mai_http_errors.py) checks 15 invalid size/count inputs for HTTP 400, without requiring an exception subclass or phrase. It fails on the base and passes on the human reference. This is a post-hoc diagnostic, not a replacement benchmark.

| Snapshot/run | HTTP checks passed |
|---|---:|
| base | 0/15 |
| reference | 15/15 |
| comparison-r1-mai-image-params-4192401a | 15/15 |
| comparison-r1-mai-image-params-5481946a | 15/15 |
| comparison-r2-mai-image-params-843265b0 | 15/15 |
| comparison-r2-mai-image-params-9edc4f9c | 15/15 |
| comparison-r3-mai-image-params-192069fa | 15/15 |
| comparison-r3-mai-image-params-2d604acf | 15/15 |
| replication-v11-r1-mai-image-params-454d3b5a | 15/15 |
| replication-v13-r1-mai-image-params-c47ff708 | 15/15 |

## Every comparison run

A completed run must finish normally before the limit. A timeout can leave a passing partial patch; it still does not count as a completed success. All planned trials are retained.

| Task | Route | Trial | Reference checks | Seconds | Completed | Integrity issue |
|---|---|---|---:|---:|---|---|
| bedrock-thinking | Codex / Astra | comparison-r1 | 22/22 | 266.7 | True | — |
| databricks-unity | Codex / Astra | comparison-r1 | 5/5 | 183.6 | True | — |
| mai-image-params | Codex / Astra | comparison-r1 | 23/38 | 244.9 | True | — |
| openai-schema-patterns | Codex / Astra | comparison-r1 | 11/11 | 356.7 | True | — |
| router-request-tags | Codex / Astra | comparison-r1 | 1/2 | 231.1 | True | — |
| router-retry-deployment | Codex / Astra | comparison-r1 | 8/11 | 342.4 | True | — |
| team-router-names | Codex / Astra | comparison-r1 | 10/23 | 438.1 | True | — |
| bedrock-thinking | Codex / Astra | comparison-r2 | 22/22 | 293.0 | True | — |
| databricks-unity | Codex / Astra | comparison-r2 | 5/5 | 130.5 | True | — |
| mai-image-params | Codex / Astra | comparison-r2 | 24/38 | 221.0 | True | — |
| openai-schema-patterns | Codex / Astra | comparison-r2 | 11/11 | 427.1 | True | — |
| router-request-tags | Codex / Astra | comparison-r2 | 1/2 | 242.5 | True | — |
| router-retry-deployment | Codex / Astra | comparison-r2 | 8/11 | 362.4 | True | — |
| team-router-names | Codex / Astra | comparison-r2 | 10/23 | 622.0 | True | — |
| bedrock-thinking | Codex / Astra | comparison-r3 | 22/22 | 283.7 | True | — |
| databricks-unity | Codex / Astra | comparison-r3 | 5/5 | 172.2 | True | — |
| mai-image-params | Codex / Astra | comparison-r3 | 23/38 | 219.8 | True | — |
| openai-schema-patterns | Codex / Astra | comparison-r3 | 11/11 | 417.0 | True | — |
| router-request-tags | Codex / Astra | comparison-r3 | 1/2 | 281.7 | True | — |
| router-retry-deployment | Codex / Astra | comparison-r3 | 8/11 | 349.9 | True | — |
| team-router-names | Codex / Astra | comparison-r3 | 10/23 | 542.1 | True | — |
| bedrock-thinking | LiteLLM v9 / DeepSeek | comparison-r1 | 22/22 | 430.8 | True | — |
| databricks-unity | LiteLLM v9 / DeepSeek | comparison-r1 | 5/5 | 307.9 | True | Out-of-snapshot access |
| mai-image-params | LiteLLM v9 / DeepSeek | comparison-r1 | 23/38 | 405.9 | True | — |
| openai-schema-patterns | LiteLLM v9 / DeepSeek | comparison-r1 | 11/11 | 618.4 | True | — |
| router-request-tags | LiteLLM v9 / DeepSeek | comparison-r1 | 1/2 | 908.8 | False | Out-of-snapshot access |
| router-retry-deployment | LiteLLM v9 / DeepSeek | comparison-r1 | 9/11 | 900.2 | False | — |
| team-router-names | LiteLLM v9 / DeepSeek | comparison-r1 | 10/23 | 901.9 | False | — |
| bedrock-thinking | LiteLLM v9 / DeepSeek | comparison-r2 | 22/22 | 364.5 | True | — |
| databricks-unity | LiteLLM v9 / DeepSeek | comparison-r2 | 5/5 | 423.8 | True | — |
| mai-image-params | LiteLLM v9 / DeepSeek | comparison-r2 | 23/38 | 479.4 | True | — |
| openai-schema-patterns | LiteLLM v9 / DeepSeek | comparison-r2 | 11/11 | 614.7 | True | — |
| router-request-tags | LiteLLM v9 / DeepSeek | comparison-r2 | 1/2 | 630.6 | True | — |
| router-retry-deployment | LiteLLM v9 / DeepSeek | comparison-r2 | 8/11 | 912.5 | False | Out-of-snapshot access |
| team-router-names | LiteLLM v9 / DeepSeek | comparison-r2 | 11/23 | 900.8 | False | — |
| bedrock-thinking | LiteLLM v9 / DeepSeek | comparison-r3 | 22/22 | 524.6 | True | Out-of-snapshot access |
| databricks-unity | LiteLLM v9 / DeepSeek | comparison-r3 | 5/5 | 220.7 | True | — |
| mai-image-params | LiteLLM v9 / DeepSeek | comparison-r3 | 23/38 | 496.0 | True | — |
| openai-schema-patterns | LiteLLM v9 / DeepSeek | comparison-r3 | 11/11 | 900.2 | False | — |
| router-request-tags | LiteLLM v9 / DeepSeek | comparison-r3 | 1/2 | 792.4 | True | — |
| router-retry-deployment | LiteLLM v9 / DeepSeek | comparison-r3 | 8/11 | 900.2 | False | — |
| team-router-names | LiteLLM v9 / DeepSeek | comparison-r3 | 9/23 | 911.3 | False | — |
| bedrock-thinking | LiteLLM v11 / DeepSeek | replication-v11-r1 | 22/22 | 371.7 | True | — |
| databricks-unity | LiteLLM v11 / DeepSeek | replication-v11-r1 | 5/5 | 465.2 | True | — |
| mai-image-params | LiteLLM v11 / DeepSeek | replication-v11-r1 | 28/38 | 469.0 | True | — |
| openai-schema-patterns | LiteLLM v11 / DeepSeek | replication-v11-r1 | 11/11 | 751.9 | True | — |
| router-request-tags | LiteLLM v11 / DeepSeek | replication-v11-r1 | 1/2 | 900.2 | False | — |
| router-retry-deployment | LiteLLM v11 / DeepSeek | replication-v11-r1 | 8/11 | 900.8 | False | — |
| team-router-names | LiteLLM v11 / DeepSeek | replication-v11-r1 | 11/23 | 900.2 | False | — |
| bedrock-thinking | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 22/22 | 279.2 | True | — |
| databricks-unity | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 5/5 | 342.7 | True | — |
| mai-image-params | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 22/38 | 363.5 | True | — |
| openai-schema-patterns | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 11/11 | 743.6 | True | — |
| router-request-tags | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 1/2 | 486.2 | False | — |
| router-retry-deployment | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 9/11 | 890.9 | True | — |
| team-router-names | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 12/23 | 831.8 | True | — |

## Development record

These exploratory runs informed changes and task corrections. Earlier runs used incomplete snapshots, a smaller context window or different task wording. They are retained for audit and must not be pooled as an architecture comparison.

| Run | Prompt / snapshot revision | Reference checks | Seconds | Completed | Integrity issue |
|---|---|---:|---:|---|---|
| astra-baseline-converse-config-5ed5df64 | 1 / 1 | 2/2 | 154.0 | True | — |
| astra-baseline-vertex-version-path-ed3df227 | 1 / 1 | 4/6 | 128.7 | True | — |
| baseline-v0-anthropic-image-guardrail-2442e95c | 1 / 1 | 4/5 | 112.4 | True | — |
| baseline-v0-converse-config-992be1d7 | 1 / 1 | 2/2 | 132.2 | True | — |
| baseline-v0-router-candidates-5cc98dd7 | 1 / 1 | 1/1 | 578.2 | True | — |
| baseline-v0-vertex-version-path-a2523db7 | 1 / 1 | 4/6 | 407.8 | True | — |
| boundaries-v2-anthropic-image-guardrail-7a92c084 | 1 / 1 | 4/5 | 161.9 | True | — |
| boundaries-v2-vertex-version-path-00ae47d1 | 1 / 1 | 4/6 | 340.8 | True | — |
| comparison-r1-bedrock-thinking-821089fc | 2 / 1 | Unscored | 245.4 | True | — |
| comparison-r1-databricks-unity-4d99a7d1 | 2 / 1 | Unscored | 128.2 | True | — |
| coverage-v5-empty-choices-ddb56df6 | 2 / 1 | 8/13 | 600.1 | False | — |
| coverage-v5-router-candidates-f640c3b5 | 2 / 1 | 1/1 | 266.4 | True | — |
| coverage-v5-team-member-budget-af2d87a9 | 2 / 1 | 3/5 | 600.1 | False | — |
| effort-low-v7-dashscope-rerank-52ae54aa | 3 / 2 | 3/10 | 382.1 | True | — |
| effort-low-v7-empty-choices-ea753560 | 3 / 2 | 5/13 | 600.2 | False | — |
| effort-low-v7-team-member-budget-5347a879 | 3 / 2 | 3/5 | 600.2 | False | — |
| effort-max-v7-router-strategy-isolation-d60f7aa5 | 3 / 2 | 0/9 | 600.1 | False | — |
| effort-max-v7-vertex-version-path-7d9a8bff | 3 / 2 | 6/6 | 600.1 | False | — |
| focus-v4-databricks-reasoning-7ccff845 | 2 / 1 | 6/6 | 285.8 | True | — |
| inline-max-v9-empty-choices-23c319a4 | 3 / 2 | 6/13 | 600.1 | False | — |
| inline-v9-converse-config-4945178e | 3 / 2 | 2/2 | 163.6 | True | — |
| inline-v9-team-member-budget-c769d326 | 3 / 2 | 2/5 | 600.1 | False | — |
| navigator-v1-converse-config-5526ab77 | 1 / 1 | 2/2 | 89.9 | True | — |
| navigator-v1-vertex-version-path-2458d6a0 | 1 / 1 | 4/6 | 382.1 | True | — |
| playbook-v10-empty-choices-3d7677bc | 3 / 2 | 8/13 | 403.2 | True | — |
| playbook-v10-team-member-budget-73bad876 | 3 / 2 | 3/5 | 600.2 | False | — |
| playbook-v11-dashscope-rerank-c7939f2d | 3 / 2 | 10/10 | 501.6 | True | — |
| playbook-v11-router-strategy-isolation-02b1dd6e | 3 / 2 | 0/9 | 630.1 | False | — |
| qualified-single-converse-config-38b0f2fd | 3 / 2 | 2/2 | 130.2 | True | — |
| qualified-single-dev-dashscope-rerank-4f2c29ec | 3 / 2 | 2/10 | 571.9 | True | Out-of-snapshot access |
| qualified-single-dev-team-member-budget-82c9fa47 | 3 / 2 | 2/5 | 604.1 | False | — |
| qualified-v7-converse-config-983781f7 | 3 / 2 | 2/2 | 126.5 | True | — |
| qualified-v7-empty-choices-73754528 | 3 / 2 | 6/13 | 549.6 | True | — |
| qualified-v7-router-candidates-a3ca0fdf | 3 / 2 | 0/1 | 327.6 | False | — |
| qualified-v7-team-member-budget-1ab3cc38 | 3 / 2 | 2/5 | 600.1 | False | — |
| replication-development-v11-team-member-budget-a053317b | 3 / 2 | 3/5 | 625.5 | True | — |
| review-v3-anthropic-tool-document-76ef2bf6 | 1 / 1 | 2/2 | 131.9 | True | — |
| review-v3-dashscope-rerank-cf0c8898 | 1 / 1 | 4/10 | 601.3 | False | — |
| review-v3-databricks-reasoning-76004611 | 1 / 1 | 3/6 | 210.0 | True | — |
| review-v3-empty-choices-6e78831d | 1 / 1 | 2/13 | 546.0 | True | — |
| review-v3-router-candidates-a5abf172 | 1 / 1 | 1/1 | 548.5 | True | — |
| review-v3-team-member-budget-9be2f1a2 | 1 / 1 | 2/5 | 604.3 | False | — |
| review-v3-vertex-version-path-3b455509 | 1 / 1 | 6/6 | 402.9 | True | — |
| symbols-v6-empty-choices-5d62a72e | 2 / 1 | 2/13 | 490.3 | True | — |
| symbols-v6-full-dashscope-rerank-818e9b29 | 2 / 1 | 4/10 | 570.7 | True | — |
| symbols-v6-team-member-budget-5e216ad9 | 2 / 1 | 2/5 | 600.1 | False | — |
| verification-v12-router-candidates-80d417ce | 3 / 2 | 1/1 | 282.7 | True | — |
| verification-v13-router-candidates-f45a483c | 3 / 2 | 1/1 | 158.6 | True | — |

## Where the work went

Tool and latency counters include all recorded trials, including flagged ones; they describe execution, not uncontaminated quality. DeepSeek repeatedly spent many rounds locating and reconsidering code before its first edit. The navigator is available but is not forced: shell searches remained common. Router tasks still missed alternate async/batch entrypoints and sometimes exhausted the time allowance. The improvements reduce particular navigation and verification failures; they do not establish that prompts repair the underlying reasoning gap.

| Harness | Median requests | Median first-edit round | Shell calls | Navigator calls | Exact repeated calls |
|---|---:|---:|---:|---:|---:|
| LiteLLM v9 / DeepSeek | 74 | 30 | 827 | 27 | 10 |
| LiteLLM v11 / DeepSeek | 79 | 32 | 319 | 7 | 6 |
| LiteLLM v13 / DeepSeek (post-hoc) | 62 | 24 | 260 | 5 | 2 |

## Trace counters

The JSON retains every recorded tool count and output-character total. `readCharacters` counts read_file, grep, glob and litellm_context output only; `bashOutputCharacters` covers command output, and `toolOutputCharacters` covers all tools. Exact repeated-call counts detect identical tool names and arguments, not semantically equivalent commands. Missing token usage remains unavailable, not zero.

## Campaign spending at export time

This ledger snapshot includes later work in the ongoing campaign. It is not a phase-1 subtotal; route-specific token subtotals appear above.

The local gateway admitted **10915 requests**. Usage/header-priced charges total **$17.9986**. The ledger commits **$47.2670**, including full conservative reservations for **116 unpriced requests**, against a **$100.00 ceiling**. Committed dollars are an upper accounting bound, not actual spend. Account-level billing was unavailable.

Known token charges split into **$9.8296 uncached input**, **$4.1903 cached input**, and **$3.9787 output**. 93.1% of reported input tokens were cached. These components exclude unknown usage.

DeepSeek run subtotals use known token usage and the verified gateway rates. Missing usage is not free. The campaign total also covers exploratory reviewer calls. Codex/Astra dollar charges are unavailable and separate from the DeepSeek ceiling; they are not zero.

## Scope and limitations

This is retrospective repository-specific replay, not a blind or chronological future-PR study. Requirements were curated from public changes; the curator inspected references to qualify tasks. Two tasks failed qualification and were excluded. Historical snapshots share a Python dependency environment rather than reproducing every historical CI setup. Solvers receive fresh source snapshots without the original Git history or reference patches. Separate scoring kept reference patches out of task workspaces, but offline instructions did not prevent live-checkout access. The shell was not isolated, and the integrity failures above invalidate an uncontaminated comparison claim.

Protocol 4 first introduced a macOS Seatbelt filesystem boundary that blocks the live source and other campaign/reference files while permitting the current run and trusted runtime/dependencies. Networking remains available for model APIs; this is not complete adversarial isolation. Real training smoke runs verify the launcher separately. The current workbench protocol is documented in the replay instructions. The v9/v11/v13 comparison series used protocol 3 and does not inherit later corrections.

Source hashes and task revisions are recorded. Production sessions do not automatically mutate the harness. The shipped guides were distilled from training/development cases, and the v11 follow-up was frozen before comparison outcomes were inspected. Neither a green model-written test nor a green focused reference selection proves the absence of other bugs.
