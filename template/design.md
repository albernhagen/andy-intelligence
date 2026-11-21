# Design

How this project's user interface looks and behaves. Agents follow it on every ticket that changes a UI; when a ticket contradicts it, an interactive session asks and an unattended build records the conflict as a deviation. The project owner edits this file: the andy-intelligence baseline writes it once and never overwrites it.

Replace each default below with this project's choice, or delete the sections that don't apply.

## Layout

- One primary action per screen; secondary actions are quieter.
- Consistent spacing on a 4 px grid; content width capped for reading.
- Works from a 360 px phone screen up; no horizontal scrolling.

## Type

- One typeface family; at most four sizes and two weights.
- Body text at least 16 px; line height about 1.5.

## Colour

- A neutral base, one accent for actions and focus, and one colour each for success, warning and error.
- Colours are named tokens (for example CSS variables), never hard-coded per component.
- Light and dark themes both meet the contrast rule below.

## Components

- Reuse the project's existing components before adding one; a new one joins the shared set.
- Buttons, inputs, lists and dialogs look and behave the same everywhere.

## States

- Every screen that loads data has a loading, empty and error state, each with one plain sentence.
- Destructive actions ask for confirmation or can be undone.

## Accessibility

- WCAG 2.2 AA: text contrast at least 4.5:1, every control usable by keyboard, a visible focus ring.
- Every input has a label; every image that carries meaning has alternative text.
- Respect reduced-motion settings.

## Tone

- Plain, short, active sentences; name things the way users do.
- Errors say what happened and what to do next; no blame, no jargon.
