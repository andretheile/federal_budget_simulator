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
 * cut_pensions moves cost between levels: social insurance saves 120 and the centre 40 on
 * pensions, and the centre pays the 40 that reappear as basic income support.
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
      grossDebt: { value: 6000, quality: "official", sources: ["finance_ministry"] },
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
  };
}

/** A deep copy of the fixture as a pack, for tests that need to change it. */
export function testlandCopy(): CountryPack {
  return JSON.parse(JSON.stringify(testland)) as CountryPack;
}
