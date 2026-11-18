# Budget Simulator

An interactive dashboard of a country's public budget: revenue, spending and balance of the whole state, not only of the central government. You switch on a policy proposal from public debate, such as ending citizen's income for non-citizens, reintroducing the wealth tax or halving MPs' pay, and see at once what it does to the budget and what the catch is: legal limits, costs that move to another level of government, side effects. The site shows numbers and catches and takes no political side.

Germany is the first country. A preview is live at **[budget.drtheile.com](https://budget.drtheile.com)**.

![Budget Simulator with the German budget and four measures switched on: the balance, bars for revenue and spending, and a measure card showing a cost shift and two legal blockers](docs/screenshot.png)

*Germany with four measures switched on (English interface; the site follows the system's light or dark setting). At these settings the first measure relieves the federal government by €19.7bn, while €22.2bn of cost reappears at the states and municipalities.*

## What you can do with it

- Break the budget down from broad areas such as social protection or defence to single items, and see for each item its amount, its sources, its data quality and which level of government bears it.
- Switch measures on and off and move their settings: a tax rate, an allowance, the size of a cut.
- See for each measure what it does on its own, the range of the estimate, which levels of government it relieves or burdens, the catches with their severity, and the sources.
- Restrict the whole page to one level of government. For Germany these are the federal government, the states, the municipalities and social insurance.
- Copy a link that reproduces a scenario exactly.

## How it works

- **Country packs.** Everything that is specific to a country is data: budget figures, measures, catches, sources and all texts are JSON files in `countries/<id>/`. `countries/de/` is the German pack.
- **Engine.** `src/engine/` is a calculation engine in plain TypeScript, without React, DOM or network access, and it knows nothing about any particular country. It validates a pack, applies the measures that are switched on to the budget, and reports the change for every measure, budget item and level of government, with a low and a high estimate.
- **No server.** The app is a static site built with Vite, React and TypeScript. The packs are part of the build, and all calculation happens in the browser. The app makes no third-party requests (the fonts are bundled) and sets no cookies. The one thing it stores on your device is the interface language, and only if you choose one.
- **Shareable links.** The scenario (which measures are on, their settings, the level filter) and the language are kept in the fragment of the URL, for example `https://budget.drtheile.com/#lang=en&s=mp_pay_cut~wealth_tax.rate.15e-1`. The Share button copies that link. Browsers do not send the fragment to the server, so the host does not learn which scenario you look at.

## How to read the numbers

This describes the German pack. The app has its own version under "About the numbers", which includes the pack's full method note from `countries/de/country.json`.

- **Base year 2024.** It is the latest year for which Eurostat has published government expenditure by function (COFOG). All budget amounts are figures for that one year. The income distribution behind the income tax measure is older: it comes from the tax statistics for 2022.
- **The whole state, on a national-accounts basis.** Amounts come from national accounts for general government (federal government, states, municipalities, social insurance), with payments between these levels netted out: revenue of EUR 2,028.3 billion, spending of EUR 2,147.5 billion and a deficit of EUR 119.1 billion, as published in October 2026. They differ from budget plans, because the federal budget is only one part of the state and cash figures follow different definitions.
- **Named items are cash figures.** Individually named items such as citizen's income or MPs' pay are cash figures. The rest of their group is the difference to the national-accounts total of the group and is therefore only approximately right.
- **Levels of government.** Every item is split across the levels that ultimately bear it. Part of that split is published, part is estimated from who is responsible for a task; [pipeline/de/README.md](pipeline/de/README.md) lists what is data and what is judgement. Because payments between levels are netted out, the app shows no balance for a single level, only how far a measure relieves or burdens it.
- **Static estimates for the first year.** A measure's figure is its direct effect on the budget of one year, not a forecast over several years. The engine does arithmetic on the base-year amounts: scale an item, add to it, set it, exclude a group of recipients, or apply a tax schedule to an income or wealth distribution. It does not model the economy. Behavioural reactions appear only where the pack makes them explicit: as a setting (the wealth tax has one for revenue lost to avoidance), in the range, or as a catch.
- **Three quality labels.** Every budget item and every effect of a measure carries one:

  | Label | Meaning |
  | --- | --- |
  | `official` | Taken directly from official statistics. |
  | `derived` | Calculated from official figures. |
  | `estimate` | Based on assumptions, model calculations or studies. |

  Most German budget items are `derived`: the amount is official or computed from official figures, and its split across the levels of government is computed.
- **Ranges.** Where an effect is uncertain, the pack gives a low and a high multiplier, and the app shows the resulting range next to the central figure. The multipliers are the pack author's judgement, explained in the effect's note and sources. They are not statistical confidence intervals. The range of a scenario is the sum of the low values and the sum of the high values of its measures.
- **Sources.** Every budget item has to name at least one source, or the validator rejects the pack. In the German pack every effect and every catch names one as well. The app lists all sources with publisher, link and date of access; the file is `countries/de/sources.json`.
- **Combinations.** A measure's card shows what it does on its own. In a scenario the measures are applied one after the other in a fixed order, and where two act on the same item, the later one acts on what the earlier one left. Savings are therefore not counted twice, and a measure can have a different effect inside a combination than alone.

## Run it locally

You need Node.js 22.18 or newer and npm.

```sh
git clone https://github.com/andretheile/federal_budget_simulator.git
cd federal_budget_simulator
npm install
npm run dev
```

`npm run dev` starts the Vite dev server and prints the local address (`http://localhost:5173` unless that port is taken).

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript checks for the app, the engine and the scripts |
| `npm run validate` | Checks every country pack in `countries/` and prints its totals |
| `npm run build` | Type check, then production build into `dist/` |
| `npm run preview` | Serves the built `dist/` locally |

Python is only needed to rebuild the German budget data ([pipeline/de/README.md](pipeline/de/README.md)). Hosting is described in [deploy/README.md](deploy/README.md).

## Project layout

```text
countries/
  de/                      the German country pack
    country.json
    budget.json
    policies.json
    sources.json
    distributions/         taxable_income.json, net_wealth.json
src/
  engine/                  calculation engine, knows no country
    types.ts               the country pack format
    index.ts               public API
    schema.ts, validate.ts checks a pack
    simulate.ts            applies measures to the budget
    distribution.ts        tax schedules over income and wealth distributions
    scenario.ts            scenario to URL string and back
    __fixtures__/          Testland, a made-up country for the tests
  app/                     view models and URL state
  components/              React components
  i18n/                    interface texts (German, English) and number formatting
  hooks/, styles/
  packs.ts                 loads and validates the packs in countries/
  App.tsx, main.tsx
scripts/validate-packs.ts  behind "npm run validate"
pipeline/de/               Python scripts that rebuild the German budget data (own README)
deploy/                    static hosting files and a deploy script (own README)
docs/                      the screenshot above
```

`backend/`, `frontend/` and `verify_model.py` are an earlier FastAPI and Create React App prototype. Nothing uses them any more and they are due to be removed, so do not start there.

## Adding or changing a country

A country pack is a folder `countries/<id>/`, named after the country's lower-case ISO 3166-1 alpha-2 code. The build picks up every folder in `countries/`; nothing has to be registered in code. With more than one pack, the header shows a country switch.

| File | What it holds |
| --- | --- |
| `country.json` | Name, currency, languages, base year, the levels of government that exist and what they are called, reference values (GDP and population, optionally households and gross debt), and a method note that the app shows under "About the numbers" |
| `budget.json` | The budget as two trees, `revenue` and `expenditure` |
| `policies.json` | The measures, in the order in which they are applied |
| `sources.json` | Every source under an id: title, publisher, URL, date of access |
| `distributions/<id>.json` | Optional: distributions that tax measures are calculated from. The German pack has taxable income and net wealth |

The main concepts:

- **Budget tree.** A node is either a group with `children` or a leaf. Only leaves carry an `amount`, in plain currency units per year (euros, not millions); the total of a group is always the sum of its leaves. Node ids are dotted paths that start with `rev.` or `exp.`, such as `exp.social.basic_security.asylum_benefits`.
- **Levels of government.** A country declares which of four levels it has: `central`, `state`, `local` and `social_security`, the subsectors of general government in ESA 2010. Every leaf states which share of its amount each level bears, and the shares sum to 1.
- **Quality and sources.** Every leaf has a `quality` (`official`, `derived` or `estimate`) and at least one source id from `sources.json`.
- **Breakdowns and distributions.** A node can carry a breakdown of its amount into groups, which a measure can then exclude. In the German pack, citizen's income is broken down by the nationality of the recipients. A distribution describes how income or wealth is spread, as bins with an optional Pareto tail, so that a tax schedule can be applied to it.
- **Policies.** A measure has `params` (the settings a visitor can move), at least one effect, and `catches`. An effect names the budget node it changes and has a type: `scale`, `add`, `set`, `excludeGroups` (remove groups of a breakdown) or `schedule` (marginal tax rates over a distribution). It carries a quality label and, optionally, the low and high multipliers for the range. On a `scale` or `excludeGroups` effect, a `shift` lets part of what was removed reappear at another node; this is how a cost that moves to another level of government is expressed. A catch has a `kind` (`legal`, `economic`, `cost_shift`, `practical` or `political`), a `severity` (`blocker`, `major` or `minor`), a text and its sources.
- **Texts.** Every label and text is an object with one entry per language: `en` is required, plus every locale listed in `country.json`. The interface itself is translated in `src/i18n/`, so far into German and English; for any other locale it falls back to English.

A shortened measure from `countries/de/policies.json`:

```json
{
  "id": "asylum_benefits_cut",
  "label": { "de": "Asylbewerberleistungen kürzen", "en": "Cut asylum seekers' benefits" },
  "summary": {
    "de": "Senkt die Ausgaben nach dem Asylbewerberleistungsgesetz um den eingestellten Anteil.",
    "en": "Reduces spending under the Asylum Seekers' Benefits Act by the chosen share."
  },
  "topic": "migration",
  "params": [
    {
      "id": "cut",
      "type": "number",
      "label": { "de": "Kürzung", "en": "Cut" },
      "unit": "percent",
      "min": 0,
      "max": 50,
      "step": 5,
      "default": 20,
      "baseline": 0
    }
  ],
  "effects": [
    {
      "type": "scale",
      "target": "exp.social.basic_security.asylum_benefits",
      "factor": { "param": "cut", "scale": -0.01, "offset": 1 },
      "quality": "derived",
      "uncertainty": { "low": 0.5, "high": 1.0 },
      "sources": ["destatis_asylblg_ausgaben"],
      "note": {
        "de": "Kürzung mal Bruttoausgaben 2024 (6,72 Mrd. Euro). Die untere Grenze nimmt an, dass sich nur die Hälfte rechtlich und praktisch umsetzen lässt.",
        "en": "Cut times gross expenditure in 2024 (EUR 6.72 billion). The lower bound assumes that only half can be implemented legally and in practice."
      }
    }
  ],
  "catches": [
    {
      "kind": "legal",
      "severity": "blocker",
      "text": {
        "de": "Das Bundesverfassungsgericht hat 2012 die damaligen Geldleistungen für evident unzureichend erklärt: Die Leistungen müssen das Existenzminimum decken. Pauschale Kürzungen unter dieses Niveau sind unzulässig.",
        "en": "In 2012 the Federal Constitutional Court declared the cash benefits of the time evidently insufficient: benefits must cover the subsistence minimum. Across-the-board cuts below that level are not permitted."
      },
      "sources": ["bverfg_2012_asylblg"]
    }
  ],
  "sources": ["destatis_asylblg_ausgaben", "bverfg_2012_asylblg"]
}
```

A parameter reference evaluates to `value × scale + offset`. At the default cut of 20 %, the `factor` is 0.8, so the item of EUR 6.72 billion falls by EUR 1.34 billion. The `uncertainty` multipliers scale that saving for the low and the high estimate; here the low estimate is half of it.

To check a pack:

```sh
npm run validate
```

The validator checks the shape of every file (an unknown key is an error), every reference between the files, that shares sum to 1, and that every text exists in every locale. Each problem is reported with its file and JSON path, and an invalid pack makes the command exit with status 1. For a valid pack it prints the totals and what each measure does on its own at its default settings, so that a reviewer can judge whether the numbers are plausible. Shortened:

```text
countries/de: valid
  base year 2024, amounts in EUR per year
    revenue         2,028.34 bn  (46.2 % of GDP)
    expenditure     2,147.49 bn  (49.0 % of GDP)
    balance          -119.15 bn  (-2.7 % of GDP)
  effect on the balance of each policy on its own, at default parameters (low to high):
    asylum_benefits_cut                  +1.34 bn  (+671.85 m to +1.34 bn)
    wealth_tax                          +31.19 bn  (+18.71 bn to +38.98 bn)
    defence_spending_target             -65.80 bn  (-72.38 bn to -59.22 bn)

1 pack(s) checked: 1 valid, 0 invalid.
```

The reference for the format is [src/engine/types.ts](src/engine/types.ts). [src/engine/__fixtures__/testland.ts](src/engine/__fixtures__/testland.ts) is a small made-up country that uses every optional field of the format. If a pack does not validate, the app shows Testland in its place, under a notice that lists the errors.

In the German pack, `budget.json` and the two distributions are generated by the scripts in `pipeline/de/`: change the scripts, not the JSON. `country.json`, `policies.json` and `sources.json` are maintained by hand. See [pipeline/de/README.md](pipeline/de/README.md).

## Contributing

To propose a measure or to correct a figure, a catch or a source, open a pull request. If you cannot make the change yourself, open an issue that says which figure or statement is wrong and links the source that shows it.

- **Every number needs a source and a label.** Add the source to `sources.json` and refer to it by its id. Label the figure `official`, `derived` or `estimate`, and give an effect that is not certain a low and a high multiplier.
- **Neutral wording.** The label and the summary of a measure say what it does, not whether it is a good idea. A catch states something that can be checked, such as a court ruling, an article of law or a study, and cites it.
- **All languages.** Texts are needed in English and in every locale of the pack.
- **Check before you open the pull request.** Run `npm run validate`, `npm test` and `npm run typecheck`. Nothing in the repository runs them automatically yet.

## Status and limitations

- **A preview.** The version is 0.1.0, and the pack format is marked "v0" in `src/engine/types.ts` and can still change. The preview site asks search engines not to index it until it has an imprint and a privacy notice.
- **One country.** Germany, base year 2024, with 11 measures.
- **Static estimates.** The figures are direct first-year effects. There is no forecast and no model of how the economy reacts.
- **Judgement in the data.** Which level of government bears an item is partly estimated, and the remainders next to named cash items are approximate. [pipeline/de/README.md](pipeline/de/README.md) lists every such judgement.
- **A snapshot.** The German figures are Eurostat's data as of October 2026. Eurostat revises its tables several times a year and the downloaded source files are not in the repository, so a fresh download will usually not reproduce the pack exactly.
- **Two interface languages.** German and English.
- **No automated checks.** Tests, type check and pack validation are run by hand.

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
