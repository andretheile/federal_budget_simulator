/**
 * Testland ("xx"): a small synthetic country with round numbers, used by the tests and as the
 * fallback of the smoke page. It uses every optional field of the contract at least once.
 *
 * Base year totals: revenue 4000, expenditure 4400, balance -400. GDP 10000, 100 inhabitants,
 * 50 households.
 *
 *   level             revenue   expenditure
 *   central              1650          1288
 *   state                1150          1212
 *   social_security      1200          1900
 *
 * What each policy does on its own at default parameters:
 *   halve_mp_pay                 exp.admin.parliament 10 -> 5                          balance   +5
 *   cut_admin                    exp.admin 400 -> 360 (10 %)                           balance  +40
 *   no_basic_income_non_citizens exp.social.basic_income 400 -> 304, admin.other +6    balance  +90  (36 to 90)
 *   wealth_tax                   rev.taxes.wealth 0 -> 40 (1 % above 1000, yield 0.8)  balance  +40  (20 to 50)
 *   raise_top_tax_rate           rev.taxes.income 1500 -> 1625 (model 120 -> 130)      balance +125
 *   defense_target               exp.defense 200 -> 300 (3 % of GDP)                   balance -100
 *   family_bonus                 exp.social.family 200 -> 300 (2 per household)        balance -100
 *   cut_pensions                 exp.social.pensions 1600 -> 1440 (10 %); a quarter of
 *                                the 160 shifts to exp.social.basic_income 400 -> 440  balance +120  (40 to 140)
 *
 *   redraw_income_tax            rev.taxes.income 1500 -> 1625: the tariff as an editable
 *                                curve, model 120 -> 130                               balance +125  (100 to 150)
 *   insure_civil_servants        rev.social_contributions +100, exp.admin.other +50 (the
 *                                employer's half); 30 % of the employees' half comes back
 *                                as less income tax: rev.taxes.income -15              balance  +35  (22 to 46.75)
 *
 * cut_pensions moves cost between levels: social insurance saves 120 and the centre 40 on
 * pensions, and the centre pays the 40 that reappear as basic income support.
 *
 * insure_civil_servants ties its two effects and the knock-on together with the uncertainty basis
 * "wages": one multiplier (0.8 or 1.1) applies to all three, the one worse for their sum. At an
 * employer share of 100 % contributions and spending cancel out exactly and the range is zero.
 * Its shift is a knock-on on an `add` effect, with its own label, quality, note and range (0.5 to
 * 1.5 on the tax part): low = 80 - 40 - 15 * 0.8 * 1.5 = 22, high = 110 - 55 - 15 * 1.1 * 0.5 = 46.75.
 *
 * redraw_income_tax has a curve param. Today's tariff is 20 % from 10 and 40 % from 30, the same
 * as the brackets of raise_top_tax_rate, written as curve points. The default curve starts at
 * 10 % at an income of 10 and rises linearly to 40 % at 30:
 *   an income of 20 owes 2 today and 1.75 after; an income of 45 owes 10 today and 11 after;
 *   incomes between 10 and 23 1/3 pay less, incomes above pay more.
 *
 * Debt (debt.json): 5000 at the end of 2024, 50 % of GDP. Base-year interest is taken from
 * exp.interest (100; the official figure, interest.value, is 95), so the debt starts at an average
 * rate of 2 %. A quarter of it is refinanced each year. The primary balance is -400 + 100 = -300,
 * -3 % of GDP. Default assumptions: market rate 4 %, growth 3 %, 30 years, no drift. Year 1 at the
 * defaults: GDP 10300, primary balance -309, interest 5000 * (0.75 * 2 % + 0.25 * 4 %) = 125,
 * deficit 434, debt 5434.
 */
import type { RawPackFiles } from "../validate.ts";
import type { CountryPack, LocalizedText } from "../types.ts";

const t = (en: string, de: string): LocalizedText => ({ en, de });

export const testland: CountryPack = {
  country: {
    id: "xx",
    name: t("Testland", "Testland"),
    currency: "XTS",
    locales: ["en", "de"],
    baseYear: 2024,
    levels: {
      central: { name: t("Central government", "Zentralstaat") },
      state: { name: t("Provinces", "Provinzen") },
      social_security: { name: t("Social insurance", "Sozialversicherung") },
    },
    indicators: {
      gdp: { value: 10000, quality: "official", sources: ["stats_office"] },
      population: { value: 100, quality: "official", sources: ["stats_office"], year: 2023 },
      households: { value: 50, quality: "derived", sources: ["stats_office"] },
      grossDebt: { value: 5000, quality: "official", sources: ["finance_ministry"] },
    },
    methodology: t("All numbers are invented.", "Alle Zahlen sind erfunden."),
  },

  budget: {
    revenue: [
      {
        id: "rev.taxes",
        label: t("Taxes", "Steuern"),
        description: t("All taxes.", "Alle Steuern."),
        code: "D2_D5",
        children: [
          {
            id: "rev.taxes.income",
            label: t("Income tax", "Einkommensteuer"),
            code: "D51",
            amount: 1500,
            levels: { central: 0.5, state: 0.5 },
            quality: "official",
            sources: ["finance_ministry"],
          },
          {
            id: "rev.taxes.vat",
            label: t("Value added tax", "Umsatzsteuer"),
            amount: 1000,
            levels: { central: 0.6, state: 0.4 },
            quality: "official",
            sources: ["finance_ministry"],
          },
          {
            id: "rev.taxes.wealth",
            label: t("Wealth tax", "Vermögensteuer"),
            amount: 0,
            levels: { state: 1 },
            quality: "official",
            sources: ["finance_ministry"],
            note: t("Not levied in the base year.", "Wird im Basisjahr nicht erhoben."),
          },
        ],
      },
      {
        id: "rev.social_contributions",
        label: t("Social contributions", "Sozialbeiträge"),
        amount: 1200,
        levels: { social_security: 1 },
        quality: "official",
        sources: ["finance_ministry"],
      },
      {
        id: "rev.other",
        label: t("Other revenue", "Sonstige Einnahmen"),
        amount: 300,
        levels: { central: 1 },
        quality: "derived",
        sources: ["finance_ministry"],
        year: 2023,
      },
    ],
    expenditure: [
      {
        id: "exp.social",
        label: t("Social protection", "Soziale Sicherung"),
        code: "GF10",
        children: [
          {
            id: "exp.social.pensions",
            label: t("Pensions", "Renten"),
            amount: 1600,
            levels: { social_security: 0.75, central: 0.25 },
            quality: "official",
            sources: ["finance_ministry"],
          },
          {
            id: "exp.social.basic_income",
            label: t("Basic income support", "Grundsicherung"),
            amount: 400,
            levels: { central: 1 },
            quality: "official",
            sources: ["finance_ministry"],
            breakdowns: {
              citizenship: {
                label: t("By citizenship", "Nach Staatsangehörigkeit"),
                basis: "spending",
                groups: [
                  { id: "citizens", label: t("Citizens", "Staatsangehörige"), share: 0.6 },
                  { id: "eu", label: t("EU citizens", "EU-Bürger"), share: 0.1 },
                  { id: "non_eu", label: t("Non-EU citizens", "Drittstaatsangehörige"), share: 0.3 },
                ],
                quality: "estimate",
                sources: ["stats_office"],
                year: 2023,
                note: t("Estimated from recipient counts.", "Aus Empfängerzahlen geschätzt."),
              },
            },
          },
          {
            id: "exp.social.family",
            label: t("Family benefits", "Familienleistungen"),
            amount: 200,
            levels: { central: 0.5, state: 0.5 },
            quality: "official",
            sources: ["finance_ministry"],
          },
        ],
      },
      {
        id: "exp.health",
        label: t("Health", "Gesundheit"),
        amount: 700,
        levels: { social_security: 1 },
        quality: "official",
        sources: ["finance_ministry"],
      },
      {
        id: "exp.education",
        label: t("Education", "Bildung"),
        amount: 800,
        levels: { state: 1 },
        quality: "official",
        sources: ["finance_ministry"],
      },
      {
        id: "exp.defense",
        label: t("Defence", "Verteidigung"),
        amount: 200,
        levels: { central: 1 },
        quality: "official",
        sources: ["finance_ministry"],
      },
      {
        id: "exp.admin",
        label: t("Administration", "Verwaltung"),
        children: [
          {
            id: "exp.admin.parliament",
            label: t("Parliament", "Parlament"),
            amount: 10,
            levels: { central: 1 },
            quality: "official",
            sources: ["finance_ministry"],
          },
          {
            id: "exp.admin.other",
            label: t("Other administration", "Übrige Verwaltung"),
            amount: 390,
            levels: { central: 0.2, state: 0.8 },
            quality: "derived",
            sources: ["finance_ministry"],
          },
        ],
      },
      {
        id: "exp.interest",
        label: t("Interest", "Zinsen"),
        amount: 100,
        levels: { central: 1 },
        quality: "official",
        sources: ["finance_ministry"],
      },
    ],
  },

  policies: [
    {
      id: "halve_mp_pay",
      label: t("Halve MPs' pay", "Abgeordnetendiäten halbieren"),
      summary: t("Members of parliament get half.", "Abgeordnete bekommen die Hälfte."),
      topic: "state",
      params: [],
      effects: [{ type: "scale", target: "exp.admin.parliament", factor: 0.5, quality: "official" }],
      catches: [
        {
          kind: "political",
          severity: "minor",
          text: t("Parliament decides on its own pay.", "Das Parlament entscheidet selbst über seine Bezüge."),
        },
      ],
      sources: ["finance_ministry"],
    },
    {
      id: "cut_admin",
      label: t("Cut administration", "Verwaltung kürzen"),
      summary: t("Across-the-board cut of all administration.", "Pauschale Kürzung der gesamten Verwaltung."),
      topic: "state",
      params: [
        {
          id: "cut",
          type: "number",
          label: t("Cut", "Kürzung"),
          unit: "percent",
          min: 0,
          max: 50,
          step: 1,
          default: 10,
        },
      ],
      effects: [
        {
          type: "scale",
          target: "exp.admin",
          factor: { param: "cut", scale: -0.01, offset: 1 },
          quality: "estimate",
        },
      ],
      catches: [],
      sources: [],
    },
    {
      id: "no_basic_income_non_citizens",
      label: t("No basic income support for non-citizens", "Keine Grundsicherung für Ausländer"),
      summary: t("The selected groups lose the benefit.", "Die gewählten Gruppen verlieren den Anspruch."),
      topic: "migration",
      params: [
        {
          id: "groups",
          type: "groups",
          label: t("Excluded groups", "Ausgeschlossene Gruppen"),
          node: "exp.social.basic_income",
          breakdown: "citizenship",
          default: ["non_eu"],
        },
      ],
      effects: [
        {
          type: "excludeGroups",
          target: "exp.social.basic_income",
          breakdown: "citizenship",
          groups: { param: "groups" },
          retained: 0.2,
          quality: "estimate",
          uncertainty: { low: 0.5, high: 1 },
          sources: ["stats_office"],
          note: t("A fifth of the cost stays as emergency aid.", "Ein Fünftel der Kosten bleibt als Nothilfe."),
        },
        {
          type: "add",
          target: "exp.admin.other",
          amount: 6,
          quality: "estimate",
          uncertainty: { low: 1, high: 2 },
        },
      ],
      catches: [
        {
          kind: "legal",
          severity: "blocker",
          text: t("The constitution guarantees a subsistence minimum.", "Die Verfassung garantiert ein Existenzminimum."),
          sources: ["stats_office"],
        },
        {
          kind: "cost_shift",
          severity: "major",
          text: t("Provinces pay for emergency shelters.", "Die Provinzen zahlen für Notunterkünfte."),
        },
      ],
      sources: ["stats_office"],
    },
    {
      id: "wealth_tax",
      label: t("Wealth tax", "Vermögensteuer"),
      summary: t("An annual tax on net wealth above an allowance.", "Jährliche Steuer auf Nettovermögen über einem Freibetrag."),
      topic: "taxes",
      params: [
        {
          id: "rate",
          type: "number",
          label: t("Rate", "Steuersatz"),
          unit: "percent",
          min: 0,
          max: 5,
          step: 0.1,
          default: 1,
          baseline: 0,
        },
        {
          id: "threshold",
          type: "number",
          label: t("Allowance", "Freibetrag"),
          unit: "currency",
          min: 0,
          max: 5000,
          step: 100,
          default: 1000,
        },
      ],
      effects: [
        {
          type: "schedule",
          target: "rev.taxes.wealth",
          distribution: "wealth",
          reform: { brackets: [{ from: { param: "threshold" }, rate: { param: "rate", scale: 0.01 } }] },
          yield: 0.8,
          quality: "estimate",
          uncertainty: { low: 0.5, high: 1.25 },
        },
      ],
      catches: [
        {
          kind: "economic",
          severity: "major",
          text: t("Wealth can move abroad.", "Vermögen kann ins Ausland verlagert werden."),
          sources: ["wealth_survey"],
        },
      ],
      sources: ["wealth_survey"],
    },
    {
      id: "raise_top_tax_rate",
      label: t("Raise the top income tax rate", "Spitzensteuersatz anheben"),
      summary: t("A higher rate on income above 30.", "Höherer Satz auf Einkommen über 30."),
      topic: "taxes",
      params: [
        {
          id: "top_rate",
          type: "number",
          label: t("Top rate", "Spitzensteuersatz"),
          unit: "percent",
          min: 40,
          max: 60,
          step: 1,
          default: 50,
          baseline: 40,
        },
      ],
      effects: [
        {
          type: "schedule",
          target: "rev.taxes.income",
          distribution: "income",
          baseline: {
            brackets: [
              { from: 10, rate: 0.2 },
              { from: 30, rate: 0.4 },
            ],
          },
          reform: {
            brackets: [
              { from: 10, rate: 0.2 },
              { from: 30, rate: { param: "top_rate", scale: 0.01 } },
            ],
          },
          quality: "derived",
        },
      ],
      catches: [],
      sources: ["tax_statistics"],
    },
    {
      id: "defense_target",
      label: t("Defence spending target", "Verteidigungsausgaben-Ziel"),
      summary: t("Spend a fixed share of GDP on defence.", "Einen festen Anteil des BIP für Verteidigung ausgeben."),
      topic: "defense",
      params: [
        {
          id: "share",
          type: "number",
          label: t("Share of GDP", "Anteil am BIP"),
          unit: "percent_gdp",
          min: 1,
          max: 5,
          step: 0.1,
          default: 3,
          baseline: 2,
        },
      ],
      effects: [
        {
          type: "set",
          target: "exp.defense",
          amount: { param: "share", scale: 0.01, times: "gdp" },
          quality: "official",
        },
      ],
      catches: [],
      sources: [],
    },
    {
      id: "family_bonus",
      label: t("Family bonus", "Familienbonus"),
      summary: t("A yearly payment to every household.", "Eine jährliche Zahlung an jeden Haushalt."),
      topic: "social",
      params: [
        {
          id: "amount",
          type: "number",
          label: t("Amount per household", "Betrag je Haushalt"),
          unit: "currency",
          min: 0,
          max: 10,
          step: 1,
          default: 2,
          unitLabel: t("XTS per household", "XTS je Haushalt"),
        },
      ],
      effects: [
        {
          type: "add",
          target: "exp.social.family",
          amount: { param: "amount", times: "households" },
          quality: "derived",
        },
      ],
      catches: [],
      sources: [],
    },
    {
      id: "cut_pensions",
      label: t("Cut pensions", "Renten kürzen"),
      summary: t(
        "Lower all pensions. Part of the saving comes back as basic income support.",
        "Alle Renten senken. Ein Teil der Ersparnis kommt als Grundsicherung zurück.",
      ),
      topic: "pensions",
      params: [
        {
          id: "cut",
          type: "number",
          label: t("Cut", "Kürzung"),
          unit: "percent",
          min: 0,
          max: 30,
          step: 1,
          default: 10,
        },
        {
          id: "fallback",
          type: "number",
          label: t("Share that falls back on basic income support", "Anteil, der in die Grundsicherung fällt"),
          unit: "percent",
          min: 0,
          max: 100,
          step: 5,
          default: 25,
          role: "assumption",
        },
      ],
      effects: [
        {
          type: "scale",
          target: "exp.social.pensions",
          factor: { param: "cut", scale: -0.01, offset: 1 },
          quality: "estimate",
          uncertainty: { low: 0.75, high: 1 },
          shift: {
            to: "exp.social.basic_income",
            ratio: { param: "fallback", scale: 0.01 },
            uncertainty: { low: 0.5, high: 2 },
          },
        },
      ],
      catches: [
        {
          kind: "cost_shift",
          severity: "major",
          text: t(
            "Pensioners with small pensions claim basic income support, which the central government pays.",
            "Rentner mit kleinen Renten beantragen Grundsicherung, die der Zentralstaat zahlt.",
          ),
        },
      ],
      sources: [],
    },
    {
      id: "redraw_income_tax",
      label: t("Redraw the income tax", "Einkommensteuertarif neu zeichnen"),
      summary: t(
        "Set the marginal tax rate for every level of income.",
        "Den Grenzsteuersatz für jede Einkommenshöhe festlegen.",
      ),
      topic: "taxes",
      params: [
        {
          id: "tariff",
          type: "curve",
          label: t("Marginal tax rate", "Grenzsteuersatz"),
          x: { unit: "currency", min: 0, max: 60, step: 1 },
          y: { unit: "percent", min: 0, max: 60, step: 1 },
          default: [
            { x: 10, y: 10 },
            { x: 30, y: 40 },
          ],
          baseline: [
            { x: 10, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 40 },
          ],
          minPoints: 1,
          maxPoints: 6,
          presets: [
            {
              id: "flat_tax",
              label: t("Flat tax of 25 %", "Einheitssteuer von 25 %"),
              points: [{ x: 10, y: 25 }],
              sources: ["tax_statistics"],
            },
            {
              id: "higher_top_rate",
              label: t("50 % on income above 40", "50 % auf Einkommen über 40"),
              note: t("Today's tariff below 40.", "Unter 40 der heutige Tarif."),
              points: [
                { x: 10, y: 20 },
                { x: 30, y: 20 },
                { x: 30, y: 40 },
                { x: 40, y: 40 },
                { x: 40, y: 50 },
              ],
            },
          ],
          examples: [
            { x: 20, label: t("Typical taxpayer", "Typischer Steuerzahler") },
            { x: 45, label: t("High earner", "Spitzenverdiener") },
          ],
        },
      ],
      effects: [
        {
          type: "schedule",
          target: "rev.taxes.income",
          distribution: "income",
          baseline: {
            points: [
              { x: 10, y: 20 },
              { x: 30, y: 20 },
              { x: 30, y: 40 },
            ],
            scale: 0.01,
          },
          reform: { curve: { param: "tariff", scale: 0.01 } },
          quality: "estimate",
          uncertainty: { low: 0.8, high: 1.2 },
        },
      ],
      catches: [],
      sources: ["tax_statistics"],
    },
    {
      id: "insure_civil_servants",
      label: t("Civil servants pay into social insurance", "Beamte zahlen in die Sozialversicherung ein"),
      summary: t(
        "Civil servants pay contributions, the state pays the employer's part.",
        "Beamte zahlen Beiträge, der Staat zahlt den Arbeitgeberanteil.",
      ),
      topic: "pensions",
      params: [
        {
          id: "employer_share",
          type: "number",
          label: t("Part of the contribution the state pays as employer", "Anteil des Beitrags, den der Staat als Arbeitgeber zahlt"),
          unit: "percent",
          min: 50,
          max: 100,
          step: 5,
          default: 50,
        },
      ],
      effects: [
        {
          type: "add",
          target: "rev.social_contributions",
          amount: 100,
          quality: "estimate",
          uncertainty: { low: 0.8, high: 1.1, basis: "wages" },
          shift: {
            to: "rev.taxes.income",
            ratio: { param: "employer_share", scale: -0.003, offset: 0.3 },
            uncertainty: { low: 0.5, high: 1.5 },
            label: t("Less income tax", "Weniger Einkommensteuer"),
            quality: "estimate",
            sources: ["tax_statistics"],
            note: t("Employees deduct their own part, taxed at 30 %.", "Beschäftigte setzen ihren Teil ab, Steuersatz 30 %."),
          },
        },
        {
          type: "add",
          target: "exp.admin.other",
          amount: { param: "employer_share", scale: 1 },
          quality: "estimate",
          uncertainty: { low: 0.8, high: 1.1, basis: "wages" },
        },
      ],
      catches: [],
      sources: ["tax_statistics"],
    },
  ],

  sources: {
    stats_office: {
      title: "Statistical yearbook",
      publisher: "Testland Statistics Office",
      url: "https://example.org/yearbook",
      accessed: "2025-01-15",
      year: 2024,
    },
    finance_ministry: {
      title: "General government accounts",
      publisher: "Testland Ministry of Finance",
      url: "https://example.org/accounts",
      accessed: "2025-01-15",
    },
    wealth_survey: {
      title: "Household wealth survey",
      publisher: "Testland Central Bank",
      url: "https://example.org/wealth",
      accessed: "2025-01-15",
      year: 2022,
      note: "The top of the distribution is extrapolated.",
    },
    tax_statistics: {
      title: "Income tax statistics",
      publisher: "Testland Statistics Office",
      url: "https://example.org/income-tax",
      accessed: "2025-01-15",
    },
  },

  distributions: {
    // 50 taxpayers, total income 900. Every mean is the midpoint of its bin, so the bins are uniform.
    income: {
      id: "income",
      label: t("Taxable income", "Zu versteuerndes Einkommen"),
      variable: t("taxable income per taxpayer", "zu versteuerndes Einkommen je Steuerpflichtigem"),
      unit: t("taxpayers", "Steuerpflichtige"),
      year: 2022,
      bins: [
        { from: 0, to: 10, count: 20, mean: 5 },
        { from: 10, to: 30, count: 20, mean: 20 },
        { from: 30, to: 50, count: 10, mean: 40 },
      ],
      quality: "official",
      sources: ["tax_statistics"],
    },
    // 50 households. The 5 richest are a Pareto tail above 1000 with alpha 2 (mean 2000).
    wealth: {
      id: "wealth",
      label: t("Net wealth", "Nettovermögen"),
      variable: t("net wealth per household", "Nettovermögen je Haushalt"),
      unit: t("households", "Haushalte"),
      year: 2022,
      bins: [
        { from: -100, to: 0, count: 5, mean: -40 },
        { from: 0, to: 100, count: 30, mean: 40 },
        { from: 100, to: 1000, count: 10, mean: 400 },
      ],
      tail: { from: 1000, count: 5, alpha: 2 },
      quality: "estimate",
      sources: ["wealth_survey"],
      note: t("The tail is fitted to rich lists.", "Die Spitze ist an Reichenlisten angepasst."),
    },
  },

  debt: {
    stock: {
      value: 5000,
      quality: "official",
      sources: ["finance_ministry"],
      note: t("Gross debt at the end of the year.", "Bruttoschulden am Jahresende."),
    },
    interest: {
      value: 95,
      quality: "official",
      sources: ["finance_ministry"],
      node: "exp.interest",
      note: t("The budget item also holds fees of 5.", "Der Haushaltsposten enthält auch Gebühren von 5."),
    },
    refinancing: {
      share: 0.25,
      averageMaturity: 4,
      quality: "derived",
      sources: ["finance_ministry"],
      note: t("One divided by the average maturity.", "Eins geteilt durch die durchschnittliche Laufzeit."),
    },
    assumptions: [
      {
        id: "market_rate",
        type: "number",
        label: t("Market interest rate", "Marktzins"),
        unit: "percent",
        min: -1,
        max: 10,
        step: 0.1,
        default: 4,
        baseline: 4,
        note: t("Yield of a ten-year bond.", "Rendite einer zehnjährigen Anleihe."),
        sources: ["stats_office"],
      },
      {
        id: "growth",
        type: "number",
        label: t("Nominal growth", "Nominales Wachstum"),
        unit: "percent",
        min: -2,
        max: 8,
        step: 0.1,
        default: 3,
      },
      {
        id: "horizon",
        type: "number",
        label: t("Years", "Jahre"),
        unit: "years",
        min: 1,
        max: 50,
        step: 1,
        default: 30,
      },
      {
        id: "drift",
        type: "number",
        label: t("Yearly change of the primary balance", "Jährliche Änderung des Primärsaldos"),
        unit: "percent_gdp",
        min: -0.5,
        max: 0.5,
        step: 0.01,
        default: 0,
        unitLabel: t("percentage points of GDP per year", "Prozentpunkte des BIP pro Jahr"),
      },
    ],
    presets: [
      {
        id: "high_rates",
        label: t("High rates", "Hohe Zinsen"),
        values: { market_rate: 8 },
        sources: ["finance_ministry"],
      },
      {
        id: "ageing",
        label: t("Ageing", "Alterung"),
        note: t("Pensions and health grow faster than the economy.", "Renten und Gesundheit wachsen schneller als die Wirtschaft."),
        values: { growth: 2, drift: -0.1 },
      },
      {
        id: "zero_rates",
        label: t("Zero rates", "Nullzinsen"),
        values: { market_rate: 0 },
      },
    ],
    references: [
      {
        id: "neighbour",
        label: t("Neighbouring country", "Nachbarland"),
        kind: "country",
        year: 2024,
        debtRatio: 1.2,
        interestRatio: 0.035,
        revenueRatio: 0.35,
        sources: ["stats_office"],
        note: t("Same definitions as Testland.", "Gleiche Abgrenzung wie Testland."),
      },
      {
        id: "treaty_limit",
        label: t("Treaty limit", "Vertragsgrenze"),
        kind: "threshold",
        debtRatio: 0.6,
        sources: ["finance_ministry"],
      },
      {
        id: "peak_1995",
        label: t("Testland in 1995", "Testland 1995"),
        kind: "history",
        year: 1995,
        interestRatio: 0.04,
        sources: ["finance_ministry"],
      },
    ],
    // Interest (1 % of GDP) is above parliament (0.1 %) from the start, overtakes family benefits
    // and defence (2 % each) later and stays below pensions (16 %).
    comparisons: [
      { node: "exp.admin.parliament" },
      { node: "exp.defense" },
      { node: "exp.social.family", label: t("families", "Familien") },
      { node: "exp.social.pensions" },
    ],
    note: t(
      "All numbers are invented. A what-if calculation, not a forecast.",
      "Alle Zahlen sind erfunden. Eine Wenn-dann-Rechnung, keine Prognose.",
    ),
  },
};

/** The fixture as the raw content of its JSON files, freshly copied so a test can break it. */
export function testlandFiles(): RawPackFiles {
  const copy = JSON.parse(JSON.stringify(testland)) as CountryPack;
  return {
    id: copy.country.id,
    country: copy.country,
    budget: copy.budget,
    policies: { policies: copy.policies },
    sources: copy.sources,
    distributions: copy.distributions,
    debt: copy.debt,
  };
}

/** A deep copy of the fixture as a pack, for tests that need to change it. */
export function testlandCopy(): CountryPack {
  return JSON.parse(JSON.stringify(testland)) as CountryPack;
}
