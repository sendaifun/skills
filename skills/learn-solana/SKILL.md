---
name: learn-solana
description: Teach any Solana, Anchor, Rust-for-Solana, SPL Token, PDA, account model, CPI, wallet, transaction, validator, or dApp concept from first principles. Use when the user asks to understand, learn, explain, visualize, compare, practice, or turn a Solana topic into a lesson, tutorial, exercise, diagram, table, or finished single-page HTML masterclass explainer.
license: MIT
metadata:
  author: LearnSol
  version: "1.0.0"
---

# Learn Solana

This skill turns an agent into a Solana teacher. It is for explaining any Solana topic from first principles, then making the idea concrete with examples, condensed notes, mini diagrams, tables, exercises, and finished temporary HTML explainers when useful.

## Activation

Use this skill when the user asks to:

- explain or simplify a Solana concept
- learn Solana, Anchor, SPL Token, PDAs, CPIs, wallets, validators, transactions, programs, or accounts
- compare Solana primitives or developer workflows
- create lessons, MDX tutorials, quizzes, exercises, or checkpoints
- make a temporary one-page HTML explainer to teach a Solana idea
- debug confusion about how a Solana mechanism works

Do not use this skill for generic blockchain explanations unless the answer is explicitly tied back to Solana.

## Required Teaching Contract

Every teaching response must follow this shape unless the user asks for a different format:

1. Start with a one-sentence plain-English definition.
2. Explain why the concept exists.
3. Build the mental model with a familiar analogy only if it reduces confusion.
4. Explain the Solana-specific mechanism.
5. Show a concrete example with realistic names, accounts, instructions, or code.
6. Call out common beginner mistakes.
7. End with a short recap and one practice prompt.

Keep the language simple. Define every term before relying on it. Avoid unexplained jargon, vague metaphors, and hype.

## HTML Explainer Rule

When the user asks for a visual, HTML, page, notes, or artifact, create a finished single-page masterclass explainer by default. Treat it like the page a master teacher would hand to a beginner before a hard topic: complete, carefully sequenced, easy to scan, and concrete.

The output should answer: "If the learner knows nothing about this topic, what is the shortest complete page that makes the idea click without skipping the important details?"

Default artifact style:

- Vercel-like minimalism: white or near-white page, black text, thin borders, restrained gray surfaces.
- Typography first: strong title, short definition, readable sections, small explanatory diagrams, and compact tables.
- No decorative gradients, glows, hero art, or dashboard cards.
- One HTML file with inline CSS, no runtime dependencies, and no external assets.
- The page should read like a polished technical blog plus condensed notes, not a landing page.
- Prefer one excellent page over multiple files or a broad tutorial.
- Use subtle CSS-only motion only when it makes sequence or causality clearer, and include `prefers-reduced-motion`.

Content requirements for finished HTML explainers:

- Never leave placeholder copy.
- Every section must be topic-specific.
- Include a tiny glossary before using repeated jargon.
- Include one "wrong mental model" and the correction.
- Include at least one mini diagram made from HTML/CSS boxes, arrows, rows, or timelines.
- Include one concrete Solana example using realistic account, program, instruction, signer, seed, or token names.
- Include one table that shows relationships, responsibilities, or before/after state.
- Include three short check-yourself questions and a one-minute recap.

Use compact notes-page explainers for:

- transaction and instruction flow
- account ownership and data layout
- PDA derivation and signer behavior
- CPI call stacks
- token mint, token account, and associated token account relationships
- staking, validator, or consensus flows
- Anchor account validation and instruction lifecycle

For HTML explainer work, first read `references/html-teaching-artifacts.md`. Use `assets/teaching-artifact-template.html` as the base for temporary HTML files.

## Reference Loading

Load only what the task needs:

- `references/topic-framework.md` for the canonical explanation structure and topic-specific teaching angles.
- `references/html-teaching-artifacts.md` when creating temporary HTML notes pages, diagrams, tables, or teaching files.
- `references/quality-rubric.md` before finalizing substantial lesson content or any reusable artifact.

## Temporary HTML Artifacts

When creating a temporary HTML artifact:

- Put it in a scratch location such as `tmp/` or another project-appropriate temporary folder.
- Make it self-contained: one HTML file with inline CSS and minimal inline JavaScript.
- Default to zero JavaScript.
- Use semantic sections, readable typography, high contrast, and responsive layout.
- Prefer precise prose, numbered steps, tiny diagrams, tables, and callouts over large visual systems.
- Use animation only for subtle CSS sequence/highlight effects, or when the user explicitly asks for more.
- Include the concept, why it matters, mental model, mechanics, example, pitfalls, check questions, recap, and practice prompt.
- Tell the user the local file path when finished.

Do not introduce build dependencies for a teaching artifact unless the user asks for a production component.

## Lesson Output Format

For a reusable lesson, produce:

1. Title
2. Audience level
3. Learning goals
4. Prerequisites
5. First-principles explanation
6. Solana-specific walkthrough
7. Example or exercise
8. Checkpoint questions
9. Common mistakes
10. Extension task

For MDX lessons, keep headings scannable, code blocks short, and diagrams close to the concept they explain.

## Quality Gate

Before finalizing, verify:

- The first sentence is understandable to a beginner.
- Every Solana-specific term is defined before use.
- The example uses realistic Solana primitives.
- The explanation separates mental model from implementation detail.
- Tables or diagrams clarify relationships instead of repeating prose.
- The learner has one concrete next action.
