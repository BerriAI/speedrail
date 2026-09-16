# LiteLLM-specific harness

Choose **LiteLLM specific** in the model picker when working at the root of the LiteLLM repository. It uses your selected model with repository navigation, smaller source reads, focused-test reminders and a review after edits.

## Use it

1. Start Litespeed in your LiteLLM checkout. Open the model picker in the terminal or browser.
2. Choose **Architecture → LiteLLM specific**.
3. Select your gateway and **`fireworks_ai/deepseek-v4p1-flash`**. Choose the reasoning effort you want; comparison runs record it explicitly. Save.
4. Describe the change normally. The architecture also works in Plan mode for reading and explaining code.

The campaign used a verified 1,048,576-token context limit. To reproduce that setting, open **Settings → Providers → Context window overrides** and add the exact Flash model ID with `1048576` tokens after confirming your gateway exposes that capacity. The architecture otherwise uses normal Litespeed model discovery or its planning default; choosing the architecture does not change provider limits.

Your gateway credentials stay in the normal local provider configuration. Selecting the architecture preserves your model choice; it does not silently route requests to another provider. There is no specialist model to configure. Optional planner and Shunt models remain available through the existing settings; both were disabled in the campaign.

The equivalent session API selection is:

```json
{
  "providerId": "your-gateway-provider-id",
  "model": "fireworks_ai/deepseek-v4p1-flash",
  "architecture": {"kind": "litellm-specific"}
}
```

## What changes

**Start at useful locations.** When normal read permissions allow it, the host includes a bounded source-navigation note before the first model request. It uses the current task and checkout. Hooks, sidecars or scoped read restrictions keep this automatic step off so ordinary intercepted tools remain in control. The note is labeled untrusted source data and does not count as an edit or test.

**Find the relevant code and tests together.** The `litellm_context` tool searches function/class names and inline code in the relevant provider, proxy, router or shared-utility directories, ranks source paths, and suggests existing tests. Queries that mention multiple areas search all of them; for example, team/router queries search both proxy and router symbols. The scan interleaves those areas so a large directory cannot exhaust the budget before the others are visited. The output reports which areas were scanned. Inline results expose checks inside large functions whose names do not describe the behavior. This finds behavior inside generically named files as well as obvious filename matches. Symbol scans are bounded and report partial coverage. A source path returns a symbol outline; adding a query filters that outline, which helps with large files such as `router.py`. Adding an exact symbol name reads its definition with numbered lines and lists control-flow exits beyond a truncated excerpt. `path` plus `callers` finds syntactic uses of a helper and their enclosing functions. Router strategy queries also show return sites in the sync, async and passthrough routing entrypoints, including early returns. A path/query search includes inline matches even when the term is absent from function names. The tool indexes the current checkout and does not consult future Git commits, external PRs or an answer database.

**Read a useful slice first.** Unspecified `read_file` calls default to 160 lines in this architecture. Explicit ranges still work. Definitions are bounded at 240 lines and indicate when more remains. Navigation excludes generated dashboard output, hidden files, dependencies, external symlinks and binary or oversized files. Python outlines use syntax patterns, not a complete Python parser; duplicate definitions require an explicit line range.

**Recall relevant repair lessons.** A task query can return a short guide learned from development fixes: cached response boundaries, budget counter recovery, router resolution and request-local state, or DashScope rerank endpoints. Guides appear only for matching queries when a relevant source file exists in the checkout. They name likely bypass paths and concrete counterexamples, and explicitly require verification against the current code. They contain no future test patches and do not treat a previous fix as proof of today's bug.

**Use LiteLLM's structure.** Versioned instructions describe provider transformations, shared response/streaming utilities, router, proxy, enterprise code, types, mirrored tests and dashboard source. They direct the model to respect repository guidance, preserve caller inputs and check relevant sync/async and streaming counterparts.

**Turn exploration into action.** After 12 tool calls without a recorded edit, one reminder asks an implementation task to state its hypothesis and use a minimal regression or executable probe to distinguish it from alternatives. It also tells read-only tasks to finish their explanation when the evidence is sufficient. This does not grant permission to edit or prevent further necessary investigation.

**Stop wasting checks.** After four recorded check commands, one reminder asks the model to identify the remaining uncertainty. LiteLLM test files can mix mocked unit tests with live service tests. The reminder encourages precise selections and discourages repeatedly rerunning successful checks or toggling a patch to investigate unrelated flakiness. It does not block additional testing when needed.

**Review the actual change.** Before a Build turn with recorded edits finishes, the host requests one focused review. The model first audits the patch and existing checks against the requested behavior. It should finish when that evidence is sufficient, and investigate further only for a named gap or defect. Baseline experiments must keep the working patch intact; a separate copy avoids losing the fix on cancellation. The review highlights protocol representation, URL composition, caller-owned state and absent/null/false distinctions. It uses the same selected model and normal tools. It is a quality prompt, not an independent correctness oracle.

The review can add work and latency. It runs once per changed turn; it does not run for read-only explanations or Plan mode. Normal cancellation, permissions, receipts, history and Undo continue to apply. Successful symbol reads count as file-read evidence; an outline or missing symbol does not.

## Permissions and limits

The navigator is available only when the underlying read, glob and grep capabilities are available. Any ask/deny rule or explicitly matched hook on those tools disables the composite navigator, leaving ordinary tools to enforce the configured policy. Configured sidecars also use this fallback so that navigation cannot skip their interception. This intentionally conservative behavior prevents a repository-navigation shortcut from bypassing a scoped file restriction.

Opening another repository produces a navigation hint instead of fabricated LiteLLM results. This architecture is repository specialization, not model training or an operating-system sandbox. It does not automatically modify its own instructions in response to a user's session. Improvements are evaluated and versioned in the code.

## Evidence and improvement

The campaign runs historical LiteLLM tasks through the actual Litespeed runner, preserving messages, tool calls, patches, usage and timing. Flash produces replay patches and critique proposals. Codex inspects the evidence and implements/version-controls harness changes. This is repository specialization through code and prompts; it does not update model weights or silently rewrite the production harness after a user session.

**The campaign is still running. A quality win over Astra/Codex and production replacement readiness have not been established.** Failed trials, infrastructure changes and tests coupled to a particular reference implementation remain visible. Some early trials read outside their intended snapshots; later filesystem-isolated runs are reported separately.

Read the [current results](litellm-harness-results.md), [research guide](meta-harness-research.md) and [replay workbench instructions](../scripts/litellm-harness/README.md) for the evidence and limitations. The workbench runs the installed Codex CLI with the actual `gpt-6-astra` model for comparisons; its account billing is unavailable and is not counted as zero.

Guide provenance is reviewable in these public training/development fixes: [empty responses](https://github.com/BerriAI/litellm/commit/b7dad8b44e30e87e6ae174ea6f58054e17cfc8a5), [budget recovery](https://github.com/BerriAI/litellm/commit/d963e9fa6e770e359bdf17bbf2c47c729667e1b6), [candidate resolution](https://github.com/BerriAI/litellm/commit/2000642592670baf38c46f4c6e3bcb851c59d79e), [request strategy isolation](https://github.com/BerriAI/litellm/commit/b0071f363f8dd55a3a252e61f51f088ac5bab73c), and [DashScope reranking](https://github.com/BerriAI/litellm/commit/e907e5ee9b562ab0160eab8cd6245eb4f40c9256). Guides are hypotheses to check against today's source, not known answers to reserved evaluation tasks.

For local UI verification, run `npm run test:tui:litellm` for the real terminal picker, persistence, Plan navigation and narrow layout. The browser equivalent is `npx playwright test tests/e2e/litellm-harness.spec.ts`.
