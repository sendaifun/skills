# HTML Teaching Artifacts

Use this reference when creating temporary HTML explainers.

## Artifact Goals

An HTML artifact should be a finished one-page masterclass explainer. It should feel like a polished Vercel-style technical article plus condensed teacher notes: calm typography, strong structure, white space, thin borders, tiny diagrams, and no visual noise.

The default output is not a diagram dashboard. It is a complete beginner-safe page for someone who does not know the topic at all.

Prioritize:

- one-sentence first-principles definition
- why the concept exists
- simple mental model
- wrong mental model and correction
- small glossary
- compact Solana-specific mechanics
- one realistic example
- mini HTML/CSS diagram
- tiny tables for relationships or before/after state
- common mistakes
- check-yourself questions
- one practice prompt

Avoid:

- decorative illustrations
- dashboard-style cards
- large visual systems when text would teach better
- complex frameworks
- dependency installation
- gradients, glows, shadows, bokeh, and stock decorative backgrounds
- animation unless the user explicitly asks for it
- placeholder copy
- generic blockchain filler that is not Solana-specific

## Required Structure

Use one self-contained HTML file:

- `<header>` for the concept name, learner promise, and one-sentence definition
- `<main>` for the notes content
- `<section>` blocks for problem, mental model, glossary, mechanics, diagram, example, mistakes, checks, and recap
- inline `<style>` for CSS
- no JavaScript unless the user explicitly asks for interactivity

## Required Page Sections

Use this sequence unless the user requests a different teaching format:

1. `Start here` - one plain-English definition and what the learner will understand by the end.
2. `Why it exists` - the problem this concept solves.
3. `Mental model` - a simple model, clearly marked as a simplification.
4. `Vocabulary` - tiny glossary of terms used later.
5. `How Solana does it` - concrete mechanics and vocabulary.
6. `Mini diagram` - small HTML/CSS diagram with labels.
7. `Concrete example` - realistic account/program/instruction example.
8. `Tiny table` - comparison, before/after state, or actor responsibility.
9. `Common mistakes` - short mistake/correction pairs.
10. `Check yourself` - three short questions.
11. `One-minute recap` - compressed summary and one exercise.

## Minimal Visual Patterns

Use these as compact teaching aids inside the notes page. Diagrams should clarify, not decorate.

### Relationship Table

Use for account ownership, token roles, authority, or CPI privileges.

Columns should usually be:

- thing
- what it means
- who controls it
- beginner translation

### Before/After Table

Use when state changes.

Columns should usually be:

- step
- account or actor
- what changed

### Recipe List

Use for PDA seeds, transaction construction, or Anchor validation.

Keep it as an ordered list or a two-column table. Avoid giant arrows unless the user asks.

### Mini Diagram

Use CSS boxes and arrows for the one diagram. Pick the pattern that matches the topic:

- PDA: seed chips -> program id -> bump -> derived address
- transaction: signer -> transaction -> instruction -> program -> account changes
- CPI: caller program -> invoked program -> returned result
- SPL Token: mint -> token account -> owner authority
- Anchor: account validation -> instruction logic -> state update

Rules:

- Keep it within one section.
- Use labels inside the diagram.
- Avoid canvas, SVG, and external images.
- Use subtle CSS-only motion only if it explains order.
- Respect `prefers-reduced-motion`.

## Style Rules

Use a restrained system:

- background: `#fff`
- text: near black
- muted text: neutral gray
- accent: one restrained blue or black
- borders: `1px solid #e5e7eb`
- radius: 12px or less
- no heavy shadows

Typography:

- system sans for prose
- system mono for code and addresses
- body text around 16px
- readable line-height
- max content width around 920px
- no huge hero typography

Content density:

- The page may be detailed, but every paragraph should earn its place.
- Prefer short paragraphs and structured lists.
- Use code snippets sparingly and explain every snippet.
- Do not exceed what a focused beginner can read in 8-10 minutes.

## File Naming

Use descriptive temporary names:

- `tmp/pda-explainer.html`
- `tmp/cpi-flow.html`
- `tmp/spl-token-accounts.html`
- `tmp/transaction-lifecycle.html`

## Completion Checklist

- The artifact opens directly in a browser.
- It has no external runtime dependencies.
- The main idea is understandable from the first screen.
- The page can teach someone who has never seen the topic.
- It is concise enough to scan quickly and complete enough to teach the essentials.
- It contains a concrete Solana example.
- It contains a mini diagram.
- It contains check-yourself questions.
- Tables clarify relationships instead of decorating the page.
- No placeholders remain.
- The file path is reported to the user.
