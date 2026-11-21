# Budget Simulator

An interactive dashboard of a country's public budget: revenue, spending and balance of the whole state, not only of the central government. You switch on a policy proposal from public debate, such as raising the retirement age, reintroducing the wealth tax, halving MPs' pay or ending citizen's income for non-citizens, and see at once what it does to the budget and what the catch is: legal limits, costs that move to another level of government, side effects. The site shows numbers and catches and takes no political side.

Germany is the first country; the second is the United States, with the federal budget only and its first seven measures. A preview is live at **[fiscal.drtheile.com](https://fiscal.drtheile.com)**; links to its former address, budget.drtheile.com, lead there.

![Budget Simulator with the German budget and three measures switched on: the balance, the goal bar for the 2028 gap in the federal financial plan, bars for revenue and spending, the list of measures narrowed to social policy, and the card of a changed health insurance contribution curve whose loss of wage tax falls on the federal government, the states and the municipalities](docs/screenshot.png)

*Germany with three measures switched on (English interface; the site follows the system's light or dark setting), the list narrowed to social policy. The card shows the ceiling for health insurance contributions raised to the pension insurance's €90,600: +€14.2bn a year for the balance. Because employees deduct their contributions from taxable income, €3.4bn less wage tax comes in: social insurance gains €17.6bn, while the federal government loses €1.4bn, the states €1.5bn and the municipalities €470m. The goal bar under the balance counts only what reaches the federal government: with a higher standard rate of VAT, switched on and hidden by the filter but still counted, it shows €12.5bn of the gap the financial plan leaves for 2028 as covered and €9.5bn as still missing (range +€10.6bn to +€13.1bn). The third measure, the parental allowance reform, appears in the spending bars as −€1.4bn on family and children; at the top of the page the bar names it as not counted, because the plan already counts on it.*

## What you can do with it

- Break the budget down from broad areas such as social protection or defence to single items, and see for each item its amount, its sources, its data quality and which level of government bears it.
- Switch measures on and off and move their settings: a tax rate, an allowance, the size of a cut.
- Redraw a rate curve, such as the income tax schedule or the pension contribution rate up to its ceiling: drag the points of the curve on a chart or type them into a table, or start from a preset such as a party's election programme. While you edit, the page shows the effect on the balance, how many taxpayers or employees pay more or less, and what a few example incomes pay under the base year's curve and under the new one.
- See for each measure what it does on its own, the range of the estimate, which levels of government it relieves or burdens, the catches with their severity, the limits of the calculation where the pack names them, and the sources. A measure that changes many budget items lists them by the setting that drives them, with what each group does to the balance and its largest items first; the rest are a click away.
- Restrict the whole page to one level of government. For Germany these are the federal government, the states, the municipalities and social insurance.
- Measure the measures against a goal that stays in view under the balance while you scroll. For Germany the goals are the gaps that the federal financial plan leaves open for 2028, 2029 and 2030. A bar and a sentence say how much of the gap the measures switched on cover, what is still missing, the range of the estimate, and whether a closed gap stays closed at the cautious end of that range. Only what reaches the goal's level of government counts: a wealth tax, which goes to the states, does nothing for a federal gap. Where the measures relieve that level while the other levels pay more at the same time, the bar says by how much. What the goal leaves out is named on the bar with its amount, and the reason is one click away; for Germany that is defence spending paid for with borrowing outside the debt brake, and measures the financial plan already counts on, whose cards say so.
- Find a measure in a list in alphabetical order, and narrow it to one topic, such as pensions or taxes, or to the measures of one debate, for Germany those around the 2027 federal budget. Each measure of a debate carries a badge with the debate's name, and measures that are switched on keep counting while a filter hides them; the list says how many are hidden.
- See where a scenario leads over the coming decades: how the debt grows and, above all, what share of all revenue goes on interest, with and without the measures. Choose the interest rate on new debt, growth, the number of years and how fast costs such as pensions outgrow the economy, or start from a preset such as "rates as in the United States". The page compares the result with other countries and the EU's 60 % and names the year in which interest would cost more than defence, education and other items. By default the calculation starts from the government's own projection: up to its last year the debt and growth without measures are the projection's, and then the assumptions take over; the chart marks where. You can choose instead to continue the 2024 budget as it was, without what has been decided since, and the presets act on either starting point. The interest the federal budget plans to pay is shown apart from the charts, because it covers only the federal core budget and is counted in cash.
- Copy a link that reproduces a scenario exactly, with the goal and the debate you chose.

![The curve editor for the German income tax schedule: a chart of the marginal rate with draggable points over the distribution of taxable incomes, and beside it the effect on the balance, who pays more or less, and the top rate; above it the balance and the goal bar](docs/tariff-editor.png)

*The curve editor for the German income tax schedule (English interface). In black the edited marginal rate, raised above the grey curve of 2024 in the upper income range; dashed the average rates; behind them the distribution of taxable incomes, with the axis compressed above €100,000. At the side: +€8.0bn a year for the balance (range +€7.2bn to +€9.6bn), 4.27m taxpayers (7.3%) who pay more, and a top rate of 48% from €277,825 instead of 45%. Above the editor the balance and the goal bar stay in view: of the €8.0bn, €3.4bn reach the federal government, the share of income tax it receives, and count towards the 2028 gap.*

## How it works

- **Country packs.** Everything that is specific to a country is data: budget figures, measures, catches, sources and all texts are JSON files in `countries/<id>/`. `countries/de/` is the German pack.
- **Engine.** `src/engine/` is a calculation engine in plain TypeScript, without React, DOM or network access, and it knows nothing about any particular country. It validates a pack, applies the measures that are switched on to the budget, and reports the change for every measure, budget item and level of government, with a low and a high estimate.
- **No server.** The app is a static site built with Vite, React and TypeScript. The packs are part of the build, and all calculation happens in the browser. The app makes no third-party requests (the fonts are bundled) and sets no cookies. The one thing it stores on your device is the interface language, and only if you choose one.
- **Shareable links.** The scenario (which measures are on, their settings including edited curves, the level filter) and the language are kept in the fragment of the URL, for example `https://fiscal.drtheile.com/#lang=en&s=mp_pay_cut~wealth_tax.rate.15e-1`. While a curve editor is open, the link names it as well (`&e=income_tax_schedule.schedule`), so the link opens the editor. Assumptions of the debt projection that differ from their defaults are in the link too (`&d=r5.1~y40`: 5.1 % on new debt, 40 years), and so is the starting point when it is not the pack's: `b` to continue the 2024 budget instead of starting from the government's projection. A goal other than the pack's default and a chosen debate are in it as well. For example, `#lang=de&s=sugar_drinks_tax&d=b&g=federal_plan_gap_2030&f=budget_2027` measures the sugary drinks tax against the gap for 2030, shows the measures of the 2027 budget debate and continues the 2024 budget. Links from before the starting point could be chosen open on the pack's starting point; one that named the government's projection with `f` and its id still opens on it. The Share button copies that link. Browsers do not send the fragment to the server, so the host does not learn which scenario you look at.

## How to read the numbers

This describes the German pack. The app has its own version under "About the numbers", which includes the pack's full method note from `countries/de/country.json`.

- **Base year 2024.** It is the latest year for which Eurostat has published government expenditure by function (COFOG). All budget amounts are figures for that one year. Some inputs of measures are older: the distributions of taxable income and of gross wages come from the tax statistics for 2022, with all amounts raised to 2024 levels by the growth of average earnings, and two of the three tax breaks in the transport measure are valued at 2018 figures.
- **The whole state, on a national-accounts basis.** Amounts come from national accounts for general government (federal government, states, municipalities, social insurance), with payments between these levels netted out: revenue of EUR 2,028.3 billion, spending of EUR 2,147.5 billion and a deficit of EUR 119.1 billion, as published in October 2026. They differ from budget plans, because the federal budget is only one part of the state and cash figures follow different definitions.
- **Named items are cash figures.** Individually named items such as citizen's income or MPs' pay are cash figures. The rest of their group is the difference to the national-accounts total of the group and is therefore only approximately right.
- **Levels of government.** Every item is split across the levels that ultimately bear it. Part of that split is published, part is estimated from who is responsible for a task; [pipeline/de/README.md](pipeline/de/README.md) lists what is data and what is judgement. Because payments between levels are netted out, the app shows no balance for a single level, only how far a measure relieves or burdens it.
- **Static estimates for one year.** A measure's figure is its direct effect on the budget of one year, not a forecast over several years. As a rule it is the effect in the first year. Where a measure's figure stands for something else, such as the annual effect once a rule applies to all cohorts of pensioners or the full effect expected for a later year, the measure's card says so. The engine does arithmetic on the base-year amounts: scale an item, add to it, set it, exclude a group of recipients, or apply a tax schedule or rate curve to a distribution of income, wages or wealth. For the income tax and the two contribution curves, today's and the new curve are both applied to the distribution, and the relative change is carried over to the official revenue figure. It does not model the economy. Behavioural reactions appear only where the pack makes them explicit: as a setting (the wealth tax has one for revenue lost to avoidance, the income tax schedule one for revenue lost to behavioural responses), in the range, as a catch, or as the stated assumption of a study that a figure is taken from (the early-pension figure assumes that those affected retire ten months later on average).
- **Three quality labels.** Every budget item and every effect of a measure carries one:

  | Label | Meaning |
  | --- | --- |
  | `official` | Taken directly from official statistics. |
  | `derived` | Calculated from official figures. |
  | `estimate` | Based on assumptions, model calculations or studies. |

  Most German budget items are `derived`: the amount is official or computed from official figures, and its split across the levels of government is computed.
- **Ranges.** Where an effect is uncertain, the pack gives a low and a high multiplier, and the app shows the resulting range next to the central figure. The multipliers are the pack author's judgement, explained in the effect's note and sources. They are not statistical confidence intervals. The range of a scenario is the sum of the low values and the sum of the high values of its measures.
- **Sources.** Every budget item has to name at least one source, or the validator rejects the pack. In the German pack every effect and every catch names one as well. The app lists all sources with publisher, link and date of access, most of them with a note on what is taken from them, in the language of the page; the file is `countries/de/sources.json`.
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
| `npm run build` | Type check, then production build into `dist/`, without preview packs |
| `PREVIEW_PACKS=include npm run build` | The same build with the preview packs, to look at before a release |
| `npm run preview` | Serves the built `dist/` locally |

Python is only needed to rebuild the budget data ([pipeline/de/README.md](pipeline/de/README.md), [pipeline/us/README.md](pipeline/us/README.md)). Imprint and privacy statement come from a site config, see [Running your own instance](#running-your-own-instance). Hosting is described in [deploy/README.md](deploy/README.md).

## Project layout

```text
countries/
  de/                      the German country pack
    country.json
    budget.json
    policies.json
    sources.json
    distributions/         taxable_income.json, gross_earnings.json, net_wealth.json
    debt.json              the debt and interest projection
    goals.json             targets for the balance, such as the gaps in the federal financial plan
  us/                      the US pack: federal budget only, seven measures (country, budget, policies, sources,
                           distributions/wages.json)
src/
  engine/                  calculation engine, knows no country
    types.ts               the country pack format
    index.ts               public API
    schema.ts, validate.ts checks a pack
    simulate.ts            applies measures to the budget
    distribution.ts        tax schedules over income and wealth distributions
    curve.ts               rate curves: what a unit owes, totals, who pays more or less
    debt.ts                debt and interest over the coming years
    timing.ts              when measures act in the projection, and how they build up
    goals.ts               how far a scenario goes towards a goal
    scenario.ts            scenario to URL string and back
    __fixtures__/          Testland, a made-up country for the tests
  app/                     view models and URL state
  components/              React components
  i18n/                    interface texts (German, English) and number formatting
  hooks/, styles/
  site/                    the site config: the operator's details for imprint and privacy statement
  packs.ts                 loads and validates the packs in countries/
  App.tsx, main.tsx
scripts/validate-packs.ts  behind "npm run validate"
pipeline/de/               Python scripts that rebuild the German budget data (own README)
pipeline/us/               the same for the US federal budget (own README)
deploy/                    static hosting files and a deploy script (own README)
docs/                      the screenshots in this README
site.config.example.json   example of the site config, with made-up details
```

## Running your own instance

The app is a set of static files and runs on any web server. A site in Germany also needs an imprint (Impressum) and a privacy statement (Datenschutzerklärung). What they say depends on who runs the site and where, so it is not in the source. It comes from a file `site.config.json` in the repository root, which git ignores. [site.config.example.json](site.config.example.json) shows every field with made-up details: copy it and fill in your own. To keep the file somewhere else, set `SITE_CONFIG=/path/to/file.json` for the build.

The build reads the file and checks it. If a field is missing or wrong, the build stops and names every such field. Otherwise it is in one of three states, and it prints which one in a line that starts with `Legal pages:`:

| State | Legal pages | Search engines |
| --- | --- | --- |
| No config | none, and no links to them | asked not to index the site (`noindex`) |
| Config | imprint and privacy statement, linked in the footer | asked not to index the site |
| Config with `"indexable": true` | as above | may index the site |

If the imprint names the operator, or a person responsible for the content, without a postal address, the same line says so: `Legal pages: included, from …, WITHOUT a postal address for the operator.` Crawling is allowed in every state ([public/robots.txt](public/robots.txt)), since a search engine has to fetch the page to see its `noindex` tag.

Both pages are in German and English. They replace the simulator while open and are addressed in the fragment of the URL (`#lang=de&p=imprint`, `&p=privacy`), so they work on any static host; the link back keeps the scenario. The imprint gives the operator's name, postal address (if the config has one) and contact and the person responsible for the content (§ 5 DDG, § 18 MStV). The privacy statement has two parts. The part about the app describes this code and is written in `src/i18n/legal/`: no cookies, one localStorage entry for a language the visitor chose, no requests to other hosts, all calculation in the browser, the scenario in the fragment of the URL. The part about hosting comes from the config: who hosts and where the server is, what the server logs and for how long, a proxy or CDN in front and the basis for a transfer outside the EU, then the legal basis and the visitors' rights, with the operator as contact.

| Field | Meaning |
| --- | --- |
| `operator` | `name`, `email`, and optionally `address` (the postal address, a list of lines) and `phone`. Shown in the imprint and as the controller in the privacy statement |
| `contentResponsible` | Optional: the person responsible for the content under § 18 Abs. 2 MStV, with `name` and optionally `address`. Default: the operator |
| `hosting` | `name` and `address` of the hoster, `country` of the server as an ISO code such as `DE`, optionally `privacyPolicy` (a URL) |
| `proxy` | Optional proxy or CDN in front of the server, such as Cloudflare: `name`, `address`, the `country` where it processes data, `transfer` for a country outside the EU and the EEA (`dpf` for the EU-US Data Privacy Framework, `adequacy` for an adequacy decision, `scc` for standard contractual clauses), `networkErrorReports: true` if it asks browsers to report failed requests (the `NEL` header), optionally `privacyPolicy` |
| `serverLog` | `fields`, what the access log holds (`time`, `request`, `status`, `bytes`, `referrer`, `userAgent`, `ipAddress`; an empty list for no log), and `retention`: `{ "days": 14 }` or `{ "maxMegabytes": 30 }` |
| `imprint.addition`, `privacy.addition` | Optional paragraphs of your own at the end, per language: `{ "de": "…", "en": "…" }`. A blank line starts a new paragraph |
| `privacy.updated` | Optional date on which the statement was last checked, `YYYY-MM-DD` |
| `indexable` | `true` lets search engines index the site. Default: `false` |

The postal address of the operator and of the person responsible for the content is optional in the schema; the example has one, which is the recommended form. German law generally expects a postal address from a site that does not serve purely personal or family purposes (§ 18 Abs. 1 MStV, for business sites also § 5 DDG). Leaving it out is the operator's decision. The pages then give the name and contact only, under headings that do not cite § 5 DDG or § 18 Abs. 2 MStV.

The texts are a starting point, not legal advice: read both pages on your own site and have them checked before you publish. The privacy statement is only true while the server logs what `serverLog` says. [deploy/nginx.conf](deploy/nginx.conf) logs no IP address and no user agent.

## Adding or changing a country

A country pack is a folder `countries/<id>/`, named after the country's lower-case ISO 3166-1 alpha-2 code. The build picks up every folder in `countries/`; nothing has to be registered in code. With more than one pack, the header shows a country switch.

A pack that is not ready to go live marks itself with `"preview": true` in its `country.json`. A production build (`npm run build`, and so `deploy/deploy.sh`) leaves it out entirely: none of its files are in `dist/`, and an address that names it opens the default country. `PREVIEW_PACKS=include npm run build` builds it in, to look at a build before a release. The development server always shows every pack and marks previews as such, in the country switch and on the pack's own page; tests and `npm run validate` cover previews like any pack. Every build says in a line starting with `Countries:` which countries it contains and which it left out as previews, and `deploy.sh` repeats that line in its box before it uploads anything. To publish a preview, remove the mark.

| File | What it holds |
| --- | --- |
| `country.json` | Name, currency, languages, base year (and, for a fiscal year, how the masthead names it), the levels of government that exist and what they are called, reference values (GDP and population, optionally households and gross debt), and a method note that the app shows under "About the numbers" |
| `budget.json` | The budget as two trees, `revenue` and `expenditure` |
| `policies.json` | The measures, in the order in which they are applied, and optionally named collections of them |
| `sources.json` | Every source under an id: title, publisher, URL, date of access, and an optional note |
| `distributions/<id>.json` | Optional: distributions that tax measures are calculated from. The German pack has taxable income, gross wages and net wealth |
| `debt.json` | Optional: the projection of debt and interest, with the first year in which measures can act, the assumptions a visitor can move, presets, reference values, the budget items that interest is compared with, official projections of the country's own path, and which of them the projection starts from |
| `goals.json` | Optional: targets for the balance of one level of government or of the whole state, such as the open gap in a financial plan |

The main concepts:

- **Budget tree.** A node is either a group with `children` or a leaf. Only leaves carry an `amount`, in plain currency units per year (euros, not millions); the total of a group is always the sum of its leaves. Node ids are dotted paths that start with `rev.` or `exp.`, such as `exp.social.basic_security.asylum_benefits`.
- **Levels of government.** A country declares which of four levels it has: `central`, `state`, `local` and `social_security`, the subsectors of general government in ESA 2010. Every leaf states which share of its amount each level bears, and the shares sum to 1. A country can have a single level, as the US pack has; the level filter is then not shown.
- **Quality and sources.** Every leaf has a `quality` (`official`, `derived` or `estimate`) and at least one source id from `sources.json`. A source's title stays in its own language. Its `note`, which says what the source is used for, is either a plain text, shown as it is in every language, or a localized text with every locale of the pack, shown in the language of the page.
- **Breakdowns and distributions.** A node can carry a breakdown of its amount into groups, which a measure can then exclude. In the German pack, citizen's income is broken down by the nationality of the recipients. A distribution describes how income or wealth is spread, as bins with an optional Pareto tail, so that a tax schedule or rate curve can be applied to it.
- **Policies.** A measure has `params` (the settings a visitor can move), at least one effect, and `catches`. Its `summary` is what the card's face says: what the measure does and what its default setting shows, in at most two sentences. Up to 200 characters it stands there whole, about five lines on a phone and three on a desktop; a longer one is cut to two lines until the card is opened, and the validator warns about it, so `npm run validate` lists every such summary with its length in each language. The optional `explanation` holds the rest: how the figure comes about, how to use the settings, how the measure works together with others. It opens the card's details as running text; a blank line starts a new paragraph. A param is a `number` (a slider, with an optional `unitLabel` such as "ct/l" that replaces the generic unit on screen), `groups` (a choice of groups of a breakdown) or a `curve` (see below). A number param's `baseline` is its value in the base year; with every number param at its baseline a measure must change nothing, and the validator warns if it does. Where the baseline is not the base year's value but, say, what current law sets for a later year, `baselineLabel` names it ("Current law"), and the slider shows that name wherever it would show the base year. A number param marked `"role": "assumption"` is not a political choice but an assumption of the calculation, such as how much revenue avoidance costs; the interface marks it as such. An effect names the budget node it changes and has a type: `scale`, `add`, `set`, `excludeGroups` (remove groups of a breakdown) or `schedule` (marginal rates over a distribution, as brackets or as the value of a curve param, calibrated against a `baseline` where one is given). It carries a quality label and, optionally, the low and high multipliers for the range (`uncertainty`). Effects of one measure whose uncertainty names the same `basis` depend on the same uncertain quantity and take the same end of their range together, so that, for example, contributions and the employer's share of them cannot be at opposite ends. Any effect can have a `shift`: a share of its change is passed on to another node, with the opposite sign and its own label, quality, range and note. This is how a cost that moves to another level of government is expressed, and how a knock-on effect is, such as the income tax that falls when employees deduct higher contributions. A catch has a `kind` (`legal`, `economic`, `cost_shift`, `practical` or `political`), a `severity` (`blocker`, `major` or `minor`), a text and its sources: something that stands against the measure itself. What stands against the calculation instead, what the figure leaves out and what the model assumes, goes into the optional `limits`, each a `text` with optional `sources` and without kind or severity. The details show them under a heading of their own after the catches, and the number of catches on the card's face does not count them. A measure with more than six effects, such as one built from the budget's items one by one, has them grouped in the details by the params that drive them, in the order of the settings, each group with what it does to the balance. A group shows its three largest effects at default settings (five where there is only one group), and the rest are a click away with their sum; among that many effects, each note and its sources open under the effect.
- **Collections (optional, in `policies.json`).** Next to `policies`, a pack can list `collections`: measures grouped under a name of the pack's choosing, such as those debated around one year's budget. Each has an `id`, a `label`, optionally a `description` and `sources`, and `policies`, the ids of the measures in the order the collection lists them. A measure can be in several collections or in none; a collection only groups and changes nothing in the calculation. The validator checks that ids are unique and that a collection is not empty and lists only existing measures, each once. `npm run validate` prints, for each collection, what its measures do when all of them are switched on together.

  ```json
  "collections": [
    {
      "id": "budget_2027",
      "label": { "de": "Haushaltsdebatte 2027", "en": "2027 budget debate" },
      "description": { "de": "Vorschläge aus der Debatte um den Bundeshaushalt 2027.", "en": "Proposals from the debate on the 2027 federal budget." },
      "policies": ["wealth_tax", "mp_pay_cut"],
      "sources": ["…"]
    }
  ]
  ```
- **Debt projection (`debt.json`, optional).** A pack can include a projection of debt and interest. `stock` is the general government's gross debt at the end of the base year, and `interest` the interest paid in that year, each with quality and sources. `interest.node` names the budget item that holds interest spending; the projection then starts from that item, so the first year matches the budget exactly. `refinancing.share` is the share of the debt refinanced each year, usually one divided by the average residual maturity. `assumptions` are four number params a visitor can move: `market_rate` (the rate on new and refinanced debt), `growth` (nominal GDP growth), `horizon` (years) and `drift` (a yearly change in the primary balance, in percentage points of GDP, negative for costs that grow faster than the economy, such as ageing). `presets` set some of them at once, for example "rates as in the United States"; a preset acts on whichever starting path is chosen (see `follow` below) and leaves it alone. `references` are values to compare against: other countries, a threshold such as the EU's 60 %, or the country's own past. A reference with `interestRatio` can add `revenueRatio`, the general government's total revenue as a fraction of GDP for the same year and from the same source; the interface then shows that reference's interest as a share of revenue as well, the view it opens with. Leave it out where the source's revenue is not comparable with the country's own. `comparisons` is an optional list of budget items to compare the interest bill with, such as defence and education: each names an `exp.` node other than the interest node, with an optional shorter `label` as it reads after "spending on". The interface says for each item in which year interest overtakes it, or that it does not within the horizon. Like all spending in the projection, the item keeps its base-year share of GDP, as the measures leave it; so the comparison is between interest and that share. The validator checks that each node exists, is spending and is listed once. `plans` is an optional list of official projections of the country's own path, such as the government's medium-term fiscal projection; they are shown next to the model's path and change nothing in it. Each has an `id`, a `label`, a `scope` (`all` for the whole state, or a level of government), `accounts` (`national_accounts` for ESA 2010, the definitions of the budget and the projection, or `cash` for budget plans and financial statistics), `quality`, `sources`, a `note` on its stand and how it differs from the model, and `points`: per year, ascending, whatever the source publishes of `debtRatio`, `balanceRatio`, `interestRatio`, `interestToRevenue` (fractions, as in the projection's own figures), `interest` (currency units) and `growth` (nominal GDP growth over the year before, a fraction). The projection always covers the whole state in national accounts, so only a plan with scope `all` in `national_accounts` can be drawn against it (`isComparablePlan` in the engine); any other, such as the interest bill of the federal budget, is a figure of its own and is shown with its scope. The validator checks that the scope exists, that years ascend and that every point has a value, and warns about ratios that look like percentages. A plan can be followed (`isFollowablePlan`) if it is comparable, every point has a `debtRatio`, its years follow one another without a gap and its last point has a `balanceRatio`. `follow`, at the top of the file, names such a plan as the starting path: the projection follows it unless the visitor chooses to continue the base year's budget instead. Without `follow` the base year's budget is the starting path, and a plan is followed only when the visitor chooses it. The validator checks that `follow` names a plan that can be followed, and warns if the plan has no year after the base year. `note` says in plain words what the projection leaves out. Without `debt.json` a pack simply has no projection.

  ```json
  "plans": [
    {
      "id": "government_projection_2026_09",
      "label": { "de": "Projektion der Bundesregierung (Stabilitätsrat, Oktober 2026)", "en": "Government projection (Stability Council, October 2026)" },
      "scope": "all",
      "accounts": "national_accounts",
      "points": [{ "year": 2027, "debtRatio": 0.6875, "balanceRatio": -0.0525 }, { "year": 2030, "debtRatio": 0.7825, "balanceRatio": -0.045 }],
      "quality": "official",
      "sources": ["bundestag_drs_21_9010"],
      "note": { "de": "…", "en": "…" }
    }
  ],
  "follow": "government_projection_2026_09"
  ```
- **How the projection works.** It is a what-if calculation, not a forecast. It starts either from the base year's budget or from an official plan it follows (see `follow` below and above); the German pack starts from the government's projection. On the base year's budget, GDP grows at the chosen rate, and revenue and spending other than interest keep their base-year share of GDP, plus the drift. Measures act from the first year in which measures can act (`measuresFrom`), each in full and for good unless its `timing` says otherwise (see below). Each year interest is paid on last year's debt: the refinanced share of the debt moves from its old average rate to the market rate, and the rest keeps its rate. The deficit is added to the debt and costs the market rate; a surplus repays debt, and the debt never goes below zero. The range of the measures is carried through as a low and a high path. There is no feedback: higher debt does not raise rates, and measures do not change growth. The projection always covers the whole state, whatever level of government the budget view is filtered to. `npm run validate` prints debt and interest without measures at the default assumptions on the pack's starting path, for the base year, the years of the plan it follows and 10, 20 and 30 years later, with the other starting path beside it, and sets every comparable official plan against the base year's budget continued.

  With `follow` (the pack's starting path, or the visitor's choice, the id of a plan) the projection follows an official plan instead of holding the base year's primary balance. In the plan's years the path without measures meets the plan's debt ratio: its primary balance is what turns last year's debt plus the model's interest into the planned debt, and GDP grows at the plan's `growth` where the plan gives one, otherwise at the growth assumption. That primary balance also absorbs whatever moves the plan's debt besides the deficit, such as loans the state grants, so it is not carried on: after the plan's last year the primary balance is the plan's balance of that year plus the model's interest of that year, as a share of GDP, with the drift counted from then on, and the market rate and growth are the assumptions again. Measures act as without a plan: they change the primary balance by their effect on the base year's primary balance, as a share of GDP, in every year in which they act, so only the path without measures meets the plan. The result says which plan was followed and until which year (`followed`).
- **When measures act (`measuresFrom` in `debt.json`, `timing` in `policies.json`, both optional).** A measure's effects describe its full, steady-state effect on the budget; in the projection it need not have it at once. `measuresFrom` is the first year in which measures can act at all, with a `note` on why that year and optional `sources`: the German pack uses 2027, the next budget year, since no measure switched on today can change 2025 or 2026. Before it, the paths with measures are the path without them; if it lies after the first projection year, their base-year record is the observed one as well. Without it measures act from the year after the base year. A policy's `timing` says when the measure starts and how it builds up: `from`, an ISO date (a date before `measuresFrom` counts as that year), `years` of linear build-up to the full effect, and `yearsPerUnit`, further years per unit of distance between a number param and its `baseline`, for a change that cannot happen at once. `param` names that number param; its direction from the baseline chooses between the phase at the top (at or above the baseline) and `below`, which can give a cut or a lowering its own start and pace. A `note` says where the dates and durations come from, and `sources` back them. A measure without timing acts in full from `measuresFrom`. In each year a measure has the average share of its effect over that year (a start on 1 July gives half a year). The projection then simulates the scenario once more for each year in which some measure has a share between 0 and 1, with each measure applied at its share: each effect does that share of what it would do, and everything that follows acts on what it leaves, so measures that act on the same items interact as they do in full, and the low and high ends keep their linked ranges. Years with the same shares are simulated once; where every measure is in full the year is the scenario itself. With no timing and `measuresFrom` at the first projection year, every figure is exactly what it is without these fields. The projection lists, for the measures switched on, when each starts and in which year it is in full (`phases`); `measurePhase` gives the same for one measure at given settings. The validator checks that `measuresFrom` lies after the base year, that `param` is a number param of the policy with a baseline, that `yearsPerUnit` and `below` have a `param`, and that the sources exist, and warns about a timing that changes nothing or a start in the base year or before. `npm run validate` lists each measure's timing and when it is in full at its default settings. From the German pack:

  ```json
  "timing": {
    "param": "age",
    "from": "2032-01-01",
    "yearsPerUnit": 9,
    "below": {},
    "note": { "de": "…", "en": "…" },
    "sources": ["ask_bericht_2026", "bt_drs_16_3794"]
  }
  ```

  A higher retirement age starts in 2032 and rises by nine years per year of age, as the increase to 67 under current law did; a lower one acts in full from 2027.
- **Goals (`goals.json`, optional).** A goal says by how much the balance of one level of government, or of the whole state, has to improve for a given year, for example to close the gap that a financial plan leaves open. The file names a `default` goal and lists `goals`, each with an `id`, a `label`, a short `description`, the `level` (left out for the whole state), the `amount` in currency units per year like budget amounts, the `year`, `quality`, `sources` and a `note` that gives the stand of the figure and says what comparing measures with it glosses over. The engine's `goalProgress(pack, scenario, goal)` measures a scenario against a goal by the change it causes in that level's balance, with the low and high end of the range: for a single level the figure the interface shows as that level's relief or burden, for the whole state the change of the balance. It simulates at the goal's level, whatever level the page is filtered to, and reports what remains and whether the goal is closed; `measureGoal` does the same for a result already simulated at that level. A goal can list `excluded` entries, each with exactly one of `node` and `policy`, a `reason` for visitors, optionally a `reasonShort` of one short sentence, and optional `sources`. Where room is short, on the card of an excluded measure and in the goal bar's line, the short reason stands, or else the reason itself if it has at most 90 characters; a longer one is a click away, in the card's details and in the goal's. The validator warns about a `reasonShort` of more than 90 characters. Changes on an excluded node and every node below it do not count, for example spending that the rule behind the goal pays for outside it. An excluded measure does not count with its own result inside the scenario at the goal's level, the figure the interface shows for it there, so the order in which measures act on the same items stays as it is; this is for measures the plan behind the goal already counts on. A change by an excluded measure on an excluded node is left out once, under the measure. The improvement is then the level's figure less the excluded part, which `goalProgress` reports beside it, per entry (`excluded`, in the goal's order, each with its `node` or `policy`) and in total (`excludedImprovement`, with `excludedImprovementLow` and `excludedImprovementHigh`); counted plus excluded is the level's figure at the central value and at both ends of the range, because every excluded measure and every other effect on an excluded node gives its own low or high value to the excluded part. The validator checks that ids are unique, the default exists, the level exists in `country.json`, the amount is above zero and the sources exist, and warns about a goal for a year before the base year; an excluded measure must exist and be listed once; an excluded node must exist, be listed once, not lie inside another excluded node, and no effect or shift of a measure that is not excluded itself may target a group above it, since the part of its change that falls on the excluded node could not be told apart. `npm run validate` lists the goals and, for a goal that leaves something out, what counts and what does not with its excluded measures and with every measure switched on.

  ```json
  {
    "default": "federal_plan_gap_2028",
    "goals": [
      {
        "id": "federal_plan_gap_2028",
        "label": { "de": "Lücke 2028 im Finanzplan des Bundes", "en": "2028 gap in the federal financial plan" },
        "description": { "de": "…", "en": "…" },
        "level": "central",
        "amount": 22000000000,
        "year": 2028,
        "quality": "official",
        "sources": ["bundestag_drs_21_7301"],
        "note": { "de": "…", "en": "…" },
        "excluded": [
          { "node": "exp.defence", "reason": { "de": "…", "en": "…" }, "sources": ["gg_art_115"] },
          { "policy": "…", "reason": { "de": "…", "en": "…" }, "reasonShort": { "de": "…", "en": "…" } }
        ]
      }
    ]
  }
  ```
- **Base year.** `baseYear` is a number, and the interface shows it as such ("Balance 2024"). Where the budget year is not the calendar year, `baseYearLabel` gives the name the masthead shows instead of "base year 2025", for example `{ "en": "fiscal year 2025 (Oct 2024 to Sep 2025)", "de": "Haushaltsjahr 2025 (Okt. 2024 bis Sept. 2025)" }`, and `baseYearShort` the short name that headings and labels use instead of the bare number, which would read as a calendar year: `{ "en": "FY 2025", "de": "Haushaltsjahr 2025" }` gives "Balance FY 2025", "compared with FY 2025" and "Der Haushalt im Haushaltsjahr 2025". Charts and tables of later years keep plain years.
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
      "label": { "de": "Kürzung der Ausgaben", "en": "Cut in spending" },
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

A `curve` param is an ordered list of points that sets a marginal rate as a function of the distributed variable: zero below the first point, linear between two points, constant above the last, and a step where two points share an `x`. It gives its ranges and grid (`x`, `y`), today's curve, how many points a curve may have, optional `presets` (each with a label, an optional `note` and sources) and `examples` (values for which the editor shows what is owed today and after). A `schedule` effect takes its reform from the param and compares it with fixed `points` as its baseline. Shortened, from the pension contribution measure:

```json
{
  "id": "schedule",
  "type": "curve",
  "label": { "de": "Beitragssatz nach Bruttojahreslohn", "en": "Contribution rate by gross annual wage" },
  "x": { "unit": "currency", "min": 0, "max": 300000, "step": 100 },
  "y": { "unit": "percent", "min": 0, "max": 30, "step": 0.1 },
  "default": [{ "x": 0, "y": 18.6 }, { "x": 90600, "y": 18.6 }, { "x": 90600, "y": 0 }],
  "presets": [
    {
      "id": "no_ceiling",
      "label": { "de": "Beitragsbemessungsgrenze aufheben", "en": "Abolish the contribution ceiling" },
      "points": [{ "x": 0, "y": 18.6 }]
    }
  ],
  "examples": [{ "x": 37500, "label": { "de": "Mittlerer Jahreslohn …", "en": "Median annual wage …" } }]
}
```

The effect that uses it reads `"reform": { "curve": { "param": "schedule", "scale": 0.01 } }`, and its `baseline` is the same three points with `"scale": 0.01`. The default is the base year's curve, so the measure changes nothing until the curve is changed. The validator warns if a curve param's own `baseline` and the effect's `baseline` describe different curves.

To check a pack:

```sh
npm run validate
```

The validator checks the shape of every file (an unknown key is an error), every reference between the files, that shares sum to 1, and that every text exists in every locale. It warns, among other things, if a measure still changes the budget with its params at their base-year values. Each problem is reported with its file and JSON path, and an invalid pack makes the command exit with status 1. For a valid pack it prints the totals and what each measure does on its own at its default settings, so that a reviewer can judge whether the numbers are plausible; for a schedule that is calibrated against a baseline it also prints how close the model comes to the official amount. Shortened:

```text
countries/de: valid
  base year 2024, amounts in EUR per year
    revenue         2,028.34 bn  (46.2 % of GDP)
    expenditure     2,147.49 bn  (49.0 % of GDP)
    balance          -119.15 bn  (-2.7 % of GDP)
  effect on the balance of each policy on its own, at default parameters (low to high):
    asylum_benefits_cut                  +1.34 bn  (+671.85 m to +1.34 bn)
    wealth_tax                          +31.19 bn  (+18.71 bn to +38.98 bn)
    income_tax_schedule                        +0
      model of rev.taxes.income.personal: 409.82 bn against 340.85 bn official (120.2 %)
    defence_spending_target             -65.80 bn  (-72.38 bn to -59.22 bn)

1 pack(s) checked: 1 valid, 0 invalid.
```

The reference for the format is [src/engine/types.ts](src/engine/types.ts). [src/engine/__fixtures__/testland.ts](src/engine/__fixtures__/testland.ts) is a small made-up country that uses every optional field of the format; the timing fields are in its variant `testlandTimed()`, so that the projections of the main fixture stay those of measures that act from the first projection year. If a pack does not validate, the app shows Testland in its place, under a notice that lists the errors.

In the German pack, `budget.json` and the three distributions are generated by the scripts in `pipeline/de/`: change the scripts, not the JSON. `country.json`, `policies.json` and `sources.json` are maintained by hand. See [pipeline/de/README.md](pipeline/de/README.md). The US pack's `budget.json` and its wage distribution are generated the same way by `pipeline/us/`, which checks GDP and population in `country.json`, recomputes the constants that the US measures take from sources and generates the effects of the measure on the federal workforce, one per budget item ([pipeline/us/README.md](pipeline/us/README.md)).

## Contributing

To propose a measure or to correct a figure, a catch or a source, open a pull request. If you cannot make the change yourself, open an issue that says which figure or statement is wrong and links the source that shows it.

- **Every number needs a source and a label.** Add the source to `sources.json` and refer to it by its id. Label the figure `official`, `derived` or `estimate`, and give an effect that is not certain a low and a high multiplier.
- **Neutral wording.** The label and the summary of a measure say what it does, not whether it is a good idea. A catch states something that can be checked, such as a court ruling, an article of law or a study, and cites it. What the figure leaves out or assumes is a limit of the calculation, not a catch.
- **All languages.** Texts are needed in English and in every locale of the pack.
- **Check before you open the pull request.** Run `npm run validate`, `npm test` and `npm run typecheck`. Nothing in the repository runs them automatically yet.

## Status and limitations

- **A preview.** The version is 0.1.0, and the pack format is marked "v0" in `src/engine/types.ts` and can still change. Search engines are asked not to index a site unless its site config says `"indexable": true` (see [Running your own instance](#running-your-own-instance)).
- **Two countries.** Germany, base year 2024, with 35 measures. The United States, federal government only, fiscal year 2025 in the unified budget, with seven measures (foreign aid, defence, border and immigration enforcement, the Social Security wage cap, the corporate tax rate, a general tariff and a cut of the federal civilian workforce) and without debt projection or goals so far. Both packs are public. The preview mark is for packs under construction: a pack that carries it is left out of a production build (see [Adding or changing a country](#adding-or-changing-a-country)).
- **Static estimates.** The figures are direct effects on the budget of a single year, as a rule the first; a measure whose figure stands for a later year or for the full effect of a rule says so on its card. There is no forecast and no model of how the economy reacts.
- **Goals are a rough yardstick.** The goal bar sets these static effects on the 2024 budget, in national accounts, against a gap in the cash plan for a later year's federal core budget, so a measure may yield more or less by then than it shows here. What the plan already counts on and what is paid for outside the debt brake is left out of the comparison and named on the bar and on the cards of the measures concerned, with a short reason there and the full one in the details.
- **Judgement in the data.** Which level of government bears an item is partly estimated, and the remainders next to named cash items are approximate. [pipeline/de/README.md](pipeline/de/README.md) lists every such judgement.
- **A snapshot.** The German figures are Eurostat's data as of October 2026. Eurostat revises its tables several times a year and the downloaded source files are not in the repository, so a fresh download will usually not reproduce the pack exactly.
- **Two interface languages.** German and English.
- **No automated checks.** Tests, type check and pack validation are run by hand.

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
