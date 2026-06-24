# Description Design Patterns

The `description` field in the `SKILL.md` frontmatter is always loaded into context and is the only signal Claude uses to select a skill. Write it as a **routing contract**, not as ordinary explanatory prose.

## Checklist

* [ ] The first sentence states what the skill does.
* [ ] Multiple trigger utterance examples are included, with searchable trigger terms placed early.
* [ ] Non-use cases are explicit.
* [ ] Boundaries with neighboring skills are clear.
* [ ] Empty superlatives such as "best", "ultimate", or "perfect" are absent.
* [ ] The main trigger conditions are not interrupted mid-sentence.

## Good Example

```yaml
description: "Use this skill when the user says things like 'decide what to do today', 'what should I do today', 'what should I do next', 'how should I use the time left today', or 'build a schedule', and wants to decide how to use the remaining time in the current day through dialogue. It does not merely list tasks; it also decides order and time allocation based on fatigue, mood, and the user's immediately preceding activity. Also use this skill in task organization or planning contexts when the request includes the nuance of 'today', 'remaining time', or 'what to do next'."
```

Why it is good: concrete trigger utterances appear at the beginning. The skill's action is clear: it decides time allocation, not only task lists. It also handles neighboring cases by specifying when task organization or planning requests should still route to this skill.

## Bad Examples and Fixes

### Bad Example 1: Too Broad

```yaml
description: "A skill that helps with coding."
```

Problem: this matches the "too broad, like helps with coding" failure mode in `2.2 Bad Trigger`. It can activate for almost any coding request, so it is useless for routing.

Fix direction: specify the target language, target task type such as implementation, review, or debugging, and output format.

### Bad Example 2: Filled with Superlatives

```yaml
description: "A powerful data analysis skill that delivers the best performance. It handles every kind of data."
```

Problem: "powerful", "best", and "every kind" do not help selection. There are no concrete trigger conditions.

Fix direction: state supported file formats, typical request examples, and unsupported cases.

### Bad Example 3: Missing Non-Use Cases

```yaml
description: "A skill for handling PDF files. Supports reading, merging, splitting, watermarking, and form filling."
```

Problem: it states what the skill does, but it does not define boundaries with adjacent tasks, such as merely summarizing PDF content or converting a PDF to Word.

Fix direction: state exclusions explicitly, such as: "Use this skill for PDF creation, editing, merging, and splitting. Do not use it for prose editing or Word conversion; use the corresponding document skill instead."

## Difference Between "Pushy" and "Exaggerated"

Writing concrete, forceful trigger conditions is recommended. For example, this is good: "Always use this skill when the user mentions data visualization or displaying internal metrics, even if they do not explicitly say 'dashboard'."

Adding empty adjectives such as "best" or "ultimate" is exaggeration and is forbidden. The difference is whether the wording provides a concrete condition that helps the router decide when to activate the skill.
