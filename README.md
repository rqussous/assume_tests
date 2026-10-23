# Unit Headroom Tracker

A small browser tool for energy system modellers working with **ASSUME** and **flexABLE**. It shows hour by hour how much capacity a unit has left as its bids clear across sequential markets, using ASSUME's own formulas.

It replaces drawing these capacity diagrams by hand.

**Live tool:** `https://<your-user>.github.io/<repo-name>/`

## What it does

The main page shows, hour by hour, how much capacity an ASSUME **PowerPlant** or **Storage** has left as its market orders are accepted. It uses the same chart as the hand-drawn slides: one column per hour with the sold energy, the reserves, the free headroom, the ramp window from the previous hour, and a bracket for what ASSUME would still let the unit offer.

- **Unit parameters** use the ASSUME constructor names.
- **Hours:** choose how many with the stepper.
- **Markets** clear in row order with `product_type` `energy`, `capacity_pos` or `capacity_neg`.
- **Orders:** type an accepted volume, or `max` for what the flexable strategies would bid. Click ✓ to mark an order as not accepted.
- **Hour detail:** ASSUME's return values before each market (`calculate_min_max_power`, `calculate_ramp`, `calculate_min_max_charge/discharge`, `calculate_ramp_charge/discharge`), with the formulas filled in.
- **execute_current_dispatch** can run after every hour. Corrected outputs appear as red dashed lines.

### Examples from the ASSUME test suite

The example menu reproduces the capacity-related tests in `tests/test_storage.py`, `tests/test_powerplant.py`, `tests/test_flexable_strategies.py` and `tests/test_flexable_storage_strategies.py`. Each example lists the test's asserts and marks them ✓ or ✗ against the tool's result, so you can change a value and see which asserts break.

Open an example directly with `?example=<id>`, e.g. `?example=storage-window` or `?example=plant-ramping`. The ids are in `assets/examples.js`.

To add an example, append an entry to `assets/examples.js` (the format is described at the top of the file) and run:

```bash
node tools/check-examples.js
```

It runs every example through `assets/model.js` and fails if an assert does not match.

### Test code beside the chart

The **Test code** column (toggle it with the button above the chart) shows the loaded example's ASSUME test, fetched from GitHub at the pinned commit. Hover a marked line to see what it reads or changes in the chart: the band an `outputs[...]` write adds, the window a `calculate_min_max_*` or `calculate_ramp*` call returns, the SOC, `op_time` or `execute_current_dispatch`. Click the line to open that hour. ✓ and ✗ next to each assert compare it with what the tool computes now. For examples whose test starts at a later datetime, `hour0` in `assets/examples.js` says which test hour is hour 0 here.

**Your test** writes a pytest test from the current scenario: the unit with its parameters, the orders hour by hour, and asserts on the windows before each market and after all orders, and optionally on ramp limits, `op_time`, SOC and `execute_current_dispatch`. Copy it or download it as a `.py` file into ASSUME's `tests/` folder and run it with `pytest`. The code is written by `assets/testcode.js`.

The formulas follow ASSUME commit `c325fdd`. Heat demand (CHP) and partial-load efficiency are not modelled.

### Keeping up with ASSUME

The tool compares the pinned commit (`PINNED` in `assets/upstream.js`) with ASSUME `main`. It splits the tracked test files and the ported unit and strategy files into Python functions, and lists every test, fixture or ported function that was changed, added or removed.

- **On the page:** the footer shows whether ASSUME `main` has moved. If tracked code changed, a panel lists it, with links to the new code and to the matching example. The result is cached for 6 hours per browser.
- **On GitHub:** `.github/workflows/assume-upstream.yml` runs every Monday, on every push to `main`, and by hand from the Actions tab. It runs `node tools/check-examples.js`, then `node tools/check-upstream.js`, and opens or updates one issue when ASSUME has changed.

The tool only reports changes. It does not port them: turning a changed Python test into an example needs someone to read it. To bring the tool up to date, port the changed functions into `assets/model.js`, update the examples, run `node tools/check-examples.js`, and set `PINNED` to the new commit.

`planner.html` is a generic planner for several markets with reserve durations, not tied to ASSUME.

## Run locally

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Publish on GitHub Pages

1. Create a repository on GitHub and push this folder to it:
   ```bash
   git init
   git add index.html planner.html assets tools .github README.md .nojekyll .gitignore
   git commit -m "Unit Headroom Tracker"
   git branch -M main
   git remote add origin https://github.com/<your-user>/<repo-name>.git
   git push -u origin main
   ```
2. On GitHub, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, and choose `main` with folder `/ (root)`.
3. After a minute the tool is live at `https://<your-user>.github.io/<repo-name>/`.
4. The weekly ASSUME check needs nothing else: GitHub Actions is on by default, and the workflow uses the built-in `GITHUB_TOKEN`. On a fork, enable Actions in the **Actions** tab first.

## Files

```
index.html                ASSUME view
assets/model.js           ASSUME unit arithmetic (pure JS, also runs in Node)
assets/examples.js        examples from the ASSUME tests
assets/upstream.js        compares the pinned ASSUME commit with main (also runs in Node)
assets/testcode.js        links test code lines to the chart and writes pytest tests (also runs in Node)
assets/assume.js, .css    ASSUME view rendering
assets/style.css          shared styles
tools/check-examples.js   checks every example against its test asserts
tools/check-upstream.js   reports ASSUME changes as Markdown (used by the workflow)
.github/workflows/        weekly check that opens an issue when ASSUME changes
planner.html, assets/app.js   generic multi-market planner
```
