# Kits in plain words

Invented sample data at the browser fixture's fixed clock. Only the Kits chapter and its open sheet are captured.

| Viewport | Chapter | Open sheet |
|---|---|---|
| Phone | [390 px](kits-390.png) | [390 px](kits-sheet-390.png) |
| Desktop | [1280 px](kits-1280.png) | [1280 px](kits-sheet-1280.png) |

After `npm run build`, run `PULSE_SCREENSHOT_DIR=/tmp/kits-screenshots npm run test:browser` with the usual disposable test database. Copy these four files from the output directory. The sheet image uses the same fixed invented clock as the chapter, after the real route assertions and before the original tested sheet is restored.
