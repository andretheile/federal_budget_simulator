# Germany: who pays (`countries/de/incidence.json`)

`incidence.json` spreads the revenue of the German pack over four income groups of the population
and over payers outside them. It is written by hand; every share in it is derived from published
tables by `build_incidence.py`, except the income tax profile, which the engine computes from the
pack's own distribution of taxable income. To check:

```
python3 pipeline/de/build_incidence.py --check   # every derived share against the file, to 1e-6
npx vitest run src/engine/incidence.de.test.ts   # the income tax profile against the engine, and the sums
npm run validate                                 # the pack; prints who pays today and per measure
```

All documents were fetched and read on 26 November 2026. Their entries in `sources.json` name the
tables and pages used. Every share is an estimate from microsimulations of earlier years, applied
to the revenue of 2024; the page says so beside the headline.

## What it rests on

| | |
|---|---|
| Base study | DIW Politikberatung kompakt 114 (Bach, Beznoska, Steiner 2016), `diw_kompakt_114`; short version DIW Wochenbericht 51+52/2016, `diw_wb_51_2016`. Year 2015 (SOEP and EVS with income tax statistics 2007/2008, projected). It is the most recent study that also splits company taxes up to the top 1 % and adds the highest incomes from the tax statistics. Not used: IW-Report 6/2020 (Beznoska, "Wer den Staat finanziert"; SOEP 2017, EVS 2013, projected to 2019) is newer and covers income tax, VAT, other indirect taxes and contributions per percentile, but leaves out company taxes and employers' contributions and does not add top incomes from the tax statistics, so that it calls its burden at the top a lower bound (pp. 4 f.); IW-Trends 1/2017 covers income tax and VAT only and says very high incomes are missing from its data (p. 99); DIW Wochenbericht 24/2026 is a commentary without data. |
| Units and ranking | Persons in private households, ranked by household gross income per equivalent adult (new OECD scale: 1 for the first adult, 0.5 for every further person aged 14 or over, 0.3 per younger child), gross income including employers' contributions and transfers (kompakt 114, pp. 30 f.: "Die Bevölkerung wird aufsteigend nach diesem Einkommen geordnet und in Perzentile und Dezile eingeordnet."). |
| Count | 83,516,593 inhabitants in 2024 (`eurostat_demo_gind`, the pack's population). The study counts persons in private households, a little fewer; amounts per person are therefore slightly low. They are averages over the group, and the page says so. |
| Groups | Bottom half (deciles 1 to 5), the next 40 % (deciles 6 to 9), the next 9 % (decile 10 without the top 1 %), the top 1 %. |
| Lower bounds | Wochenbericht 51+52/2016, p. 1209: median 2,400 € a month, top tenth from 5,300 € a month (2015, per equivalent adult, gross including employers' contributions): `from` 28,800 and 63,600 a year. No bound for the top 1 % in 2015; Table 3-7 of kompakt 114 (p. 38) gives 11,116 € a month for 2008, named in the population's note, not used as `from`. |
| Income shares | Table 4-12 (p. 61): deciles 1 to 5 2.6 + 3.7 + 4.9 + 5.7 + 7.0 = 23.9 %, deciles 6 to 9 8.0 + 9.7 + 11.7 + 14.5 = 43.9 %, decile 10 32.1 % of which the top 1 % 9.9 %. Sum 99.9 %, scaled to 1: 0.239239 / 0.43944 / 0.222222 / 0.099099. |
| `income.total` | Left out: no source gives the 2024 total of this income concept. The page then shows no "share of their income". |

## Income tax: computed or quoted

The baseline profile of wage and assessed income tax is computed by the engine: the 2024 schedule
on `distributions/taxable_income.json` (wage and income tax statistics 2022, projected to 2024;
jointly assessed couples as two persons with half the joint income each), cut at the taxable
incomes below which 50, 90 and 99 % of the 58.5 million units lie (24,093, 58,136 and 181,161 €).
The comparison with the published shares:

| Share of wage and income tax | Bottom half | Next 40 % | Next 9 % | Top 1 % | Top 10 % |
|---|---|---|---|---|---|
| Computed from `taxable_income` (all units) | 4.88 % | 37.22 % | 32.29 % | 25.61 % | 57.90 % |
| Computed, units with positive income only | 5.14 % | 37.22 % | 32.15 % | 25.48 % | 57.63 % |
| BMF Datensammlung 2026, Table 2.2, p. 20 (2026; couples as one taxpayer, ranked by total income) | 6.5 % | 36.6 % | 32.3 % | 24.6 % | 56.9 % |
| DIW kompakt 114, Table 4-9, p. 57 (2008; income tax without company taxes, the base study's groups) | 4.3 % | 37.7 % | 34.9 % | 23.1 % | 57.9 % |
| DIW kompakt 114, Table 4-12, p. 61 (2015; with surcharge and company taxes) | 3.8 % | 36.9 % | 33.3 % | 25.8 % | 59.1 % |
| DIW Wochenbericht 31/2017, p. 633 (persons) | 3.4 % | | | | 56 % |

Table 4-9 is the study's sensitivity calculation with imputed retained profits of corporations; the
shares above are its column "Insgesamt" less "darunter GewSt, KSt" (10.0 / 87.1 / 80.5 / 53.3 of
230.9 bn), the company taxes being what the imputation adds.

The computed shares lie within two points of the published ones. The computed top 1 % (25.6 %) is
above the ministry's (24.6 %) and the DIW's 2008 figure (23.1 %). A likely cause, not tested: the
units are ranked by taxable income, the base of the tax itself, so the top of the ranking holds
exactly those who owe most, while a ranking by total income or by household income per adult puts
some with large deductions or many dependants lower. Counting couples as two persons works the
other way, and the years differ (2024 against 2026 and 2008).

The profile uses the computed shares (0.048778 / 0.37223 / 0.322928 / 0.256064), because the engine
spreads a change of the schedule from the same distribution: with the same basis a proportional
change of all rates leaves the shares exactly as they are, and raising the top rate falls on the
top 1 % only (both tested in `src/engine/incidence.de.test.ts`). The quality is "estimate".

`taxable_income` is named in `incidence.distributions`, so a `schedule` effect on it is computed:
the bottom half of the units stands for the bottom half of the population, and so on. What the
mismatch of units does: the population counts 83.5 million people, children and people without
taxable income included, who are mostly in the bottom half of the population's ranking; the
distribution counts 58.5 million taxpayers. The bottom half of taxpayers is therefore better off
than the bottom half of everybody and pays a little more income tax than the bottom half of the
population would; the per-person amounts divide each group's change by the population's groups
(41.8 million people in the bottom half), not by the taxpayers. The ranking is income per person,
where the population's is income per equivalent adult; for a couple without children the two
differ by the factor 2 / 1.5. `gross_earnings` is not named: it ranks employees liable to pension
insurance by their own wage, without civil servants, pensioners and the self-employed, so a
second earner with a small wage in a rich household would count as the bottom half.

## Profiles

Groups in the order bottom half / next 40 % / next 9 % / top 1 %. Where a source ranks deciles
only, decile 10 is split as stated. "Rate x share" means: the column of Table 4-11 (taxes as a
percentage of the group's gross income) times the group's income share from Table 4-12, summed
over the deciles of each group, which reproduces the printed Table 4-12 shares within 0.1 point.
Surcharge figures are the federal cash result 2024 in million euros (`build_budget.py`, `SOLI`):
on wage tax 4,096.695, on assessed income tax 3,449.587, on corporate tax 2,209.268, on withholding
and flat-rate tax on capital income 1,820.009 + 1,058.735 = 2,878.744.

| Profile | Shares | Source and arithmetic |
|---|---|---|
| `income_tax` | 0.048778 / 0.37223 / 0.322928 / 0.256064 | computed, see above |
| `capital_income` | 0.141556 / 0.259478 / 0.231905 / 0.367061 | kompakt 114, Table 3-7 (p. 38), 2008, "Gewinn- und Kapitaleinkommen" in bn €: deciles 5.7, 8.6, 12.7, 14.1, 16.4 (bottom half 57.5), 17.2, 25.2, 24.8, 38.2 (105.4), decile 10 243.3, top 1 % 149.1; total 406.2. The series also holds the profits of the self-employed and the rental value of owner-occupied homes (p. 30) and, on distributed profits, the company taxes added back (p. 37), so for withholding tax on capital income the lower groups are probably too large. |
| `flat_tax_rise` | 0 / 0.083791 / 0.179945 / 0.736264 | For `capital_income_flat_tax`. DIW kompakt 124 (Bach, Buslei 2017), Table 4-5 (p. 39), 30 % variant, million €, deciles of all taxpayers (couples as one) by total income per equivalent adult (modified OECD scale), each decile 10 % of the population: deciles 1 to 5 0; 6 to 9 3 + 14 + 34 + 71 = 122; 91st to 95th percentile 73 and 96th to 99th 189, 262; top 1 % 1,072; cells sum to 1,456 (printed total 1,457). Year 2017, projected from the income tax statistics of 2008. DIW Wochenbericht 45/2017, p. 1024: more than 90 % on the top decile, 73 to 75 % on the top percentile. |
| `soli_income_tax` | 0.001 / 0.032 / 0.320 / 0.647 | BMF Datensammlung 2026, Table 2.2 (p. 20), column "am Solidaritätszuschlag": bottom 50 % 0.1, top 10 % 96.7, top 1 % 64.7; 100 − 0.1 − 96.7 = 3.2; 96.7 − 64.7 = 32.0. |
| `soli_households` | 0.028926 / 0.077196 / 0.302497 / 0.591381 | The surcharge on wage and assessed income tax (7,546.282) by `soli_income_tax`, plus the households' part of the surcharge on capital income (2,878.744 × 0.649961 = 1,871.079; the households' share of the tax itself, see the node) by `capital_income`, weighted. |
| `soli_capital_corporate` | 0.052056 / 0.095421 / 0.085281 / 0.134983, companies 0.632259 | For effect 2 of `solidarity_surcharge` (the surcharge on capital income and on corporate tax, 2,878.744 + 2,209.268 = 5,088.012): the households' 1,871.079 by `capital_income`, the rest (corporate tax and corporations' withholding tax) to companies. |
| `soli_exempt` | 0.105568 / 0.577081 / 0.317351 / 0 | For effect 1 (the surcharge for those exempt since 2021): 5.5 % of the whole wage and income tax (340,852.718) spread by BMF 2026's income tax shares (6.5 / 36.6 / 32.3 / 24.6 %), less today's 7,546.282 spread by `soli_income_tax`. For the top 1 % this gives slightly less than zero because the two figures are defined differently; as they pay the surcharge in full already, it is set to 0, then normalised. |
| `vat_standard` | 0.355921 / 0.435211 / 0.159788 / 0.04908 | kompakt 114, Table 4-11 column "Mehrwertsteuer, Versich.-steuer", rate x share. Also used for insurance tax. |
| `vat_food_transport` | 0.455545 / 0.417582 / 0.09706 / 0.029813 | DIW Wochenbericht 31/2017, Table 3 (p. 632), EVS 2013, deciles of household net income per equivalent adult, column "Senkung ermäßigter Satz für Nahrungsmittel und ÖPNV um zwei Prozentpunkte": 8.2, 8.8, 9.3, 9.5, 9.8, 10.0, 10.1, 10.5, 11.2, 12.7 (sum 100.1, normalised). Decile 10 split: the top 1 % gets (3.2 x 9.9) / (4.2 x 32.1) = 0.235 of it, the top 1 %'s part of decile 10's VAT in kompakt 114. The EVS does not survey households above 18,000 € of monthly net income (kompakt 114, p. 23) and this table does not correct for it (the Wochenbericht corrects only for its comparison figure), so the top tenth is probably too small. |
| `vat_other_reduced` | 0.316 / 0.461 / 0.170599 / 0.052401 | The same table, column "Abschaffung aller Ermäßigungen außer Nahrungsmittel und ÖPNV": 3.6, 5.1, 6.7, 7.6, 8.6, 9.4, 10.6, 11.6, 14.5, 22.3; decile 10 split as above; the same limit. |
| `energy` | 0.399886 / 0.462729 / 0.123261 / 0.014124 | kompakt 114, Table 4-11 column "Energiesteuern, EEG-Umlage", rate x share. For energy and electricity tax and both CO2 prices. |
| `tobacco_alcohol` | 0.416799 / 0.425983 / 0.145096 / 0.012122 | Column "Tabak- und Alkoholsteuern, Wettsteuer". For tobacco, alcohol and coffee, gambling. |
| `property_motor` | 0.299166 / 0.444063 / 0.166267 / 0.090504 | Column "Grundsteuern, Kfz-Steuer" (Wochenbericht: "Grund-, Kfz- und sonst. Steuern"). For property tax, real estate transfer tax, motor vehicle tax. |
| `contributions` | 0.210592 / 0.561686 / 0.211225 / 0.016497 | Column "Sozialbeiträge", employers' contributions included (borne by employees, p. 16). The column also holds pensioners' contributions (p. 48) and the imputed contributions of civil servants (p. 26), which the pack does not spread with it. The top 1 % pay little because they live mainly on profit and capital income, which carries no contributions (p. 54), and wages carry contributions only up to the ceiling (p. 48). |
| `splitting` | 0.089752 / 0.658397 / 0.226666 / 0.025185 | DIW Wochenbericht 13/2017, Table 1 (p. 251), individual taxation with a transferable basic allowance, all couples, million €: 19, 18, 107, 392, 846 (1,382), 1,376, 1,914, 3,035, 3,813 (10,138), 3,878; total 15,397. Holds for the measure's first slider; the second (ending the transfer of the basic allowance) is spread the same way, for which the study has no column. No top 1 %: it is assumed that the top 1 % pay per person as much as the top tenth on average, a tenth of decile 10. |
| `wealth_tax` | 0 / 0 / 0 / 0.825, unassigned 0.175 | DIW kompakt 211 (Bach, Wichers, Mudrack, 23 January 2026), Table 5-4 (p. 108), 1 %, personal allowance 2 million, no business allowance, adults by gross income per equivalent adult: 1st to 99th percentile 17.5, 99.1 to 99.9 17.9, 99.91 to 99.99 25.6, top 0.01 % 39.0; with 1 million the 1st to 99th 28.0. The table does not say where below the 99th percentile the 17.5 % fall, so they go to no group. The study taxes each person on their own (p. 32), the measure each household, so below the top 1 % the default lies higher still. Replaces kompakt 108 (2016), whose Table 5 (p. 50) put 99 % on the top 1 % with an allowance doubled for couples. |
| `wealth_levy` | 0 / 0 / 0 / 0.997, unassigned 0.003 | DIW kompakt 157, Table 4-7 (p. 54), allowances 2 million and 5 million for business assets, adults, wealth of 2017: 0.3 / 7.8 / 91.9 %; the 0.3 % to no group. Both older studies warn that their income ranking overstates the link between top wealth and top income (kompakt 108, pp. 51 f.; kompakt 157, pp. 47 f.). |
| `abroad_and_companies` | 0 / 0 / 0 / 0, abroad 0.88685, companies 0.11315 | Eurostat National Tax Lists (29 October 2026), sheet DE, 2024: income tax of the rest of the world D51E C01 15,174 and the EU energy crisis contribution D51O C05 1,936, which `build_budget.py` puts together in `rev.taxes.income.other`. |
| `broadcasting_fee` | 0 / 0 / 0 / 0, unassigned 0.908032, companies 0.091968 | The same list: households D59F C03 8,264, enterprises D29H C05 837 (the measure's own note: 0.84 of 9.10 bn). |
| `other_levies` | 0 / 0 / 0 / 0, unassigned 0.846063, companies 0.153937 | The same list, the items of `rev.taxes.consumption.other` (9,270): bank levies and the deposit guarantee fund (D29H C03, C04, C06: 50 + 1,158 + 1) and administrative fees of enterprises (D29E C01: 218) to companies; the rest (levies under the combined heat and power act and for offshore grids 868 + 1,942, tax-like revenue 1,917, entertainment, other local and dog taxes 900 + 569 + 437, households' administrative fees 616, VAT under-compensation 320, oil stockholding 248, other 27) to no group. |

Not used, for the record: the DIW column "Einkommensteuer, Soli, Unternehmensteuern" (0.038 /
0.370 / 0.333 / 0.258) mixes income tax with company taxes; ZEW for the BMF (November 2025) gives
VAT by decile only as charts; Agora Verkehrswende/Öko-Institut (2021) give the company-car
advantage by fifths only ("Rund die Hälfte ... den reichsten zwanzig Prozent", pp. 21 f.), named in
the measure's sentence.

## Nodes and payers

Every revenue leaf has an entry; the lines of the statement add up to the budget's revenue,
2,028.34 bn € in 2024.

| Node (entry) | Spread | Why |
|---|---|---|
| `rev.taxes.income.personal` (wage and assessed income tax) | `income_tax` | computed, see above |
| `rev.taxes.income.capital_income` | 0.649961 by `capital_income`, the rest `companies` | Eurostat tax list 2024: "Kapitalertragsteuer und Zinsabschlag" of households 34,652 (D51M C03), of corporations 18,662 (D51O C02), 35.0 % of 53,314. `build_budget.py` builds the node from both, less the surcharge on them (1,820.009 + 1,058.735), so the split is of the same total. |
| `rev.taxes.income.corporate`, `rev.taxes.income.trade_tax` | payer `companies` | taxes on profits stand on their own; see the payer's note |
| `rev.taxes.income.soli` | 0.74538 by `soli_households`, the rest `companies` | (7,546.282 + 1,871.079) / 12,634.294; the surcharge on corporate tax and on corporations' withholding tax goes to companies |
| `rev.taxes.income.other` | `abroad_and_companies` | non-residents' income tax to `abroad`, the EU energy crisis contribution to `companies` |
| VAT at the standard rate, other goods | 0.793765 by `vat_standard`, the rest `state` | Wochenbericht 31/2017, Table 1 (p. 628): of 208.5 bn standard-rate VAT in 2017 the state pays 43.0 bn on its own purchases and investment; 1 − 43.0 / 208.5. VAT on rental housing and on exempt firms' investment (27.0 bn) stays with households (passed into rents and prices). |
| VAT on restaurant meals | `vat_standard` | private consumption |
| reduced VAT on food, local transport | `vat_food_transport` | |
| reduced VAT on hotels, culture, other | `vat_other_reduced` | |
| energy, electricity, CO2 (national and EU) | `energy` | what firms pay is assumed passed into prices; for the EU ETS a stated convention |
| tobacco, alcohol and coffee, gambling | `tobacco_alcohol` | |
| insurance tax | `vat_standard` | DIW's column holds VAT and insurance tax together |
| motor vehicle, property tax, real estate transfer | `property_motor` | DIW: on homes half owners, half occupants; on commercial property passed into prices (p. 17) |
| broadcasting fee | `broadcasting_fee` | households' fee to no group, enterprises' to companies |
| other consumption taxes and levies | `other_levies` | bank levies and fees of enterprises to companies, the rest to no group |
| air travel, inheritance, sugar drinks, plastic packaging | payer `unassigned` | paid by residents and firms, but no source spreads them by income; DIW leaves inheritance tax and the broadcasting fee out (Wochenbericht 51+52/2016, p. 1210) |
| wealth tax, wealth levy (zero in 2024) | `wealth_tax`, `wealth_levy` | |
| contributions on wages, of the self-employed, voluntary | `contributions` | |
| contributions of the non-employed | payer `pensioners_and_funds` | D613CN, 106.05 bn: health and long-term care contributions of pensioners (with the part the pension insurance pays for them) and contributions that social insurance funds and the federal government pay for benefit recipients, in one line; no document splits them |
| imputed contributions for civil servants | payer `state` | no money flows |
| `rev.other.*` (sales and fees, interest and dividends, transfers, capital transfers, subsidies) | payer `not_a_tax` | |

Payers, in the order the page lists them:

| Payer | 2024, bn € | Made of |
|---|---|---|
| `companies` "Unternehmen" | 140.82 | corporate tax 40.48, trade tax 75.26, corporations' withholding tax 17.65, surcharges on corporate and their withholding tax 3.22, EU energy crisis contribution 1.94, broadcasting fee 0.84, bank levies and fees 1.43 |
| `abroad` "Ausland" | 15.17 | income tax of non-residents |
| `state` "Der Staat selbst" | 103.94 | VAT on its own purchases 55.79, imputed contributions 48.15 |
| `pensioners_and_funds` "Rentner und Sozialkassen, nicht trennbar" | 106.05 | contributions of the non-employed |
| `unassigned` "Keiner Gruppe zugeordnet" | 27.98 | inheritance tax 9.99, households' broadcasting fee 8.26, other levies 7.84, air travel tax 1.88 |
| `not_a_tax` | 264.45 | sales and fees 187.12, interest and dividends 33.65, transfers 31.46, capital transfers 11.98, subsidies 0.23 |

The groups together: 1,369.93 bn, of which taxes 767.39 bn.

Conventions, as the file states them: taxes on consumption are borne by the households that buy;
taxes on company profits are with companies (in the end owners, workers or customers bear them;
research disagrees on the split); employers' contributions are borne by employees, as in DIW. The
DIW puts the corporate tax and trade tax of corporations on the recipients of dividends ("proportional
den Dividendeneinkünften der Privatpersonen zugerechnet", kompakt 114, p. 25) and the trade tax of
sole traders and partnerships on their owners, in each case only on distributed profits. The trade
tax of sole traders and partnerships is largely credited against their income tax (§ 35 EStG,
`estg_35`), so for them it replaces income tax that would otherwise be with the groups. Unlike the
DIW, which counts pensioners' contributions and the imputed contributions of civil servants as
households' burden (kompakt 114, pp. 26 and 48), the pack puts the first in a line of their own,
with the contributions for benefit recipients that the statistics do not separate from them, and
the second with the state; the scope note says so.

## What the German baseline says

| | Bottom half | Next 40 % | Next 9 % | Top 1 % |
|---|---|---|---|---|
| Income (DIW 2016) | 23.9 % | 43.9 % | 22.2 % | 9.9 % |
| Taxes (767.39 bn of 1,007.15 bn spread) | 21.1 % | 39.7 % | 23.3 % | 15.9 % |
| Taxes and contributions (1,369.93 bn of 1,763.89 bn) | 21.1 % | 47.0 % | 22.3 % | 9.6 % |
| Wage and income tax alone (computed) | 4.9 % | 37.2 % | 32.3 % | 25.6 % |

Reconciliation with the published figures: DIW 2016 has the top 1 % paying 16.3 % of the taxes it
covers (Table 4-12), with corporate and trade tax on distributed profits put on dividend recipients
and owners, and without inheritance tax, the broadcasting fee and taxes the state bears itself.
Here the top 1 % pays 15.9 % of the taxes spread over the groups, with company taxes left with
companies. The DIW's own 2008 spread of corporate and trade tax puts 78 % of them on the top 1 %
(Table 4-9, "darunter GewSt, KSt": 1.6 / 4.2 / 6.0 / 41.6 of 53.3 bn); spreading the 117.95 bn of
corporate tax, trade tax and the surcharge on corporate tax that way would give the top 1 % 24.2 %
of 885.3 bn. The figure people quote, "the top 1 % pay a quarter", is the income tax alone: 24.6 %
in the ministry's table for 2026, 25.6 % here.

## Measures

How each of the 29 measures with an effect on revenue is spread. "Node" means like the node's
entry, "own" a profile of its own on the effect, "computed" from `taxable_income`, "payer" that
the change lands outside the groups. A sentence (`incidenceNote`) says who pays where nothing is
spread, and what a spread assumes where that matters.

| Measure | Spread |
|---|---|
| `income_tax_schedule` | computed |
| `solidarity_surcharge` | own: earners `soli_income_tax`, exempt `soli_exempt`, capital and corporate `soli_capital_corporate` |
| `capital_income_flat_tax` | own `flat_tax_rise` (DIW kompakt 124) |
| `corporate_tax_rate` | node (companies); its surcharge effect payer `companies` |
| `spouse_splitting` | own `splitting` (both effects) |
| `wealth_tax`, `wealth_levy` | node (their nodes' profiles, with the part below the top 1 % to no group) |
| `vat_rates`, `vat_hotels_culture_transport` | node, leaf by leaf (the state's part of standard-rate VAT included) |
| `vat_food`, `vat_restaurants` | node, with a sentence: counted as if buyers bore the whole change; by the measures' own catches 70 to 90 % (food, 2020) and about 20 % (restaurants, finance ministry) reach them |
| `fuel_tax` | node (`energy`), with a sentence: 78 to 83 % or about two thirds pass through (the measure's catch), fuel alone is less regressive than the energy profile (DIW Wochenbericht 17/2022, p. 245), and firms got 0.9 of 3.2 bn of the 2022 cut (p. 249) |
| `electricity_tax`, `national_co2_price` | node (`energy`) |
| `tobacco_tax`, `alcohol_taxes` | node (`tobacco_alcohol`) |
| `inheritance_business_relief` | payer `unassigned` (node), with a sentence: 26,508 cases and 17.1 bn € exempted in 2024 (BMF Datensammlung 2026, Table 5.1.2, p. 80) |
| `first_home_transfer_tax` | payer `unassigned`: no source on first-time buyers by income |
| `civil_service_pensions` (wage tax on pensions) | payer `unassigned` |
| `transport_tax_breaks` | payer `unassigned`; the company-car sentence cites Agora Verkehrswende/Öko-Institut (2021): about half the advantage goes to the richest fifth, not split over the groups here |
| `broadcasting_fee_abolish` | node: households' fee to no group, enterprises' to companies, broadcasters' sales `not_a_tax` |
| `early_retirement_45_years`, `retirement_age` | taxes and contributions on wages: payer `unassigned`; contributions of pensioners: node (`pensioners_and_funds`), with a sentence that they are the pensioners' own |
| `sugar_drinks_tax`, `plastic_packaging_tax` | node (`unassigned`) |
| `pension_contribution_schedule`, `health_contribution_schedule` | `incidenceAbove` at today's ceiling (90,600 and 62,100 €): what a higher ceiling raises above it to no group; a different rate up to it like `contributions`; the wage-tax knock-on (a shift) to no group, as a shift cannot be split |
| `pension_insurance_for_all` | `incidenceShare`: the employer's part (the slider, 50 to 100 %) to `state`, the employees' part and the wage-tax knock-on to no group |
| `health_insurance_for_all` | payer `unassigned` |

The results of all measures are unchanged; `incidence`, `incidenceShare`, `incidenceAbove` and
`incidenceNote` only say who pays. The 2026 edition of the Datensammlung revises the splitting
effects of 2024 (Table 2.7.5: 24,172 m instead of 24,304 m); `spouse_splitting` keeps the 2025
edition's figures, as changing them would change the measure's result.

## Open

- The data are of 2015 (income, most profiles), 2013 (reduced VAT), 2017 (splitting, flat-rate
  tax), 2008 (capital income) and 2026 (wealth tax, surcharge), applied to the revenue of 2024.
- No 2015 lower bound for the top 1 %; no 2024 total of the income concept.
- The top 1 %'s part of decile 10 for reduced VAT and splitting is an assumption.
- Energy taxes paid by firms are spread like households' own energy purchases.
- The contributions of pensioners and of funds for benefit recipients cannot be separated.
- Several small taxes and levies are placed in no group.
