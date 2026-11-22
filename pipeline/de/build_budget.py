#!/usr/bin/env python3
"""Builds countries/de/budget.json (general government, Germany, base year 2024).

    python3 pipeline/de/build_budget.py            diagnostics only: level shares per leaf, totals
    python3 pipeline/de/build_budget.py --check    rebuild in memory and compare with the existing budget.json
    python3 pipeline/de/build_budget.py --write    rebuild and replace countries/de/budget.json

Inputs:
  .cache/exp_2024_full.tsv   Eurostat gov_10a_exp, Germany 2024, all sectors, COFOG codes and transactions
                             (written by fetch_inputs.py); read by levels.py
  constants in this file     every other figure. They were read by hand from the sources named next to them;
                             the source ids are those of countries/de/sources.json. Amounts are million euros.

What is data and what is judgement is listed in README.md. In short: amounts are official figures or
differences of official figures; the split across levels of government rests on the seed weights in the
tree below and the payer weights in levels.py, both of which are judgement.
"""
import json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from levels import load_exp, division_targets, ipf, LV

OUT = os.path.normpath(os.path.join(HERE, "..", "..", "countries", "de"))
M = load_exp()
F = division_targets(M)


def cof(code):
    """Total general government expenditure of a COFOG code (Eurostat gov_10a_exp, sector S13, item TE)."""
    return M[(code, "S13")]["TE"]


SRC_EXP = ["eurostat_gov_10a_exp"]
# level vectors are (central, state, local, social_security)
C = (1, 0, 0, 0)
ST = (0, 1, 0, 0)
LO = (0, 0, 1, 0)
SS = (0, 0, 0, 1)

# ---- statutory pensions -------------------------------------------------------------------------------
# drv_rv_in_zahlen_2026, p. 20: pension expenditure 2024 and total expenditure of the pension insurance.
DRV_PENSIONS = 360144.0
RV_TOTAL = 402768.0
# sozialpolitik_aktuell_viii51: shares of old-age / survivors' / disability pensions in 2024 (general scheme).
P_OLD, P_SURV, P_EM = DRV_PENSIONS * 0.799, DRV_PENSIONS * 0.135, DRV_PENSIONS * 0.066
# bundeshaushalt_2024, chapter 1102: all federal payments to the pension insurance (titles 636 81, 636 83,
# 636 84, 636 82, 636 16, 636 12, 636 85, 685 01, 636 14, 636 17), actuals 2024.
FED_TO_RV = 44849.312 + 30835.405 + 18143.398 + 12097.914 + 4881.157 + 3590.529 + 1494.429 + 88.400 + 83.185 + 63.443
FED_RV_SHARE = FED_TO_RV / RV_TOTAL

# interest: split across levels by each subsector's property income paid (D4) in division GF01
d4 = [M[("GF01", s)].get("D4", 0) for s in ["S1311", "S1312", "S1313", "S1314"]]
INTEREST = tuple(x / sum(d4) for x in d4)

# ---- staff of the social insurance funds --------------------------------------------------------------------
# eurostat_gov_10a_exp: compensation of employees (D1) of social security funds (S1314), by COFOG division, 2024.
SS_STAFF_HEALTH = M[("GF07", "S1314")]["D1"]   # 13,530: health and long-term care insurers, their associations, Medical Service
SS_STAFF_SOCIAL = M[("GF10", "S1314")]["D1"]   # 15,404: pension, accident and unemployment insurance
# bmg_kj1_2024: non-staff administrative costs of the health insurers, 2024, all funds (column BUND): gross
# administrative costs (07599) minus personal administrative costs (accounts 07000-07099) minus the fees to the
# funds' associations (07320, 07321), whose staff is already in compensation of employees.
GKV_ADMIN_MATERIAL = 15975.499175 - 10796.8 - 392.591010 - 231.331673

# ---- staff of the general administration of the federal government, the states and the municipalities -------
# eurostat_gov_10a_exp: compensation of employees (D1) in general public services (COFOG 01) by level, 2024.
# Research (01.4, 01.5) and foreign aid (01.2) are taken out first. Research D1 is split across levels like the
# research leaves were fitted before this split (central: 46.37 % of basic research, 41.43 % of R&D, the rest
# state); foreign aid is federal. What is left (central 8,419, state 23,933, local 26,677) is the staff of the
# general administration including the tax administration.
_RES_C = M[("GF0104", "S13")]["D1"] * 0.4637 + M[("GF0105", "S13")]["D1"] * 0.4143
_RES_S = M[("GF0104", "S13")]["D1"] + M[("GF0105", "S13")]["D1"] - _RES_C
_ADMIN_D1 = (M[("GF01", "S1311")]["D1"] - _RES_C - M[("GF0102", "S13")]["D1"],
             M[("GF01", "S1312")]["D1"] - _RES_S,
             M[("GF01", "S1313")]["D1"])
# destatis_personalstand_2024, table 74111-04: full-time equivalents on 30 June 2024 in thousands, all staff and
# of them civil servants: inside = political leadership and central administration (federal, state, local) plus
# foreign affairs (federal); outside = the tax administration (federal including customs, state, local) and the
# Bundestag administration, which is in "Bundestag: other spending" (bt_drs_21_5666: 2,796.5 posts in chapters
# 0212 without police, 0213, 0216, 0217 and 0218, of them 1,425 for civil servants; posts stand in for FTE).
_BT_POSTS, _BT_CIVIL = 2.7965, 1.425
_FTE = ((42.6 + 8.8 - _BT_POSTS, 25.4 + 2.9 - _BT_CIVIL, 51.4 + _BT_POSTS, 45.3 + _BT_CIVIL),
        (153.6, 63.4, 130.2, 109.6),
        (347.0, 66.0, 0.5, 0.0))
# Civil servants carry imputed contributions for their pensions on top of pay (D.122, the counterpart of revenue
# D.612). Per civil-servant FTE: the level's imputed contributions (CIVIL_SERVICE_LEVELS below, from
# eurostat_gov_10a_main) divided by all its civil servants and soldiers (74111-04: 362.9, 1,240.2, 174.8 thousand).
_IMPUTED_PER_FTE = (8779.0 / 362.9, 31948.0 / 1240.2, 4950.0 / 174.8)
ADMIN_STAFF = []          # D1 of the leaves, million euros: central, state, local
ADMIN_STAFF_IMPUTED = []  # of which imputed contributions
for _d1, (_in, _in_civil, _out, _out_civil), _imp in zip(_ADMIN_D1, _FTE, _IMPUTED_PER_FTE):
    _cash_per_fte = (_d1 - _imp * (_in_civil + _out_civil)) / (_in + _out)
    ADMIN_STAFF.append(_cash_per_fte * _in + _imp * _in_civil)
    ADMIN_STAFF_IMPUTED.append(_imp * _in_civil)
# The tax administration and the Bundestag administration are assumed to lie in executive and legislative organs,
# financial and fiscal affairs (01.1); the staff of general services (01.3) and of general public services n.e.c.
# (01.6) is wholly inside. What the leaves take from 01.1 is therefore the rest.
ADMIN_STAFF_0103 = M[("GF0103", "S13")]["D1"]
ADMIN_STAFF_0106 = M[("GF0106", "S13")]["D1"]
ADMIN_STAFF_0101 = sum(ADMIN_STAFF) - ADMIN_STAFF_0103 - ADMIN_STAFF_0106
assert 0 < ADMIN_STAFF_0101 < M[("GF0101", "S13")]["D1"], ADMIN_STAFF_0101
ADMIN_LEVEL_SHARES = [round(x / sum(ADMIN_STAFF), 4) for x in ADMIN_STAFF]
ADMIN_LEVEL_SHARES[2] = round(1 - ADMIN_LEVEL_SHARES[0] - ADMIN_LEVEL_SHARES[1], 4)

# ---- individually named items (cash figures unless stated) ------------------------------------------------
EU_OWN = 27330.0        # eurostat_gov_10a_main: D76PAY, VAT- and GNI-based EU own resources, 2024
MP_PAY = 92.623         # bundeshaushalt_2024: title 0212 411 01, MPs' salaries and office allowances
BUNDESTAG = 1150.396    # bundeshaushalt_2024: budget section 02, Deutscher Bundestag, total
BG_CASH = 29150.930     # bundeshaushalt_2024: title 1101 681 12, Bürgergeld
KDU = 17684.820         # ba_sgb2_zeitreihe, table 6: housing costs, monthly average 2024 (1,473,734,991 euros) x 12
KDU_FED = 12359.620     # bundeshaushalt_2024: title 1101 632 11, federal share of housing and heating costs
ALG1 = 22160.0          # ba_geschaeftsbericht_2024: unemployment benefit 2024
ASYL = 6718.465         # destatis_asylblg_ausgaben: gross expenditure 2024 (revised 24 April 2026)
ELTERNGELD = 7172.430   # bundeshaushalt_2024: title 1701 681 02, parental allowance
GRUSI = 11059.914       # bundeshaushalt_2024: 1102 632 01, reimbursement of basic security in old age and for reduced
                        # earning capacity (SGB XII chapter 4); the federal government reimburses the net expenditure in full
# Child benefit (Kindergeld) under the Income Tax Act. National accounts book as spending only the part of it that goes
# beyond the tax exemption of the child's subsistence minimum (the "Förderkomponente"); the rest reduces taxes, and the
# taxes are grossed up by the spending part (destatis_wista_2019_05, p. 5, table 1). That part is not published for 2024.
# Its share of child benefit paid: 2018 18.7 of 41.6 bn (destatis_wista_2019_05), 2026 25.5 of 55.4 bn (bt_drs_21_8480,
# p. 2). JUDGEMENT: 2024 takes the mean of the two shares (45.5 %), applied to child benefit under the Income Tax Act paid
# in 2024 (ba_famka_2024, table 1.1.2: 54,310.6 million euros; child benefit under the Federal Child Benefit Act, 229.5
# million, is a social benefit in full and stays in the remainder of the family group).
KG_ESTG = 54310.637
KG_SHARE = (18.7 / 41.6 + 25.5 / 55.4) / 2
KG_SPENDING = KG_ESTG * KG_SHARE
# Who bears child benefit: federal government, states and municipalities by their shares of wage tax, 42.5 / 42.5 / 15 %
# (bt_drs_20_12778, p. 37 f.: the cost of a higher child benefit split 335 / 336 / 119 million euros).
KG_LEVELS = (0.425, 0.425, 0.15, 0)
# Zero-amount leaf for benefits that would replace citizen's income for excluded groups; its level shares are
# copied from asylum seekers' benefits after the fit (see below).
REPLACEMENT = "exp.social.basic_security.replacement_benefits"
# ---- items carved out of COFOG groups for measures (million euros) ---------------------------------------------
# bt_drs_21_1600, annex 2, finance aid no. 37 (p. 176): federal payments to the EEG account ("Zuschüsse zur
# Entlastung beim Strompreis", KTF chapter 6092 title 683 07, since 2025 chapter 6002), actuals 2024. In national
# accounts a subsidy (D.3) on fuel and energy (COFOG 04.3, subsidies 26,286 in 2024).
EEG_2024 = 18488.9
# bh_haushalt_2026_epl60, annex 3 (KTF), title 893 10 (function 411), actuals 2024: the federal funding for
# efficient buildings (BEG). JUDGEMENT: where national accounts book these grants is not published. The federal
# budget files them under housing, but housing development (COFOG 06.1) has capital transfers of only 3,267 in 2024
# at all levels; general economic affairs (04.1) is the only group with room for them (capital transfers 21,541).
BEG_2024 = 14116.820
# bt_drs_21_4498 and § 9(2) RegG: 1,500 a year from the federal government for the Deutschlandticket, and at least
# as much from the states. The federal part is paid with the regionalisation funds (6001 031 05) moved below.
DTICKET_FED = 1500.0
DTICKET = 2 * DTICKET_FED
# kef_25_bericht, table 6 (p. 32): spending of ARD, ZDF and Deutschlandradio relevant to their funding need, actuals
# 2021 to 2024, 38,504.7 in four years. JUDGEMENT: the yearly average stands for their spending in 2024.
BROADCASTERS = 38504.7 / 4
# kef_25_bericht, table 5 (p. 31): the broadcasters' market income recognised for 2025 to 2028, in four years:
# advertising 1,037.9, sponsorship 159.1, reimbursements 418.8, other operating income 2,241.1, other 239.7. Left out:
# financial income (685.1; most of it from the funds that cover the pensions, Tz. 537), income from holdings (103.0) and
# returns from the state media authorities (178.1, a transfer within the state). JUDGEMENT: the yearly average stands for
# the market output (P.11) of 2024 that national accounts book in the state level's sales; carved out of rev.other.sales.
BROADCASTERS_SALES = (1037.9 + 159.1 + 418.8 + 2241.1 + 239.7) / 4
# hu_staatsleistungen_2024 (= fowid_staatsleistungen, row 2024): payments of the 14 paying states to the Protestant
# and Catholic churches under Article 140 GG / Article 138(1) WRV, budgeted amounts 2024 (618,361,500 euros).
STAATSLEISTUNGEN = 618.3615
# Each item is a fixed leaf; the rest of its group stays a fitted leaf. The seeds of those remainders are chosen so
# that the fit leaves every other leaf of the division as it was before the split: the group's earlier allocation by
# level, minus the item, divided by the division's column factors of the fit (read off an untouched leaf: GF04
# 1 : 0.8925 : 1.297 : 0.686, GF08 1 : 1.39 : 1.795). The other leaves' shares then move by at most 0.0002.
# Where civil servants are employed, approximated by the imputed social contributions of each level
# (eurostat_gov_10a_main: D61REC minus actual contributions, 2024): central, state, local, social security funds.
CIVIL_SERVICE_LEVELS = (8779.0, 31948.0, 4950.0, 711072.0 - 302350.0 - 406246.0)

# ---- items carved out of a fitted leaf after the fit (see carve() below) ---------------------------------------
# Civil servants' pensions. destatis_pm_2025_455: spending 2024 on pensions (Ruhegehalt) of former public servants
# 56.9 bn, on survivors' benefits 9.0 bn (Versorgungsempfängerstatistik). destatis_versorgungsausgaben_2024: shares of
# the employers in Versorgungsausgaben 2024: Länder 61.9, Bund 11.2, Post successor companies 11.0, municipalities 8.5,
# Bundeseisenbahnvermögen 5.3, other 2.1 %. "Other" is the social insurance (28.4 thousand recipients on 1 January
# 2025) and legally independent federal bodies (8.8 thousand; destatis_versorgungsempfaenger_2025), split by
# recipients. Post and railway pensions are paid by federal bodies. JUDGEMENT: survivors' benefits get the shares of
# all spending, although survivors are more often federal (Bundesbereich: 153.2 of 382.1 thousand survivors, 40.1 %,
# against 424.4 of 1,418.8 thousand pensioners, 29.9 %).
# JUDGEMENT: the carve-out runs after the fit, so the remainders keep what the fit gave their division at each level
# minus the carved shares (see pipeline/de/README.md).
CS_PENSIONS, CS_SURVIVORS = 56900.0, 9000.0
_CS_OTHER_SS = 2.1 * 28.4 / (28.4 + 8.8)
CS_LEVELS = ((11.2 + 11.0 + 5.3 + 2.1 - _CS_OTHER_SS) / 100, 61.9 / 100, 8.5 / 100, _CS_OTHER_SS / 100)
# Federal programmes for democracy. bundeshaushalt_2024: title 1702 684 04 "Maßnahmen zur Stärkung von Vielfalt,
# Toleranz und Demokratie", actuals 2024, which funds "Demokratie leben!" and "Menschen stärken Menschen"
# (bh_epl17_2024: 182.0 and 18.0 of 200.0 m planned). The federal budget books the title under function 165, research
# and experimental development outside universities; national accounts do not publish where it lands. JUDGEMENT: it is
# taken out of basic research (COFOG 01.4), where research funding of the federal government not tied to a field is.
DEMOCRACY_PROGRAMMES = 182.912


def L(id, de, en, amount=None, code=None, seed=None, fixed=None, quality=None, sources=None, note=None, desc=None, year=None):
    return dict(id=id, de=de, en=en, amount=amount, code=code, seed=seed, fixed=fixed, quality=quality,
                sources=sources, note=note, desc=desc, year=year)


def G(id, de, en, children, code=None, desc=None):
    return dict(id=id, de=de, en=en, children=children, code=code, desc=desc)


def CL(id, code, de, en, seed, **kw):
    return L(id, de, en, amount=cof(code), code=code, seed=seed, **kw)


EXP = [
    G("exp.general", "Allgemeine Verwaltung, Schulden und Internationales", "General administration, debt and international affairs", code="GF01", children=[
        G("exp.general.executive", "Regierung, Parlamente, Finanzverwaltung und Auswärtiges", "Government, parliaments, tax administration and foreign affairs", code="GF0101", children=[
            L("exp.general.executive.eu_contribution", "EU-Beitrag (Eigenmittel aus Mehrwertsteuer und Wirtschaftsleistung)", "EU contribution (own resources based on VAT and national income)",
              amount=EU_OWN, fixed=C, quality="official", sources=["eurostat_gov_10a_main", "bundeshaushalt_2024"], code="D76",
              desc=("Deutschlands Zahlungen an den EU-Haushalt aus Mehrwertsteuer- und BNE-Eigenmitteln. Zölle, die Deutschland für die EU erhebt, zählen nicht zu den Staatseinnahmen und sind hier nicht enthalten.",
                    "Germany's payments to the EU budget from VAT-based and GNI-based own resources. Customs duties collected on behalf of the EU are not government revenue and are not included."),
              # bundeshaushalt_2024, actuals of titles 6001 021 01 (VAT, 5,447.8 m), 6001 022 02 (GNI, 19,722.4 m) and
              # 6001 022 03 (plastics, 1,377.6 m): VAT + GNI 25.17 bn, with plastics 26.55 bn, against D76 of 27.33 bn.
              note=("Betrag aus der aktuellen Datenlieferung (Oktober 2026); die funktionale Gliederung beruht auf einem etwas älteren Datenstand. Ob auch die Plastikabgabe an die EU (2024: 1,38 Mrd. Euro, Kasse, Titel 6001 022 03) in diesem Betrag enthalten ist, lässt sich der Statistik nicht sicher entnehmen; der Abgleich mit den Kassenzahlen des Bundes (Mehrwertsteuer- und BNE-Eigenmittel 2024: 25,17 Mrd. Euro) spricht eher dafür.",
                    "Amount from the latest data release (October 2026); the breakdown by function is based on a slightly older vintage. Whether the plastics contribution to the EU (2024: €1.38bn, cash, title 6001 022 03) is included in this amount cannot be told for certain from the statistics; a comparison with the federal cash figures (VAT- and GNI-based own resources 2024: €25.17bn) suggests that it is.")),
            L("exp.general.executive.bundestag_mp_pay", "Bundestag: Diäten der Abgeordneten", "Bundestag: MPs' pay",
              amount=MP_PAY, fixed=C, quality="official", sources=["bundeshaushalt_2024"],
              desc=("Entschädigungen und Amtszulagen nach § 11 Abgeordnetengesetz, Ist 2024. Ohne Kostenpauschale, Mitarbeiter und Altersversorgung.",
                    "Salaries and office allowances under section 11 of the Members of the Bundestag Act, 2024 actuals. Excludes the expense allowance, staff and pensions."),
              note=("Kassenwert aus dem Bundeshaushalt (Titel 0212 411 01).", "Cash figure from the federal budget (title 0212 411 01).")),
            L("exp.general.executive.bundestag_other", "Bundestag: übrige Ausgaben", "Bundestag: other spending",
              amount=BUNDESTAG - MP_PAY, fixed=C, quality="derived", sources=["bundeshaushalt_2024"],
              desc=("Mitarbeiter der Abgeordneten, Fraktionen, Verwaltung, Gebäude, Kostenpauschale, Altersversorgung.", "MPs' staff, parliamentary groups, administration, buildings, expense allowance, pensions."),
              note=("Einzelplan 02 (1.150,4 Mio. Euro, Ist 2024) abzüglich der Diäten.", "Budget section 02 (€1,150.4m, 2024 actuals) minus MPs' pay.")),
            L("exp.general.executive.other", "Finanzämter, Zoll und übrige Ausgaben von Regierung, Parlamenten und Auswärtigem Dienst", "Tax offices, customs and other spending of government, parliaments and the foreign service",
              amount=cof("GF0101") - EU_OWN - BUNDESTAG - ADMIN_STAFF_0101, seed=(0.30, 0.35, 0.35, 0), quality="estimate",
              sources=SRC_EXP + ["eurostat_gov_10a_main", "bundeshaushalt_2024", "destatis_personalstand_2024"],
              desc=("Vor allem das Personal der Finanzverwaltung (Finanzämter der Länder, Zoll und Bundeszentralamt für Steuern) und Sachausgaben von Regierungen, Parlamenten und Auswärtigem Dienst. Ihr übriges Personal steht unter „Personal der allgemeinen Verwaltung“.",
                    "Mainly the staff of the tax administration (the states' tax offices, customs and the Federal Central Tax Office) and non-staff spending of governments, parliaments and the foreign service. Their other staff is under 'Staff of the general administration'."),
              note=("Rest der Gruppe nach Abzug von EU-Beitrag, Bundestag und dem Personal der allgemeinen Verwaltung, soweit es hier gebucht ist (eigene Schätzung, siehe dort); Aufteilung auf die Ebenen geschätzt.",
                    "Remainder of the group after deducting the EU contribution, the Bundestag and the staff of the general administration booked here (own estimate, see there); split across levels estimated.")),
        ]),
        G("exp.general.admin_staff", "Personal der allgemeinen Verwaltung", "Staff of the general administration",
          desc=("Personal in der politischen Führung und zentralen Verwaltung von Bund, Ländern, Gemeinden und Kreisen und im Auswärtigen Dienst: Arbeitnehmerentgelt einschließlich der unterstellten Beiträge für die Versorgung der Beamten. Nicht enthalten sind Finanzverwaltung, Bundestagsverwaltung, Polizei und Ordnungsverwaltung, Justiz, Schulen, Hochschulen, Forschung und die Verwaltung anderer Fachbereiche.",
                "Staff in the political leadership and central administration of the federal government, the states, the municipalities and districts, and in the foreign service: compensation of employees including the imputed contributions for civil servants' pensions. Not included are the tax administration, the Bundestag administration, police and public-order administration, the courts, schools, universities, research and the administration of other specialist fields."),
          children=[
            L("exp.general.admin_staff.federal", "Bund: Ministerien, zentrale Verwaltung und Auswärtiger Dienst", "Federal: ministries, central administration and foreign service",
              amount=ADMIN_STAFF[0], fixed=C, quality="estimate", sources=SRC_EXP + ["eurostat_gov_10a_main", "destatis_personalstand_2024", "bt_drs_21_5666"],
              desc=("Rund 48.600 Vollzeitstellen, gut 51.000 Beschäftigte (Juni 2024): Bundeskanzleramt, Ministerien, Bundespräsidialamt, Bundesrat, zentrale Bundesbehörden wie Bundesverwaltungsamt und Statistisches Bundesamt, Auswärtiger Dienst. Ohne Bundestagsverwaltung, Zoll und übrige Finanzverwaltung, Bundespolizei, Bundeswehrverwaltung und Fachbehörden anderer Bereiche.",
                    "About 48,600 full-time equivalents, a little over 51,000 employees (June 2024): Federal Chancellery, ministries, Office of the Federal President, Bundesrat, central federal agencies such as the Federal Office of Administration and the Federal Statistical Office, foreign service. Without the Bundestag administration, customs and the rest of the tax administration, the federal police, the armed forces' civilian administration and specialist agencies of other fields."),
              note=("Eigene Schätzung: Arbeitnehmerentgelt des Bundes in der allgemeinen öffentlichen Verwaltung ohne Forschung und Entwicklungshilfe (8,42 Mrd. Euro), nach Vollzeitstellen der Personalstandstatistik aufgeteilt zwischen politischer Führung, zentraler Verwaltung und Auswärtigem Dienst (51.400 Vollzeitstellen ohne 2.800 Stellen der Bundestagsverwaltung) und Finanzverwaltung (51.400); Beamte tragen dabei die unterstellten Beiträge für ihre Versorgung, 24.200 Euro je Vollzeitstelle. Davon 0,65 Mrd. Euro unterstellte Beiträge.",
                    "Own estimate: federal compensation of employees in general public services without research and development aid (€8.42bn), split by full-time equivalents of the personnel statistics between political leadership, central administration and foreign service (51,400 full-time equivalents less 2,800 posts of the Bundestag administration) and the tax administration (51,400); civil servants carry the imputed contributions for their pensions, €24,200 per full-time equivalent. Of this, €0.65bn are imputed contributions.")),
            L("exp.general.admin_staff.states", "Länder: Ministerien und zentrale Verwaltung", "States: ministries and central administration",
              amount=ADMIN_STAFF[1], fixed=ST, quality="estimate", sources=SRC_EXP + ["eurostat_gov_10a_main", "destatis_personalstand_2024"],
              desc=("153.600 Vollzeitstellen, 166.700 Beschäftigte (Juni 2024): Staatskanzleien, Ministerien, Landtage, Mittelbehörden wie Regierungspräsidien und zentrale Dienste der Länder. Ohne Finanzämter, Polizei, Justiz, Schulen und Hochschulen.",
                    "153,600 full-time equivalents, 166,700 employees (June 2024): state chancelleries, ministries, state parliaments, intermediate authorities such as regional governments, and the states' central services. Without tax offices, police, courts, schools and universities."),
              note=("Eigene Schätzung: Arbeitnehmerentgelt der Länder in der allgemeinen öffentlichen Verwaltung ohne Forschung (23,93 Mrd. Euro), nach Vollzeitstellen aufgeteilt zwischen politischer Führung und zentraler Verwaltung (153.600) und Finanzverwaltung (130.200); Beamte tragen dabei die unterstellten Beiträge für ihre Versorgung, 25.800 Euro je Vollzeitstelle. Davon 1,63 Mrd. Euro unterstellte Beiträge.",
                    "Own estimate: the states' compensation of employees in general public services without research (€23.93bn), split by full-time equivalents between political leadership and central administration (153,600) and the tax administration (130,200); civil servants carry the imputed contributions for their pensions, €25,800 per full-time equivalent. Of this, €1.63bn are imputed contributions.")),
            L("exp.general.admin_staff.municipal", "Gemeinden und Kreise: zentrale Verwaltung", "Municipalities and districts: central administration",
              amount=ADMIN_STAFF[2], fixed=LO, quality="estimate", sources=SRC_EXP + ["eurostat_gov_10a_main", "destatis_personalstand_2024"],
              desc=("347.000 Vollzeitstellen, 394.800 Beschäftigte (Juni 2024): Räte und Verwaltungsspitze, Haupt-, Personal- und Finanzverwaltung, IT und Gebäudemanagement der Gemeinden und Kreise. Ohne Sicherheit und Ordnung (Ordnungsämter und Feuerwehr), Kitas, Sozial- und Jugendämter.",
                    "347,000 full-time equivalents, 394,800 employees (June 2024): councils and administrative leadership, general, personnel and finance administration, IT and building management of municipalities and districts. Without public safety and order (public-order offices and fire services), day care, or social and youth welfare offices."),
              note=("Eigene Schätzung: Arbeitnehmerentgelt der Gemeinden in der allgemeinen öffentlichen Verwaltung (26,68 Mrd. Euro) ohne den Anteil ihrer Finanzverwaltung (500 Vollzeitstellen); Beamte tragen dabei die unterstellten Beiträge für ihre Versorgung, 28.300 Euro je Vollzeitstelle. Davon 1,87 Mrd. Euro unterstellte Beiträge.",
                    "Own estimate: the municipalities' compensation of employees in general public services (€26.68bn) less the share of their tax administration (500 full-time equivalents); civil servants carry the imputed contributions for their pensions, €28,300 per full-time equivalent. Of this, €1.87bn are imputed contributions.")),
          ]),
        CL("exp.general.foreign_aid", "GF0102", "Entwicklungshilfe und wirtschaftliche Auslandshilfe", "Development aid and foreign economic aid", None, fixed=C, quality="derived",
           note=("Betrag amtlich (Eurostat). Vollständig dem Bund zugeordnet, der für die Entwicklungszusammenarbeit zuständig ist; kleinere Beiträge der Länder sind nicht gesondert ausgewiesen.", "Official amount (Eurostat). Attributed entirely to the federal level, which is responsible for development cooperation; smaller contributions by the states are not shown separately."),
           desc=("Abgrenzung der Staatsausgabenstatistik (COFOG 01.2). Die international gemeldete Entwicklungshilfe (ODA) ist anders abgegrenzt und höher, weil sie zum Beispiel Kosten für Geflüchtete im Inland mitzählt.",
                 "As defined in government expenditure statistics (COFOG 01.2). Official development assistance (ODA) as reported internationally is defined differently and is higher, for example because it counts the cost of refugees in the donor country.")),
        L("exp.general.general_services", "Allgemeine Dienste ohne Personalkosten (Personal-, Planungs- und Statistikämter, zentrale Verwaltung)", "General services excluding staff costs (personnel, planning and statistical offices, central administration)",
          amount=cof("GF0103") - ADMIN_STAFF_0103, code="GF0103", seed=(0.25, 0.35, 0.40, 0), sources=SRC_EXP,
          note=("Betrag amtlich (Eurostat), abzüglich des ebenfalls amtlichen Arbeitnehmerentgelts dieser Gruppe (28,83 Mrd. Euro), das unter „Personal der allgemeinen Verwaltung“ steht. Die Aufteilung auf die Ebenen ist aus den Eurostat-Daten je Aufgabenbereich abgeleitet und innerhalb des Bereichs geschätzt.",
                "Official amount (Eurostat), less this group's compensation of employees (€28.83bn, also official), which is under 'Staff of the general administration'. The split across levels is derived from Eurostat data per division and estimated within the division.")),
        CL("exp.general.basic_research", "GF0104", "Grundlagenforschung", "Basic research", (0.55, 0.45, 0, 0)),
        CL("exp.general.rd", "GF0105", "Forschung zur öffentlichen Verwaltung", "Research on public administration", (0.5, 0.5, 0, 0)),
        L("exp.general.other", "Sonstige allgemeine Verwaltung ohne Personalkosten", "Other general administration excluding staff costs",
          amount=cof("GF0106") - ADMIN_STAFF_0106, code="GF0106", seed=(0.2, 0.3, 0.5, 0.01), sources=SRC_EXP,
          note=("Betrag amtlich (Eurostat), abzüglich des ebenfalls amtlichen Arbeitnehmerentgelts dieser Gruppe (3,20 Mrd. Euro), das unter „Personal der allgemeinen Verwaltung“ steht. Die Aufteilung auf die Ebenen ist aus den Eurostat-Daten je Aufgabenbereich abgeleitet und innerhalb des Bereichs geschätzt.",
                "Official amount (Eurostat), less this group's compensation of employees (€3.20bn, also official), which is under 'Staff of the general administration'. The split across levels is derived from Eurostat data per division and estimated within the division.")),
        CL("exp.general.interest", "GF0107", "Zinsen auf Staatsschulden", "Interest on public debt", None, fixed=INTEREST, quality="official",
           note=("Aufteilung nach den Zinsausgaben der Ebenen laut Eurostat.", "Split according to each level's interest expenditure as reported by Eurostat.")),
    ]),
    G("exp.defence", "Verteidigung", "Defence", code="GF02",
      desc=("Abgrenzung der Staatsausgabenstatistik (COFOG). Nach NATO-Definition, die unter anderem Pensionen ehemaliger Soldaten einrechnet, liegen die Verteidigungsausgaben deutlich höher.",
            "As defined in government expenditure statistics (COFOG). Under the NATO definition, which also counts items such as military pensions, defence spending is considerably higher."),
      children=[
        CL("exp.defence.military", "GF0201", "Bundeswehr (militärische Verteidigung)", "Armed forces (military defence)", None, fixed=C, quality="official"),
        CL("exp.defence.civil", "GF0202", "Zivilschutz", "Civil defence", None, fixed=C, quality="official"),
        CL("exp.defence.foreign_military_aid", "GF0203", "Militärhilfe für andere Staaten (v. a. Ukraine)", "Military aid to other countries (mainly Ukraine)", None, fixed=C, quality="official"),
        CL("exp.defence.rd", "GF0204", "Wehrforschung", "Defence research", None, fixed=C, quality="official"),
        CL("exp.defence.other", "GF0205", "Sonstige Verteidigung", "Other defence", None, fixed=C, quality="official"),
    ]),
    G("exp.safety", "Öffentliche Sicherheit und Justiz", "Public order, safety and justice", code="GF03", children=[
        CL("exp.safety.police", "GF0301", "Polizei", "Police", (0.2, 0.78, 0.02, 0)),
        CL("exp.safety.fire", "GF0302", "Feuerwehr", "Fire services", (0.02, 0.08, 0.90, 0)),
        CL("exp.safety.courts", "GF0303", "Gerichte und Staatsanwaltschaften", "Courts and public prosecutors", (0.07, 0.93, 0, 0)),
        CL("exp.safety.prisons", "GF0304", "Gefängnisse", "Prisons", None, fixed=ST, quality="derived",
           note=("Betrag amtlich (Eurostat). Den Ländern zugeordnet, die für den Justizvollzug zuständig sind.", "Official amount (Eurostat). Attributed to the states, which are responsible for the prison system.")),
        CL("exp.safety.rd", "GF0305", "Forschung zu Sicherheit und Justiz", "Research on safety and justice", (0.5, 0.5, 0, 0)),
        CL("exp.safety.other", "GF0306", "Sonstige Sicherheit und Ordnung", "Other public order and safety", (0.3, 0.3, 0.4, 0)),
    ]),
    G("exp.economy", "Wirtschaft, Verkehr und Energie", "Economy, transport and energy", code="GF04", children=[
        G("exp.economy.general_labour", "Wirtschafts- und Arbeitsmarktförderung (u. a. Gebäudeförderung des Bundes)", "Business and labour market support (incl. federal building grants)", code="GF0401", children=[
            L("exp.economy.general_labour.beg", "Gebäudeförderung des Bundes (BEG): Sanierung und Heizungstausch", "Federal funding for efficient buildings (BEG): renovation and heating replacement",
              amount=BEG_2024, fixed=C, quality="derived", sources=["bh_haushalt_2026_epl60", "bundestag_drs_21_7301", "eurostat_gov_10a_exp"],
              desc=("Zuschüsse und Tilgungszuschüsse der Bundesförderung für effiziente Gebäude über KfW und BAFA: Einzelmaßnahmen wie der Tausch der Heizung oder die Dämmung und die Sanierung von Wohn- und Nichtwohngebäuden zum Effizienzhaus. Neue Gebäude fördert inzwischen ein eigenes Programm (Klimafreundlicher Neubau). Bezahlt aus dem Klima- und Transformationsfonds.",
                    "Grants and repayment grants of the federal funding for efficient buildings through KfW and BAFA: individual measures such as replacing the heating or insulation, and renovating residential and non-residential buildings to an efficiency house standard. New buildings are now funded by a programme of their own (climate-friendly new construction). Paid from the Climate and Transformation Fund."),
              note=("Kassenwert: Ausgaben des Klima- und Transformationsfonds für Energieeffizienz und erneuerbare Energien im Gebäudebereich 2024 (Kapitel 6092 Titel 893 10, 14,12 Mrd. Euro). Wo die Volkswirtschaftlichen Gesamtrechnungen diese Zuschüsse buchen, ist nicht veröffentlicht. Der Bundeshaushalt ordnet sie dem Wohnungswesen zu, doch die Wohnungsbauförderung (COFOG 06.1) weist 2024 auf allen Ebenen zusammen nur 3,3 Mrd. Euro Vermögenstransfers aus. Angenommen ist deshalb die allgemeine Wirtschaftsförderung (COFOG 04.1) mit 21,5 Mrd. Euro Vermögenstransfers; aus ihr ist der Posten herausgelöst. Ganz dem Bund zugeordnet.",
                    "Cash figure: spending of the Climate and Transformation Fund on energy efficiency and renewable energy in buildings in 2024 (chapter 6092 title 893 10, €14.12bn). Where national accounts book these grants is not published. The federal budget files them under housing, but housing development (COFOG 06.1) shows only €3.3bn of capital transfers in 2024 at all levels together. General economic affairs (COFOG 04.1), with €21.5bn of capital transfers, is therefore assumed; the item is taken out of it. Attributed entirely to the federal level.")),
            L("exp.economy.general_labour.other", "Übrige Wirtschafts- und Arbeitsmarktförderung", "Other business and labour market support",
              amount=cof("GF0401") - BEG_2024, seed=(0.1436, 0.3113, 0.1555, 0.3896), quality="estimate", sources=SRC_EXP + ["bh_haushalt_2026_epl60"],
              desc=("Unter anderem Arbeitsmarktpolitik der Bundesagentur für Arbeit, regionale Wirtschaftsförderung und Förderprogramme von Bund und Ländern.",
                    "Among other things the Federal Employment Agency's labour market policy, regional economic development and support programmes of the federal government and the states."),
              note=("Rest der Gruppe (COFOG 04.1) nach Abzug der Gebäudeförderung des Bundes; Aufteilung auf die Ebenen geschätzt.",
                    "Remainder of the group (COFOG 04.1) after deducting the federal funding for efficient buildings; split across levels estimated.")),
        ]),
        CL("exp.economy.agriculture", "GF0402", "Land- und Forstwirtschaft, Fischerei", "Agriculture, forestry and fishing", (0.4, 0.5, 0.1, 0)),
        G("exp.economy.energy", "Energie (u. a. Förderung erneuerbarer Energien, Preisbremsen)", "Energy (incl. support for renewables, price brakes)", code="GF0403", children=[
            L("exp.economy.energy.eeg", "Förderung erneuerbarer Energien nach dem EEG (Zahlungen des Bundes an das EEG-Konto)", "Support for renewable energy under the EEG (federal payments to the EEG account)",
              amount=EEG_2024, fixed=C, quality="official", sources=["bt_drs_21_1600", "bh_haushalt_2027_epl60", "eurostat_gov_10a_exp"],
              desc=("Seit 2023 zahlt der Bund den Übertragungsnetzbetreibern, was die Förderung nach dem Erneuerbare-Energien-Gesetz kostet: die Differenz zwischen den garantierten Vergütungen und Marktprämien der Anlagen und dem Erlös ihres Stroms an der Börse. Vorher trugen das die Stromkunden über die EEG-Umlage.",
                    "Since 2023 the federal government pays the transmission system operators what support under the Renewable Energy Sources Act (EEG) costs: the difference between the plants' guaranteed feed-in payments and market premiums and what their power fetches on the exchange. Before, electricity customers bore this through the EEG surcharge."),
              note=("Kassenwert laut Subventionsbericht (Finanzhilfe Nr. 37): 18,49 Mrd. Euro im Jahr 2024, damals aus dem Klima- und Transformationsfonds (Kapitel 6092 Titel 683 07); seit 2025 im Kernhaushalt (Kapitel 6002 Titel 683 07: Ist 2025 16,49 Mrd. Euro, Soll 2026 16,16 Mrd. Euro, Entwurf 2027 16,5 Mrd. Euro). In den Volkswirtschaftlichen Gesamtrechnungen eine Subvention im Bereich Energie (COFOG 04.3), dessen Subventionen 2024 26,3 Mrd. Euro betrugen; aus ihm ist der Posten herausgelöst. Ganz dem Bund zugeordnet.",
                    "Cash figure according to the Subsidy Report (finance aid no. 37): €18.49bn in 2024, then from the Climate and Transformation Fund (chapter 6092 title 683 07); since 2025 in the core budget (chapter 6002 title 683 07: 2025 actuals €16.49bn, 2026 target €16.16bn, 2027 draft €16.5bn). In national accounts a subsidy in fuel and energy (COFOG 04.3), whose subsidies came to €26.3bn in 2024; the item is taken out of it. Attributed entirely to the federal level.")),
            L("exp.economy.energy.other", "Übrige Ausgaben für Energie (u. a. Strompreiskompensation, Abwicklung der Preisbremsen)", "Other energy spending (incl. electricity price compensation, settlement of the price brakes)",
              amount=cof("GF0403") - EEG_2024, seed=(0.7999, 0.1251, 0.0750, 0), quality="estimate", sources=SRC_EXP + ["bt_drs_21_1600", "bh_haushalt_2026_epl60"],
              note=("Rest der Gruppe (COFOG 04.3) nach Abzug der EEG-Zahlungen. Darunter die Strompreiskompensation für stromintensive Unternehmen (2024: 2,40 Mrd. Euro aus dem Klima- und Transformationsfonds). Aufteilung auf die Ebenen geschätzt.",
                    "Remainder of the group (COFOG 04.3) after deducting the EEG payments. It includes the electricity price compensation for electricity-intensive companies (2024: €2.40bn from the Climate and Transformation Fund). Split across levels estimated.")),
        ]),
        CL("exp.economy.industry", "GF0404", "Bergbau, Industrie und Bau", "Mining, manufacturing and construction", (0.5, 0.4, 0.1, 0)),
        G("exp.economy.transport", "Verkehr (Straßen, Schiene, Nahverkehr)", "Transport (roads, rail, local public transport)", code="GF0405", children=[
            L("exp.economy.transport.deutschlandticket", "Deutschlandticket: Ausgleich der Mindereinnahmen durch Bund und Länder", "Deutschlandticket: compensation of the revenue loss by the federal government and the states",
              amount=DTICKET, fixed=ST, quality="derived", sources=["bt_drs_21_4498", "bt_drs_21_2639", "stmb_dt_prognose_2024", "bundeshaushalt_2024"],
              desc=("Bund und Länder gleichen den Verkehrsunternehmen aus, was sie durch das Deutschlandticket weniger einnehmen als mit den früheren Tarifen; Bund und Länder zahlen je 1,5 Mrd. Euro im Jahr. Im Basisjahr 2024 kostete das Ticket 49 Euro im Monat.",
                    "The federal government and the states compensate transport companies for what they earn less with the Deutschlandticket than with the earlier fares; each pays €1.5bn a year. In the base year 2024 the ticket cost €49 a month."),
              note=("Gesetzlicher Betrag (§ 9 Regionalisierungsgesetz): je 1,5 Mrd. Euro von Bund und Ländern. Den Ausgleichsbedarf für 2024 schätzte eine Arbeitsgruppe der Länder auf rund 3,46 Mrd. Euro; der Rest kam aus nicht verbrauchten Mitteln von 2023. Die Länder zahlen aus, der Bundesanteil ist dem Bund zugerechnet. Aus dem Bereich Verkehr (COFOG 04.5) herausgelöst.",
                    "Statutory amount (section 9 of the Regionalisation Act): €1.5bn each from the federal government and the states. A working group of the states estimated the compensation needed for 2024 at about €3.46bn; the rest came from unspent funds of 2023. The states pay out; the federal share is attributed to the federal level. Taken out of transport (COFOG 04.5).")),
            L("exp.economy.transport.other", "Straßen, Schiene, Nahverkehr und übriger Verkehr", "Roads, rail, local public transport and other transport",
              amount=cof("GF0405") - DTICKET, seed=(0.4128, 0.2259, 0.3612, 0), quality="derived", sources=SRC_EXP + ["bundeshaushalt_2024"],
              note=("Rest der Gruppe (COFOG 04.5) nach Abzug des Ausgleichs für das Deutschlandticket. Betrag amtlich (Eurostat); die Aufteilung auf die Ebenen ist aus den Eurostat-Daten je Aufgabenbereich abgeleitet und innerhalb des Bereichs geschätzt.",
                    "Remainder of the group (COFOG 04.5) after deducting the compensation for the Deutschlandticket. Official amount (Eurostat); the split across levels is derived from Eurostat data per division and estimated within the division.")),
        ]),
        CL("exp.economy.communication", "GF0406", "Telekommunikation und Breitband", "Telecommunications and broadband", (0.8, 0.15, 0.05, 0)),
        CL("exp.economy.other_industries", "GF0407", "Handel, Tourismus und sonstige Branchen", "Trade, tourism and other industries", (0.5, 0.3, 0.2, 0)),
        CL("exp.economy.rd", "GF0408", "Angewandte Forschung für die Wirtschaft", "Applied research for the economy", (0.7, 0.3, 0, 0)),
        CL("exp.economy.other", "GF0409", "Sonstige Wirtschaftsangelegenheiten", "Other economic affairs", (0.3, 0.3, 0.35, 0.05)),
    ]),
    G("exp.environment", "Umweltschutz", "Environmental protection", code="GF05", children=[
        CL("exp.environment.waste", "GF0501", "Abfallentsorgung", "Waste management", (0.03, 0.07, 0.90, 0)),
        CL("exp.environment.waste_water", "GF0502", "Abwasser", "Waste water management", (0.02, 0.08, 0.90, 0)),
        CL("exp.environment.pollution", "GF0503", "Klima- und Immissionsschutz", "Climate protection and pollution abatement", (0.5, 0.3, 0.2, 0)),
        CL("exp.environment.nature", "GF0504", "Natur- und Landschaftsschutz", "Protection of nature and landscape", (0.15, 0.55, 0.30, 0)),
        CL("exp.environment.rd", "GF0505", "Umweltforschung", "Environmental research", (0.7, 0.3, 0, 0)),
        CL("exp.environment.other", "GF0506", "Sonstiger Umweltschutz", "Other environmental protection", (0.4, 0.4, 0.2, 0)),
    ]),
    G("exp.housing", "Wohnungswesen und kommunale Infrastruktur", "Housing and community amenities", code="GF06", children=[
        CL("exp.housing.housing_development", "GF0601", "Wohnungsbauförderung", "Housing development", (0.05, 0.65, 0.30, 0)),
        CL("exp.housing.community_development", "GF0602", "Stadtentwicklung und Raumplanung", "Urban development and planning", (0.03, 0.17, 0.80, 0)),
        CL("exp.housing.water_supply", "GF0603", "Wasserversorgung", "Water supply", (0, 0.1, 0.9, 0)),
        CL("exp.housing.street_lighting", "GF0604", "Straßenbeleuchtung", "Street lighting", None, fixed=LO, quality="derived",
           note=("Betrag amtlich (Eurostat). Den Gemeinden zugeordnet.", "Official amount (Eurostat). Attributed to the municipalities.")),
        CL("exp.housing.rd", "GF0605", "Forschung zu Wohnen und Stadtentwicklung", "Research on housing and urban development", (0.3, 0.6, 0.1, 0)),
        CL("exp.housing.other", "GF0606", "Sonstige kommunale Infrastruktur", "Other community amenities", (0.05, 0.35, 0.6, 0)),
    ]),
    G("exp.health", "Gesundheit", "Health", code="GF07",
      # The description is set below shares(), once the level shares are known (_health_desc).
      children=[
        CL("exp.health.medical_products", "GF0701", "Arzneimittel, Heil- und Hilfsmittel", "Medicines, medical products and appliances", (0.005, 0.01, 0.005, 0.98)),
        CL("exp.health.outpatient", "GF0702", "Ärzte, Zahnärzte und ambulante Behandlung", "Doctors, dentists and outpatient care", (0.01, 0.02, 0.01, 0.96)),
        CL("exp.health.hospitals", "GF0703", "Krankenhäuser", "Hospitals", (0.01, 0.08, 0.03, 0.88)),
        CL("exp.health.public_health", "GF0704", "Öffentlicher Gesundheitsdienst und Vorsorge", "Public health services and prevention", (0.3, 0.3, 0.4, 0)),
        CL("exp.health.rd", "GF0705", "Gesundheitsforschung", "Health research", (0.5, 0.5, 0, 0)),
        L("exp.health.other", "Sonstige Gesundheitsausgaben und -verwaltung", "Other health spending and administration",
          amount=cof("GF0706") - SS_STAFF_HEALTH - GKV_ADMIN_MATERIAL, code="GF0706", seed=(0.1, 0.1, 0.05, 0.75), quality="estimate", sources=SRC_EXP + ["bmg_kj1_2024"],
          note=("Bereich „Gesundheit, sonstiges“ (COFOG 07.6) nach Abzug von Personal und Sachkosten der Verwaltung der Kranken- und Pflegekassen, die als eigene Posten ausgewiesen sind; Aufteilung auf die Ebenen geschätzt.",
                "Health n.e.c. (COFOG 07.6) after deducting the staff and the non-staff administrative costs of the health and long-term care insurers, shown as items of their own; split across levels estimated.")),
        L("exp.health.insurers_material", "Sachkosten der Verwaltung der Kranken- und Pflegekassen", "Non-staff administrative costs of the health and long-term care insurers",
          amount=GKV_ADMIN_MATERIAL, fixed=SS, quality="derived", sources=["bmg_kj1_2024"],
          desc=("Mieten, IT, Porto, Werbung, Aufklärung, Prüfungs- und Gerichtskosten und Zahlungen an Dienstleister für Verwaltungsaufgaben der Kassen.",
                "Rent, IT, postage, advertising, information campaigns, audit and court costs and payments to service providers for the funds' administrative tasks."),
          note=("Kassenwert aus den Rechnungsergebnissen der Kassen 2024 (KJ1): Brutto-Verwaltungskosten 15,98 Mrd. Euro abzüglich der persönlichen Verwaltungskosten (10,80 Mrd. Euro) und der Beiträge an Kassenverbände und andere Verbände (0,62 Mrd. Euro), deren Personal schon im Arbeitnehmerentgelt steckt. Ganz der Sozialversicherung zugeordnet; aus dem Bereich „Gesundheit, sonstiges“ (COFOG 07.6) herausgelöst.",
                "Cash figure from the funds' accounts for 2024 (KJ1): gross administrative costs of €15.98bn less personal administrative costs (€10.80bn) and the fees to the funds' associations and other associations (€0.62bn), whose staff is already in compensation of employees. Attributed entirely to the social insurance funds; taken out of health n.e.c. (COFOG 07.6).")),
        L("exp.health.insurers_staff", "Personal der Kranken- und Pflegekassen", "Staff of the health and long-term care insurers",
          amount=SS_STAFF_HEALTH, fixed=SS, quality="derived", sources=SRC_EXP + ["bmg_kj1_2024", "bmg_kg1_2025"],
          desc=("Arbeitnehmerentgelt der Sozialversicherung im Gesundheitswesen: Löhne, Gehälter und Arbeitgeberbeiträge der Beschäftigten der Kranken- und Pflegekassen, ihrer Verbände und des Medizinischen Dienstes. Die Kassen hatten am 30. Juni 2025 rund 132.000 Beschäftigte.",
                "Compensation of employees of the social insurance funds in health: wages, salaries and employer contributions of the staff of the health and long-term care insurers, their associations and the Medical Service. The insurers had about 132,000 employees on 30 June 2025."),
          note=("Betrag amtlich (Eurostat, Arbeitnehmerentgelt D.1 der Sozialversicherung im Bereich Gesundheit). Er ist aus dem Bereich „Gesundheit, sonstiges“ (COFOG 07.6) herausgelöst, für den Eurostat 15,0 Mrd. Euro Arbeitnehmerentgelt aller Ebenen ausweist; die übrigen Gesundheitsbereiche haben zusammen weniger als 2,5 Mrd. Euro. Ganz der Sozialversicherung zugeordnet: Anders als bei den Leistungsausgaben ist der Bundeszuschuss hier nicht anteilig zugerechnet, weil er ein fester Betrag ist und eine Einsparung beim Personal den Kassen bleibt.",
                "Official amount (Eurostat, compensation of employees D.1 of the social insurance funds in health). It is taken out of health n.e.c. (COFOG 07.6), for which Eurostat shows €15.0bn of compensation of employees of all levels; the other health groups together have less than €2.5bn. Attributed entirely to the social insurance funds: unlike for benefit spending, the federal subsidy is not attributed pro rata here, because it is a fixed amount and a saving on staff stays with the funds.")),
    ]),
    G("exp.culture", "Kultur, Sport, Rundfunk und Religion", "Culture, sport, broadcasting and religion", code="GF08", children=[
        CL("exp.culture.sport", "GF0801", "Sport und Erholung (Bäder, Sportstätten, Parks)", "Sport and recreation (pools, sports facilities, parks)", (0.03, 0.12, 0.85, 0)),
        CL("exp.culture.culture", "GF0802", "Kultur (Theater, Museen, Bibliotheken)", "Culture (theatres, museums, libraries)", (0.15, 0.40, 0.45, 0)),
        G("exp.culture.broadcasting", "Öffentlich-rechtlicher Rundfunk und Medien", "Public broadcasting and media", code="GF0803",
          desc=("ARD, ZDF und Deutschlandradio zählen in der Statistik zum Staat (Länderebene), der Rundfunkbeitrag entsprechend zu den Steuern.",
                "The public broadcasters ARD, ZDF and Deutschlandradio count as part of government (state level) in the statistics, and the broadcasting fee accordingly counts as a tax."),
          children=[
            L("exp.culture.broadcasting.public_broadcasters", "ARD, ZDF und Deutschlandradio", "ARD, ZDF and Deutschlandradio",
              amount=BROADCASTERS, fixed=ST, quality="estimate", sources=["kef_25_bericht", "eurostat_gov_10a_exp"],
              desc=("Aufwand der öffentlich-rechtlichen Rundfunkanstalten für Programm, Verbreitung, Personal einschließlich Altersversorgung, Sachmittel, Investitionen und den deutschen Anteil an ARTE.",
                    "Spending of the public broadcasters on programmes, distribution, staff including pensions, materials, investment and the German share of ARTE."),
              note=("Eigene Schätzung: Die Finanzkommission KEF weist für 2021 bis 2024 einen finanzbedarfswirksamen Aufwand von ARD, ZDF und Deutschlandradio von 38,50 Mrd. Euro aus; der Posten setzt den Durchschnitt von 9,63 Mrd. Euro im Jahr an. Wie die Volkswirtschaftlichen Gesamtrechnungen die Anstalten abgrenzen, ist nicht im Einzelnen veröffentlicht. Aus dem Bereich Rundfunk und Verlagswesen (COFOG 08.3) herausgelöst; ganz den Ländern zugeordnet.",
                    "Own estimate: the funding commission KEF reports spending relevant to the funding need of ARD, ZDF and Deutschlandradio of €38.50bn for 2021 to 2024; the item takes the average of €9.63bn a year. How national accounts delimit the broadcasters is not published in detail. Taken out of broadcasting and publishing services (COFOG 08.3); attributed entirely to the states.")),
            L("exp.culture.broadcasting.other", "Deutsche Welle, Landesmedienanstalten und übrige Medien", "Deutsche Welle, state media authorities and other media",
              amount=cof("GF0803") - BROADCASTERS, seed=(0.2866, 0.7134, 0, 0), quality="estimate", sources=SRC_EXP + ["kef_25_bericht"],
              note=("Rest der Gruppe (COFOG 08.3) nach Abzug von ARD, ZDF und Deutschlandradio, darunter die Deutsche Welle des Bundes und die Landesmedienanstalten; Aufteilung auf die Ebenen geschätzt.",
                    "Remainder of the group (COFOG 08.3) after deducting ARD, ZDF and Deutschlandradio, including the federal Deutsche Welle and the state media authorities; split across levels estimated.")),
          ]),
        G("exp.culture.religion", "Kirchen und Religionsgemeinschaften (Staatsleistungen u. a.)", "Churches and religious communities (state payments etc.)", code="GF0804", children=[
            L("exp.culture.religion.state_payments", "Staatsleistungen der Länder an die evangelische und katholische Kirche", "State payments of the Länder to the Protestant and Catholic churches",
              amount=STAATSLEISTUNGEN, fixed=ST, quality="estimate", sources=["hu_staatsleistungen_2024", "fowid_staatsleistungen", "eurostat_gov_10a_exp"],
              desc=("Jährliche Zahlungen von 14 Ländern an die Kirchen aufgrund alter Rechtstitel, vor allem als Ausgleich für die Enteignung von Kirchengut um 1803. Seit 1919 verlangt die Verfassung, sie abzulösen (heute Art. 140 GG mit Art. 138 Abs. 1 WRV). Hamburg und Bremen zahlen keine.",
                    "Annual payments by 14 Länder to the churches based on old legal titles, mainly as compensation for the expropriation of church property around 1803. Since 1919 the constitution has required that they be redeemed (Article 140 of the Basic Law with Article 138(1) of the Weimar constitution). Hamburg and Bremen pay none."),
              note=("Summe der Haushaltsansätze der Länder für 2024 nach der Zusammenstellung der Humanistischen Union (618,4 Mio. Euro, davon 364,1 an die evangelische und 254,3 an die katholische Kirche); amtliche Gesamtzahlen gibt es nicht. 2025: 656,9 Mio. Euro, 2026: 666,3 Mio. Euro. Ohne Kirchenbaulasten und Steuerbefreiungen. Aus dem Bereich Religion (COFOG 08.4, laufende Übertragungen 845 Mio. Euro) herausgelöst; ganz den Ländern zugeordnet.",
                    "Sum of the Länder's budgeted amounts for 2024 as compiled by the Humanistische Union (€618.4m, of which 364.1 to the Protestant and 254.3 to the Catholic church); there are no official totals. 2025: €656.9m, 2026: €666.3m. Excluding obligations to maintain church buildings and tax exemptions. Taken out of religious services (COFOG 08.4, current transfers €845m); attributed entirely to the states.")),
            L("exp.culture.religion.other", "Übrige Ausgaben für Kirchen und Religionsgemeinschaften", "Other spending on churches and religious communities",
              amount=cof("GF0804") - STAATSLEISTUNGEN, seed=(0.1553, 0.2243, 0.6205, 0), quality="estimate", sources=SRC_EXP + ["hu_staatsleistungen_2024"],
              desc=("Unter anderem Leistungen von Gemeinden an Kirchengemeinden, Zahlungen an jüdische Gemeinden und andere Religionsgemeinschaften und Baulasten für Kirchengebäude.",
                    "Among other things payments by municipalities to parishes, payments to Jewish communities and other religious communities, and obligations to maintain church buildings."),
              note=("Rest der Gruppe (COFOG 08.4) nach Abzug der Staatsleistungen der Länder; Aufteilung auf die Ebenen geschätzt.",
                    "Remainder of the group (COFOG 08.4) after deducting the Länder's state payments; split across levels estimated.")),
        ]),
        CL("exp.culture.rd", "GF0805", "Forschung zu Kultur und Medien", "Research on culture and media", (0.5, 0.5, 0, 0)),
        CL("exp.culture.other", "GF0806", "Sonstige Kultur und Freizeit", "Other culture and recreation", (0.2, 0.4, 0.4, 0)),
    ]),
    G("exp.education", "Bildung", "Education", code="GF09", children=[
        CL("exp.education.primary", "GF0901", "Kitas und Grundschulen", "Day care, pre-schools and primary schools", (0.01, 0.45, 0.54, 0)),
        CL("exp.education.secondary", "GF0902", "Weiterführende Schulen und Berufsschulen", "Secondary and vocational schools", (0.01, 0.80, 0.19, 0)),
        CL("exp.education.post_secondary", "GF0903", "Fachschulen und Weiterbildung nach der Schule", "Post-secondary non-tertiary education", (0.05, 0.75, 0.2, 0)),
        CL("exp.education.tertiary", "GF0904", "Hochschulen", "Universities and colleges", (0.08, 0.92, 0, 0)),
        CL("exp.education.other_levels", "GF0905", "Volkshochschulen und sonstige Bildung", "Adult education and other education", (0.1, 0.5, 0.4, 0)),
        CL("exp.education.support_services", "GF0906", "Schülerbeförderung, Mensen und andere Hilfsdienste", "School transport, canteens and other support services", (0.05, 0.45, 0.5, 0)),
        CL("exp.education.rd", "GF0907", "Bildungsforschung", "Education research", (0.6, 0.4, 0, 0)),
        CL("exp.education.other", "GF0908", "Sonstige Bildungsausgaben", "Other education spending", (0.2, 0.5, 0.3, 0)),
    ]),
    G("exp.social", "Soziale Sicherung", "Social protection", code="GF10", children=[
        G("exp.social.old_age", "Alter: Renten und Pensionen", "Old age: pensions", code="GF1002", children=[
            L("exp.social.old_age.statutory_pensions", "Altersrenten der gesetzlichen Rentenversicherung", "Old-age pensions of the statutory pension insurance",
              amount=P_OLD, fixed=SS, quality="derived", sources=["drv_rv_in_zahlen_2026", "sozialpolitik_aktuell_viii51", "bundeshaushalt_2024"],
              note=("Rentenausgaben 2024 (360,1 Mrd. Euro) mal Anteil der Altersrenten (79,9 %). Bundesanteil: Zahlungen des Bundes an die Rentenversicherung (116,1 Mrd. Euro) im Verhältnis zu deren Gesamtausgaben (402,8 Mrd. Euro).",
                    "Pension expenditure 2024 (€360.1bn) times the share of old-age pensions (79.9%). Federal share: federal payments to the pension insurance (€116.1bn) relative to its total spending (€402.8bn).")),
            L("exp.social.old_age.civil_service_contributions", "Rentenbeiträge des Staates für seine Beamten (bisher keine)", "Government pension contributions for its civil servants (none so far)",
              amount=0.0, fixed=CIVIL_SERVICE_LEVELS, quality="derived", sources=["eurostat_gov_10a_main"],
              desc=("Beamte sind nicht in der gesetzlichen Rentenversicherung; der Staat zahlt für sie keine Beiträge, sondern später die Pension. Der Posten ist leer und nimmt die Arbeitgeberbeiträge auf, die bei einer Einbeziehung der Beamten anfielen.",
                    "Civil servants are not in the statutory pension insurance; the state pays no contributions for them but pays their pension later. The item is empty and receives the employer contributions that would arise if civil servants were included."),
              note=("Aufteilung auf die Ebenen nach den unterstellten Sozialbeiträgen für Beamte laut Eurostat (Bund 18 %, Länder 66 %, Gemeinden 10 %, Sozialversicherung 5 %) als Näherung dafür, wo Beamte beschäftigt sind.",
                    "Split across levels by the imputed social contributions for civil servants according to Eurostat (federal 18%, states 66%, municipalities 10%, social insurance 5%) as an approximation of where civil servants are employed.")),
            L("exp.social.old_age.other", "Übrige Leistungen bei Alter (Rest der Gruppe)", "Other old-age benefits (remainder of the group)",
              amount=cof("GF1002") - P_OLD, seed=(0.17, 0.33, 0.08, 0.42), quality="estimate", sources=SRC_EXP + ["drv_rv_in_zahlen_2026", "bundeshaushalt_2024", "destatis_pm_2025_455"],
              note=("Rest der Gruppe „Alter“ in den Volkswirtschaftlichen Gesamtrechnungen nach Abzug zweier Kassenzahlen: der gesetzlichen Altersrenten und der Pensionen der Beamten, Richter und Soldaten laut Versorgungsempfängerstatistik. Was der Rest enthält, ist nicht veröffentlicht; die ganze Gruppe besteht laut Staatsausgabenstatistik aus 390,3 Mrd. Euro Geldleistungen, 31,8 Mrd. Euro Sachleistungen und 5,2 Mrd. Euro übrigen Ausgaben. Die Volkswirtschaftlichen Gesamtrechnungen können Leistungen an frühere Beamte weiter abgrenzen als die Kassenstatistik, der Rest kann also auch solche enthalten. Die Aufteilung auf die Ebenen ist der Rest einer Schätzung, nicht belegt.",
                    "Remainder of the old-age group in national accounts after deducting two cash figures: statutory old-age pensions and the pensions of civil servants, judges and soldiers according to the statistics of pension recipients. What the remainder contains is not published; according to government expenditure statistics the whole group consists of €390.3bn of cash benefits, €31.8bn of benefits in kind and €5.2bn of other spending. National accounts may define benefits for former civil servants more widely than the cash statistics, so the remainder may contain such benefits too. The split across levels is the residue of an estimate, not documented.")),
        ]),
        G("exp.social.survivors", "Hinterbliebene: Witwen- und Waisenrenten", "Survivors: widows' and orphans' pensions", code="GF1003", children=[
            L("exp.social.survivors.statutory_pensions", "Hinterbliebenenrenten der gesetzlichen Rentenversicherung", "Survivors' pensions of the statutory pension insurance",
              amount=P_SURV, fixed=SS, quality="derived", sources=["drv_rv_in_zahlen_2026", "sozialpolitik_aktuell_viii51", "bundeshaushalt_2024"],
              note=("Rentenausgaben 2024 mal Anteil der Hinterbliebenenrenten (13,5 %); Bundesanteil wie bei den Altersrenten.", "Pension expenditure 2024 times the share of survivors' pensions (13.5%); federal share as for old-age pensions.")),
            L("exp.social.survivors.other", "Übrige Leistungen an Hinterbliebene (Rest der Gruppe)", "Other survivors' benefits (remainder of the group)",
              amount=cof("GF1003") - P_SURV, seed=(0.3, 0.45, 0.1, 0.15), quality="estimate", sources=SRC_EXP + ["drv_rv_in_zahlen_2026", "destatis_pm_2025_455"],
              note=("Rest der Gruppe „Hinterbliebene“ in den Volkswirtschaftlichen Gesamtrechnungen nach Abzug zweier Kassenzahlen: der gesetzlichen Hinterbliebenenrenten und der Hinterbliebenenversorgung der Beamten, Richter und Soldaten laut Versorgungsempfängerstatistik. Was der Rest enthält, ist nicht veröffentlicht; die Volkswirtschaftlichen Gesamtrechnungen können die Hinterbliebenenversorgung weiter abgrenzen als die Kassenstatistik, der Rest kann also auch Leistungen an Hinterbliebene von Beamten enthalten. Die Aufteilung auf die Ebenen ist der Rest einer Schätzung, nicht belegt.",
                    "Remainder of the survivors' group in national accounts after deducting two cash figures: statutory survivors' pensions and the survivors' benefits of civil servants, judges and soldiers according to the statistics of pension recipients. What the remainder contains is not published; national accounts may define survivors' benefits more widely than the cash statistics, so the remainder may also contain benefits for survivors of civil servants. The split across levels is the residue of an estimate, not documented.")),
        ]),
        G("exp.social.sickness_disability", "Krankheit, Pflege und Behinderung", "Sickness, long-term care and disability", code="GF1001", children=[
            L("exp.social.sickness_disability.em_pensions", "Erwerbsminderungsrenten der gesetzlichen Rentenversicherung", "Disability pensions of the statutory pension insurance",
              amount=P_EM, fixed=SS, quality="derived", sources=["drv_rv_in_zahlen_2026", "sozialpolitik_aktuell_viii51", "bundeshaushalt_2024"],
              note=("Rentenausgaben 2024 mal Anteil der Erwerbsminderungsrenten (6,6 %); Bundesanteil wie bei den Altersrenten.", "Pension expenditure 2024 times the share of disability pensions (6.6%); federal share as for old-age pensions.")),
            L("exp.social.sickness_disability.other", "Pflegeversicherung, Eingliederungshilfe, Krankengeld, Unfallversicherung", "Long-term care insurance, integration assistance for disabled people, sick pay, accident insurance",
              amount=cof("GF1001") - P_EM, seed=(0.04, 0.12, 0.22, 0.62), quality="estimate", sources=SRC_EXP + ["drv_rv_in_zahlen_2026"],
              note=("Rest der Gruppe nach Abzug der Erwerbsminderungsrenten; Aufteilung geschätzt.", "Remainder of the group after deducting disability pensions; split estimated.")),
        ]),
        G("exp.social.family", "Familie und Kinder", "Family and children", code="GF1004",
          children=[
            L("exp.social.family.parental_allowance", "Elterngeld", "Parental allowance", amount=ELTERNGELD, fixed=C, quality="official", sources=["bundeshaushalt_2024"],
              note=("Kassenwert aus dem Bundeshaushalt (Titel 1701 681 02, Ist 2024).", "Cash figure from the federal budget (title 1701 681 02, 2024 actuals).")),
            L("exp.social.family.child_benefit", "Kindergeld: Förderanteil (als Ausgabe gebucht)", "Child benefit: support component (recorded as spending)",
              amount=KG_SPENDING, fixed=KG_LEVELS, quality="estimate", sources=["destatis_wista_2019_05", "bt_drs_21_8480", "ba_famka_2024", "bt_drs_20_12778"],
              desc=("Der Teil des Kindergelds, der über die Steuerfreistellung des Existenzminimums der Kinder hinausgeht. Nur ihn buchen die Volkswirtschaftlichen Gesamtrechnungen als Sozialleistung; der Rest des Kindergelds mindert dort die Lohn- und Einkommensteuer. 2024 zahlte die Familienkasse 54,3 Mrd. Euro Kindergeld nach dem Einkommensteuergesetz aus.",
                    "The part of child benefit that goes beyond exempting the children's subsistence minimum from tax. Only this part is recorded as a social benefit in national accounts; the rest of child benefit reduces wage and income tax there. In 2024 the family benefits office paid out €54.3bn of child benefit under the Income Tax Act."),
              note=("Eigene Schätzung: Kindergeld nach dem Einkommensteuergesetz 2024 (54,31 Mrd. Euro) mal dem Anteil des Förderanteils. Dieser Anteil ist für 2024 nicht veröffentlicht; angesetzt ist der Mittelwert aus 2018 (18,7 von 41,6 Mrd. Euro, Statistisches Bundesamt) und 2026 (25,5 von 55,4 Mrd. Euro, Bundesregierung), 45,5 %. Aufteilung auf die Ebenen wie die Kosten des Kindergelds: Bund und Länder je 42,5 %, Gemeinden 15 %, nach ihren Anteilen an der Lohnsteuer.",
                    "Own estimate: child benefit under the Income Tax Act in 2024 (€54.31bn) times the share of the support component. That share is not published for 2024; the mean of 2018 (€18.7bn of €41.6bn, Federal Statistical Office) and 2026 (€25.5bn of €55.4bn, federal government) is used, 45.5%. Split across levels as the cost of child benefit: federal government and states 42.5% each, municipalities 15%, by their shares of wage tax.")),
            L("exp.social.family.other", "Kinder- und Jugendhilfe, Kinderzuschlag, Unterhaltsvorschuss und übrige Familienleistungen", "Child and youth welfare, child supplement, maintenance advances and other family benefits",
              amount=cof("GF1004") - ELTERNGELD - KG_SPENDING, seed=(0.2, 0.25, 0.55, 0), quality="estimate", sources=SRC_EXP + ["bundeshaushalt_2024", "ba_kindergeld_2024", "destatis_wista_2019_05"],
              note=("Rest der Gruppe nach Abzug des Elterngelds und des als Ausgabe gebuchten Förderanteils des Kindergelds; Aufteilung geschätzt. Die Geldleistungen der gesamten Gruppe betragen laut Eurostat 38,6 Mrd. Euro, darunter Elterngeld, Förderanteil, Kinderzuschlag (2024: 3,0 Mrd. Euro) und Unterhaltsvorschuss.",
                    "Remainder of the group after deducting parental allowance and the support component of child benefit recorded as spending; split estimated. Cash benefits of the whole group amount to €38.6bn according to Eurostat, among them parental allowance, the support component, the child supplement (2024: €3.0bn) and maintenance advances.")),
        ]),
        G("exp.social.basic_security", "Arbeitslosigkeit, Grundsicherung, Wohnen und Asyl", "Unemployment, basic income support, housing and asylum", code="GF1005+GF1006+GF1007",
          desc=("Fasst drei Gruppen der Statistik zusammen (Arbeitslosigkeit, Wohnen, soziale Hilfen), weil sich die einzelnen Leistungen den Gruppen nicht eindeutig zuordnen lassen.",
                "Combines three groups of the statistics (unemployment, housing, social exclusion) because the individual benefits cannot be assigned unambiguously to one of them."),
          children=[
            L("exp.social.basic_security.unemployment_benefit", "Arbeitslosengeld (Arbeitslosenversicherung)", "Unemployment benefit (unemployment insurance)",
              amount=ALG1, fixed=SS, quality="official", sources=["ba_geschaeftsbericht_2024"],
              note=("Kassenwert der Bundesagentur für Arbeit 2024.", "Cash figure of the Federal Employment Agency for 2024.")),
            L("exp.social.basic_security.buergergeld", "Bürgergeld: Regelbedarf, Mehrbedarfe und Sozialbeiträge (seit Juli 2026: Grundsicherungsgeld)", "Citizen's income (Bürgergeld): standard benefit, supplements and social contributions (since July 2026: Grundsicherungsgeld)",
              amount=BG_CASH, fixed=C, quality="official", sources=["bundeshaushalt_2024", "ba_sgb2_zeitreihe", "bundesregierung_neue_grundsicherung"],
              desc=("Geldleistung der Grundsicherung für Arbeitsuchende (SGB II) ohne Wohnkosten, vollständig vom Bund bezahlt. Verwaltung und Arbeitsförderung der Jobcenter sind nicht enthalten.",
                    "Cash benefit of basic income support for jobseekers (Social Code Book II) without housing costs, paid entirely by the federal government. Job centre administration and employment measures are not included."),
              note=("Kassenwert aus dem Bundeshaushalt (Titel 1101 681 12, Ist 2024).", "Cash figure from the federal budget (title 1101 681 12, 2024 actuals).")),
            L("exp.social.basic_security.housing_costs", "Bürgergeld: Kosten für Unterkunft und Heizung", "Citizen's income: housing and heating costs",
              amount=KDU, fixed=LO, quality="derived", sources=["ba_sgb2_zeitreihe", "bundeshaushalt_2024"],
              desc=("Miete und Heizung für Haushalte im Bürgergeld. Die Kommunen zahlen aus, der Bund erstattet einen Teil.", "Rent and heating for households on citizen's income. Municipalities pay, the federal government reimburses part."),
              note=("Zahlungsansprüche laut Bundesagentur für Arbeit (Monatsdurchschnitt 2024 mal 12). Bundesanteil 69,9 %: Bundesbeteiligung 12,36 Mrd. Euro (Ist 2024).",
                    "Payment entitlements according to the Federal Employment Agency (2024 monthly average times 12). Federal share 69.9%: federal contribution of €12.36bn (2024 actuals).")),
            L("exp.social.basic_security.asylum_benefits", "Asylbewerberleistungen", "Asylum seekers' benefits",
              amount=ASYL, seed=(0, 0.4, 0.6, 0), quality="derived", sources=["destatis_asylblg_ausgaben"],
              desc=("Bruttoausgaben nach dem Asylbewerberleistungsgesetz: Unterkunft, Verpflegung, Geldleistungen und Krankenhilfe.", "Gross expenditure under the Asylum Seekers' Benefits Act: accommodation, food, cash benefits and health care."),
              note=("Betrag amtlich (Destatis, revidiert). Länder und Kommunen tragen die Kosten; die Aufteilung zwischen beiden ist geschätzt, weil sie je nach Land unterschiedlich geregelt ist.",
                    "Official amount (Destatis, revised). States and municipalities bear the cost; the split between the two is estimated because rules differ by state.")),
            L(REPLACEMENT, "Ersatzleistungen für vom Bürgergeld Ausgeschlossene (bisher keine)", "Replacement benefits for people excluded from citizen's income (none so far)",
              amount=0.0, fixed=(0, 0.4, 0.6, 0), quality="derived", sources=["destatis_asylblg_ausgaben", "bverfg_2012_asylblg"],
              desc=("Der Posten ist leer. Er nimmt die Leistungen auf, die Länder und Kommunen zahlen müssten, wenn Gruppen vom Bürgergeld ausgeschlossen würden: Das Existenzminimum muss auch dann gesichert sein, über Sozialhilfe oder Asylbewerberleistungen.",
                    "The item is empty. It receives the benefits that states and municipalities would have to pay if groups were excluded from citizen's income: the subsistence minimum must be secured even then, through social assistance or asylum seekers' benefits."),
              note=("Aufteilung auf die Ebenen wie bei den Asylbewerberleistungen.", "Split across levels as for asylum seekers' benefits.")),
            L("exp.social.basic_security.old_age_basic_income", "Grundsicherung im Alter und bei Erwerbsminderung", "Basic income support in old age and for reduced earning capacity",
              amount=GRUSI, fixed=LO, quality="derived", sources=["bundeshaushalt_2024"],
              desc=("Leistungen der Sozialhilfe für Menschen ab der Altersgrenze und für dauerhaft voll Erwerbsgeminderte (Viertes Kapitel SGB XII), mit denselben Regelsätzen wie das Grundsicherungsgeld. Die Kommunen zahlen aus, der Bund erstattet die Nettoausgaben vollständig.",
                    "Social assistance for people above the retirement age and for people permanently unable to work (chapter 4 of Social Code Book XII), with the same standard rates as Grundsicherungsgeld. Municipalities pay out, the federal government reimburses the net expenditure in full."),
              note=("Kassenwert: Erstattung des Bundes 2024 (Titel 1102 632 01, Ist 2024), die den Nettoausgaben entspricht. Ganz dem Bund zugerechnet.",
                    "Cash figure: federal reimbursement in 2024 (title 1102 632 01, 2024 actuals), which equals the net expenditure. Attributed entirely to the federal level.")),
            L("exp.social.basic_security.other", "Arbeitsförderung, Jobcenter-Verwaltung, Sozialhilfe, Wohngeld", "Employment promotion, job centre administration, social assistance, housing benefit",
              amount=cof("GF1005") + cof("GF1006") + cof("GF1007") - ALG1 - BG_CASH - KDU - ASYL - GRUSI, seed=(0.27, 0.13, 0.33, 0.27), quality="estimate",
              sources=SRC_EXP + ["bundeshaushalt_2024", "ba_geschaeftsbericht_2024", "ba_sgb2_zeitreihe", "destatis_asylblg_ausgaben"],
              note=("Rest der drei Gruppen nach Abzug der einzeln ausgewiesenen Leistungen. Die Einzelwerte sind Kassenzahlen, die Gruppensumme stammt aus den Volkswirtschaftlichen Gesamtrechnungen; der Rest ist deshalb nur näherungsweise richtig.",
                    "Remainder of the three groups after deducting the benefits shown separately. The individual items are cash figures, the group total comes from national accounts; the remainder is therefore only approximately right.")),
        ]),
        CL("exp.social.rd", "GF1008", "Sozialforschung", "Research on social protection", (0.5, 0.5, 0, 0)),
        L("exp.social.other", "Sonstige soziale Sicherung (u. a. Sachkosten der Sozialversicherungsträger)", "Other social protection (incl. the social insurance funds' non-staff administrative costs)",
          amount=cof("GF1009") - SS_STAFF_SOCIAL, code="GF1009", seed=(0.1, 0.1, 0.3, 0.5), quality="estimate", sources=SRC_EXP,
          note=("Bereich „Soziale Sicherung, sonstiges“ (COFOG 10.9) nach Abzug des Personals der Sozialversicherung, das als eigener Posten ausgewiesen ist; Aufteilung auf die Ebenen geschätzt.",
                "Social protection n.e.c. (COFOG 10.9) after deducting the staff of the social insurance funds, shown as an item of its own; split across levels estimated.")),
        L("exp.social.insurers_staff", "Personal der Renten-, Unfall- und Arbeitslosenversicherung", "Staff of the pension, accident and unemployment insurance",
          amount=SS_STAFF_SOCIAL, fixed=SS, quality="derived", sources=SRC_EXP + ["bt_drs_21_8817", "ba_haushaltsplan_2026"],
          desc=("Arbeitnehmerentgelt der Sozialversicherung im Bereich soziale Sicherung: vor allem die Beschäftigten der Rentenversicherung (2024: 52.500 Vollzeitstellen in der Verwaltung) und der Bundesagentur für Arbeit (101.300 Vollzeitstellen, davon 39.400 für die Jobcenter), dazu die Unfallversicherung.",
                "Compensation of employees of the social insurance funds in social protection: mainly the staff of the pension insurance (2024: 52,500 full-time equivalents in administration) and of the Federal Employment Agency (101,300 full-time equivalents, of which 39,400 for the job centres), plus accident insurance."),
          note=("Betrag amtlich (Eurostat, Arbeitnehmerentgelt D.1 der Sozialversicherung im Bereich soziale Sicherung). Angenommen ist, dass er im Bereich „Soziale Sicherung, sonstiges“ (COFOG 10.9) liegt, für den Eurostat 19,1 Mrd. Euro Arbeitnehmerentgelt aller Ebenen ausweist; in den Bereichen Alter (0,8) und Arbeitslosigkeit (0,3 Mrd. Euro) ist kaum Personal gebucht. Ganz der Sozialversicherung zugeordnet; das Personal der Bundesagentur in den Jobcentern bezahlt in der Sache großenteils der Bund über die Erstattung der Verwaltungskosten.",
                "Official amount (Eurostat, compensation of employees D.1 of the social insurance funds in social protection). It is assumed to lie in social protection n.e.c. (COFOG 10.9), for which Eurostat shows €19.1bn of compensation of employees of all levels; hardly any staff is booked under old age (0.8) and unemployment (€0.3bn). Attributed entirely to the social insurance funds; the Employment Agency's staff in the job centres is in substance largely paid for by the federal government through the reimbursement of administrative costs.")),
    ]),
]

DIV_OF = {"exp.general": "GF01", "exp.defence": "GF02", "exp.safety": "GF03", "exp.economy": "GF04", "exp.environment": "GF05",
          "exp.housing": "GF06", "exp.health": "GF07", "exp.culture": "GF08", "exp.education": "GF09", "exp.social": "GF10"}


def leaves(node):
    if "children" in node:
        for c in node["children"]:
            yield from leaves(c)
    else:
        yield node


# ---- level shares: fixed leaves first, the rest fitted per division (see levels.py) ----------------------
ALLOC = {}
for top in EXP:
    d = DIV_OF[top["id"]]
    lv = list(leaves(top))
    tot = sum(l["amount"] for l in lv)
    assert abs(tot - cof(d)) < 0.6, (d, tot, cof(d))
    target = list(F[d])
    free = []
    for l in lv:
        if l["fixed"] is not None:
            a = [l["amount"] * w for w in l["fixed"]]
            # a leaf with amount zero (a placeholder for spending a measure would create) keeps its weights as shares
            ALLOC[l["id"]] = a if l["amount"] > 0 else [float(w) for w in l["fixed"]]
            target = [t - x for t, x in zip(target, a)]
        else:
            free.append(l)
    neg = [t for t in target if t < -1]
    if neg:
        print("WARN negative residual target", d, [round(t) for t in target])
    target = [max(t, 0.0) for t in target]
    if free:
        ft = sum(l["amount"] for l in free)
        k = ft / sum(target)
        target = [t * k for t in target]
        X = ipf([(l["amount"], l["seed"]) for l in free], target)
        for l, x in zip(free, X):
            ALLOC[l["id"]] = x

# The replacement benefits would be paid by the same levels as asylum seekers' benefits.
ALLOC[REPLACEMENT] = list(ALLOC["exp.social.basic_security.asylum_benefits"])


def move(leaf_id, frm, to, amount, strict=True):
    a = ALLOC[leaf_id]
    i, j = LV.index(frm), LV.index(to)
    if a[i] < amount:
        msg = f"move {leaf_id}: {frm} has {a[i]:.0f} < {amount:.0f}"
        if strict:
            raise SystemExit(msg)
        print("WARN", msg)
        amount = a[i]
    a[i] -= amount
    a[j] += amount


# ---- earmarked transfers reassigned to the payer ------------------------------------------------------------
# All amounts: bundeshaushalt_2024, actuals 2024, million euros. Which transfers count as earmarked (and are
# therefore moved to the federal level) is a judgement; general-purpose grants are left with the spender.
for lid in ("exp.social.old_age.statutory_pensions", "exp.social.survivors.statutory_pensions", "exp.social.sickness_disability.em_pensions"):
    move(lid, "social_security", "central", ALLOC[lid][3] * FED_RV_SHARE)
rest_rv = FED_TO_RV - DRV_PENSIONS * FED_RV_SHARE          # federal pension funding not attributable to pensions
LSV_PENSION = 2272.231 + 32.998 + 4.648 + 0.399           # chapter 1001: farmers' old-age insurance (636 01, 636 05, 636 03, 636 06)
move("exp.social.old_age.other", "social_security", "central", rest_rv + LSV_PENSION)
move("exp.social.sickness_disability.other", "social_security", "central", 99.779)   # 1001 636 02: farmers' accident insurance
move("exp.social.basic_security.housing_costs", "local", "central", KDU_FED)
WOHNGELD_FED = 2347.167    # 2501 632 01: federal half of housing benefit
move("exp.social.basic_security.old_age_basic_income", "local", "central", GRUSI)   # GRUSI: see the named items above
move("exp.social.basic_security.other", "state", "central", WOHNGELD_FED)
GKV = 14500.0 + 70.802 + 1518.092   # 1501 636 06 and 636 03: health fund; 1001 636 04: farmers' health insurance
hl = ["exp.health.medical_products", "exp.health.outpatient", "exp.health.hospitals", "exp.health.other"]
sstot = sum(ALLOC[h][3] for h in hl)
for h in hl:
    move(h, "social_security", "central", GKV * ALLOC[h][3] / sstot)
# 6001 031 05 (revenue side): regionalisation funds, 12,724.535 in 2024, of which the federal 1,500 for the
# Deutschlandticket (bt_drs_21_4498), which goes to its own leaf
move("exp.economy.transport.other", "state", "central", 12724.535 - DTICKET_FED)
move("exp.economy.transport.deutschlandticket", "state", "central", DTICKET_FED)
move("exp.education.tertiary", "state", "central", 1301.740)            # 3002 632 51: student grants (BAföG)
move("exp.education.secondary", "state", "central", 508.475)            # 3002 632 50: grants for school pupils (BAföG)
move("exp.housing.housing_development", "state", "central", 1656.001)   # 2501 882 06: social housing

EXTRA_NOTES = {
    "exp.social.old_age.other": ("Dem Bund zugerechnet: der Teil der Bundesmittel für die Rentenversicherung, der nicht auf Renten entfällt (u. a. Krankenversicherung der Rentner), und die Zuschüsse zur Alterssicherung der Landwirte.",
                                 "Attributed to the federal level: the part of federal funding of the pension insurance not related to pensions (e.g. pensioners' health insurance) and the subsidies to farmers' old-age insurance."),
    "exp.social.basic_security.other": ("Dem Bund zugerechnet: der Bundesanteil am Wohngeld (2,3 Mrd. Euro). Die Grundsicherung im Alter und bei Erwerbsminderung ist ein eigener Posten.",
                                        "Attributed to the federal level: the federal share of housing benefit (€2.3bn). Basic income support in old age and for reduced earning capacity is an item of its own."),
    "exp.economy.transport.other": ("Die Regionalisierungsmittel des Bundes für den Schienennahverkehr der Länder (11,2 Mrd. Euro, ohne die 1,5 Mrd. Euro für das Deutschlandticket) sind dem Bund zugerechnet.",
                                    "The federal regionalisation funds for the states' regional rail services (€11.2bn, without the €1.5bn for the Deutschlandticket) are attributed to the federal level."),
    "exp.education.tertiary": ("Das BAföG für Studierende (1,3 Mrd. Euro) ist dem Bund zugerechnet.", "Federal student grants (BAföG, €1.3bn) are attributed to the federal level."),
    "exp.education.secondary": ("Das BAföG für Schülerinnen und Schüler (0,5 Mrd. Euro) ist dem Bund zugerechnet.", "Federal grants for school pupils (BAföG, €0.5bn) are attributed to the federal level."),
    "exp.housing.housing_development": ("Die Finanzhilfen des Bundes für den sozialen Wohnungsbau (1,7 Mrd. Euro) sind dem Bund zugerechnet.", "Federal grants for social housing (€1.7bn) are attributed to the federal level."),
}
for h in hl:
    EXTRA_NOTES[h] = ("Der Bundeszuschuss an die gesetzliche Krankenversicherung (14,5 Mrd. Euro) und die Zuschüsse zur Krankenversicherung der Landwirte sind anteilig dem Bund zugerechnet.",
                      "The federal subsidy to statutory health insurance (€14.5bn) and the subsidies to farmers' health insurance are attributed pro rata to the federal level.")

GENERIC_NOTE = ("Betrag amtlich (Eurostat). Die Aufteilung auf die Ebenen ist aus den Eurostat-Daten je Aufgabenbereich abgeleitet und innerhalb des Bereichs geschätzt; siehe Methodik.",
                "Official amount (Eurostat). The split across levels is derived from Eurostat data per division and estimated within the division; see methodology.")


def shares(vec):
    tot = sum(vec)
    s = [max(0.0, v / tot) for v in vec]
    s = [round(x, 4) for x in s]
    d = round(1 - sum(s), 4)
    i = s.index(max(s))
    s[i] = round(s[i] + d, 4)
    return {k: v for k, v in zip(LV, s) if v > 0}


def _health_desc():
    """Description of the health division: what the page shows for the social insurance funds and the federal level
    (from the level shares as written to budget.json), and why the funds themselves spent more. eurostat_gov_10a_exp:
    total expenditure of the social security funds (S1314) in GF07, 2024, 301,832 million euros. The page shows less
    mainly because the federal payments to health insurance (GKV above, 16.09 bn) are attributed to the federal level;
    the rest of the gap (2.4 bn) is the funds' current transfers (D.7, 2,497 million) and the fit to the division total."""
    top = next(n for n in EXP if n["id"] == "exp.health")
    by = {k: 0.0 for k in LV}
    for leaf in leaves(top):
        for k, w in shares(ALLOC[leaf["id"]]).items():
            by[k] += round(leaf["amount"] * 1e6) * w / 1e9
    de = lambda x: f"{x:.1f}".replace(".", ",") + " Mrd. Euro"
    en = lambda x: f"€{x:.1f}bn"
    ss, fed, te, gkv = by["social_security"], by["central"], M[("GF07", "S1314")]["TE"] / 1e3, GKV / 1e3
    return (f"Hier stehen die Ausgaben der gesetzlichen Krankenkassen und die übrigen Gesundheitsausgaben des Staates, sortiert danach, wofür das Geld ausgegeben wird. "
            f"Krankengeld und Pflegeversicherung stehen unter „Soziale Sicherung“, die Beiträge bei den Einnahmen unter „Sozialbeiträge“. "
            f"Nach Staatsebene zeigt die Seite hier {de(ss)} für die Sozialversicherung und {de(fed)} für den Bund; die Sozialversicherung selbst gab mit {de(te)} mehr für Gesundheit aus, "
            f"vor allem weil die {de(gkv)}, die der Bund in die Krankenversicherung zahlte, hier als Ausgaben des Bundes zählen.",
            f"This area holds the spending of the statutory health insurers and the rest of public spending on health, sorted by what the money pays for. "
            f"Sick pay and long-term care insurance are under 'Social protection', and the contributions under 'Social contributions' on the revenue side. "
            f"By level of government, the page shows {en(ss)} here for social insurance and {en(fed)} for the federal government; social insurance itself spent more on health, {en(te)}, "
            f"mainly because the {en(gkv)} that the federal government paid into health insurance counts here as federal spending.")


next(n for n in EXP if n["id"] == "exp.health")["desc"] = _health_desc()


def T(pair):
    return {"de": pair[0], "en": pair[1]}


def eur(m):
    return int(round(m * 1e6))


def out_node(n):
    o = {"id": n["id"], "label": {"de": n["de"], "en": n["en"]}}
    if n.get("desc"):
        o["description"] = T(n["desc"])
    if n.get("code"):
        o["code"] = n["code"]
    if n.get("breakdowns"):
        o["breakdowns"] = n["breakdowns"]
    if "children" in n:
        o["children"] = [out_node(c) for c in n["children"]]
        return o
    o["amount"] = eur(n["amount"])
    o["levels"] = shares(ALLOC[n["id"]]) if n["id"] in ALLOC else n["levels"]
    q = n["quality"]
    if q is None:
        q = "derived"
    o["quality"] = q
    o["sources"] = n["sources"] or SRC_EXP
    if n.get("year"):
        o["year"] = n["year"]
    note = n.get("note")
    if note is None and n["fixed"] is None and n["id"] in ALLOC:
        note = GENERIC_NOTE
    if n["id"] in EXTRA_NOTES:
        e = EXTRA_NOTES[n["id"]]
        note = (note[0] + " " + e[0], note[1] + " " + e[1]) if note else e
    if note:
        o["note"] = T(note)
    return o


# =====================================================================================================
# Breakdown by nationality on the two citizen's income leaves
# bt_drs_21_1069, annex table 1: payment entitlements of all recipients under SGB II, annual sums 2024, euros.
# "other_third" is the remainder: third countries minus Ukraine minus the eight asylum-origin countries,
# plus stateless and unknown.
# =====================================================================================================
NAT_TOTAL = 46922883477.0
NAT = collections.OrderedDict([
    ("german", (24685417369.0, "Deutsche", "German citizens")),
    ("eu", (3255359043.0, "EU-Bürger", "EU citizens")),
    ("ukraine", (6293674215.0, "Ukrainer", "Ukrainian citizens")),
    ("asylum_origin", (7408219210.0, "Acht Hauptasylherkunftsländer (Syrien, Afghanistan, Irak, Iran, Eritrea, Somalia, Nigeria, Pakistan)", "Eight main asylum-origin countries (Syria, Afghanistan, Iraq, Iran, Eritrea, Somalia, Nigeria, Pakistan)")),
    ("other_third", (None, "Sonstige Drittstaaten, Staatenlose und ungeklärt", "Other non-EU countries, stateless and unknown")),
])
known = sum(v[0] for v in NAT.values() if v[0])
NAT["other_third"] = (NAT_TOTAL - known,) + NAT["other_third"][1:]


def norm_shares(vals, nd=4):
    tot = sum(vals)
    s = [round(v / tot, nd) for v in vals]
    i = s.index(max(s))
    s[i] = round(s[i] + round(1 - sum(s), nd), nd)
    return s


nat_sh = norm_shares([v[0] for v in NAT.values()])
NATIONALITY = {
    "label": {"de": "Staatsangehörigkeit der Leistungsberechtigten", "en": "Nationality of recipients"},
    "basis": "spending",
    "groups": [{"id": k, "label": {"de": v[1], "en": v[2]}, "share": s} for (k, v), s in zip(NAT.items(), nat_sh)],
    "quality": "derived",
    "sources": ["bt_drs_21_1069"],
    "note": {"de": "Anteile an den Zahlungsansprüchen aller Leistungsberechtigten im SGB II im Jahr 2024 (46,9 Mrd. Euro, Statistik der Bundesagentur für Arbeit). Die Anteile beziehen sich auf alle Leistungsarten zusammen und werden hier unverändert auf diese Teilleistung angewendet. Eingebürgerte zählen als Deutsche.",
             "en": "Shares of the payment entitlements of all recipients under Social Code Book II in 2024 (€46.9bn, Federal Employment Agency statistics). The shares refer to all benefit types together and are applied unchanged to this component. Naturalised persons count as German."},
}


def find(nodes, id):
    for n in nodes:
        if n["id"] == id:
            return n
        if "children" in n:
            r = find(n["children"], id)
            if r:
                return r


find(EXP, "exp.social.basic_security.buergergeld")["breakdowns"] = {"nationality": NATIONALITY}
find(EXP, "exp.social.basic_security.housing_costs")["breakdowns"] = {"nationality": NATIONALITY}

# The staff of the general administration by level, as groups that a measure can choose. The group node shows
# the shares; each leaf carries the same groups with its own level at 1, so that an effect on the leaf acts only
# when its level is chosen.
ADMIN_LEVEL_GROUPS = (("federal", "Bund", "Federal government"), ("states", "Länder", "States"), ("municipal", "Gemeinden", "Municipalities"))


def admin_levels(shares, quality, note=None):
    b = {"label": {"de": "Personal der allgemeinen Verwaltung nach Ebenen", "en": "Staff of the general administration by level"},
         "basis": "spending",
         "groups": [{"id": k, "label": {"de": de, "en": en}, "share": s} for (k, de, en), s in zip(ADMIN_LEVEL_GROUPS, shares)],
         "quality": quality,
         "sources": SRC_EXP + ["eurostat_gov_10a_main", "destatis_personalstand_2024"],
         "year": 2024}
    if note:
        b["note"] = {"de": note[0], "en": note[1]}
    return {"level": b}


find(EXP, "exp.general.admin_staff")["breakdowns"] = admin_levels(
    ADMIN_LEVEL_SHARES, "estimate",
    ("Arbeitnehmerentgelt 2024, eigene Schätzung (siehe die Posten).", "Compensation of employees 2024, own estimate (see the items)."))
for _i, _leaf in enumerate(("federal", "states", "municipal")):
    find(EXP, "exp.general.admin_staff." + _leaf)["breakdowns"] = admin_levels([1.0 if j == _i else 0.0 for j in range(3)], "derived")


# =====================================================================================================
# Items carved out of a fitted leaf after the fit and after the earmarked transfers were moved. The item bears its
# own level shares, the leaf keeps what is left at each level, and no other leaf changes. (The carve-outs further up,
# such as the staff of the general administration, enter the fit instead and so move the shares of their division.)
# =====================================================================================================
def carve(parent_id, leaf, levels):
    """Takes `leaf` (made with L, amount in million euros) out of the fitted leaf `parent_id` and puts it right after it."""
    part = [leaf["amount"] * w for w in levels]
    rest = [x - y for x, y in zip(ALLOC[parent_id], part)]
    assert min(rest) > -1e-6, (parent_id, leaf["id"], [round(x) for x in rest])
    ALLOC[parent_id] = [max(0.0, x) for x in rest]
    ALLOC[leaf["id"]] = part
    find(EXP, parent_id)["amount"] -= leaf["amount"]

    def place(nodes):
        for i, n in enumerate(nodes):
            if n["id"] == parent_id:
                nodes.insert(i + 1, leaf)
                return True
            if "children" in n and place(n["children"]):
                return True
        return False
    assert place(EXP), parent_id


CS_SRC = ["destatis_pm_2025_455", "destatis_versorgungsausgaben_2024", "destatis_versorgungsempfaenger_2025", "eurostat_gov_10a_exp"]
CS_LEVEL_NOTE = ("Aufteilung auf die Ebenen nach den Anteilen der Dienstherren an den Versorgungsausgaben 2024: Länder 61,9 %, Bund mit Bundeseisenbahnvermögen und Postnachfolgeunternehmen 27,5 %, Gemeinden 8,5 %, übrige 2,1 % (Sozialversicherung und Einrichtungen des Bundes, nach der Zahl der Empfänger geteilt).",
                 "Split across levels by the employers' shares of pension spending in 2024: states 61.9%, federal government with the railway fund and the Post successor companies 27.5%, municipalities 8.5%, other 2.1% (social insurance and federal bodies, split by the number of recipients).")
carve("exp.social.old_age.other",
      L("exp.social.old_age.civil_service_pensions", "Pensionen der Beamten, Richter und Soldaten", "Pensions of civil servants, judges and soldiers",
        amount=CS_PENSIONS, fixed=CS_LEVELS, quality="derived", sources=CS_SRC,
        desc=("Ruhegehälter nach dem Beamten- und Soldatenversorgungsrecht von Bund, Ländern und Gemeinden, einschließlich der ehemaligen Beamten von Bahn und Post: 1,42 Millionen Empfänger am 1. Januar 2025, im Schnitt 3.416 Euro brutto im Monat. Ohne Beihilfe im Krankheitsfall.",
              "Pensions under the civil-service and military pension law of the federal government, the states and the municipalities, including former officials of the railways and the Post: 1.42 million recipients on 1 January 2025, on average €3,416 gross a month. Without medical allowances (Beihilfe)."),
        note=("Ausgaben 2024 laut Versorgungsempfängerstatistik (56,9 Mrd. Euro), aus dem Rest der Gruppe „Alter“ herausgelöst. Kassenzahl; ein Teil der Pensionen wegen Dienstunfähigkeit könnte in den Volkswirtschaftlichen Gesamtrechnungen unter Krankheit und Behinderung stehen. " + CS_LEVEL_NOTE[0],
              "Spending 2024 according to the statistics of pension recipients (€56.9bn), taken out of the remainder of the old-age group. Cash figure; part of the pensions paid for incapacity may be booked under sickness and disability in national accounts. " + CS_LEVEL_NOTE[1])),
      CS_LEVELS)
carve("exp.social.survivors.other",
      L("exp.social.survivors.civil_service", "Hinterbliebenenversorgung der Beamten, Richter und Soldaten", "Survivors' benefits of civil servants, judges and soldiers",
        amount=CS_SURVIVORS, fixed=CS_LEVELS, quality="derived", sources=CS_SRC,
        desc=("Witwen-, Witwer- und Waisengeld nach dem Beamten- und Soldatenversorgungsrecht: 382.100 Empfänger am 1. Januar 2025.",
              "Widows', widowers' and orphans' benefits under the civil-service and military pension law: 382,100 recipients on 1 January 2025."),
        note=("Ausgaben 2024 laut Versorgungsempfängerstatistik (9,0 Mrd. Euro), aus dem Rest der Gruppe „Hinterbliebene“ herausgelöst. " + CS_LEVEL_NOTE[0] + " Hinterbliebene beziehen ihre Versorgung häufiger aus dem Bundesbereich als Pensionäre (40,1 % gegenüber 29,9 % der Empfänger am 1. Januar 2025); der Bundesanteil ist hier deshalb eher zu niedrig.",
              "Spending 2024 according to the statistics of pension recipients (€9.0bn), taken out of the remainder of the survivors' group. " + CS_LEVEL_NOTE[1] + " Survivors receive their benefits from the federal area more often than pensioners do (40.1% against 29.9% of recipients on 1 January 2025), so the federal share here is rather too low.")),
      CS_LEVELS)
carve("exp.general.basic_research",
      L("exp.general.democracy_programmes", "Bundesprogramme „Demokratie leben!“ und „Menschen stärken Menschen“", "Federal programmes “Demokratie leben!” and “Menschen stärken Menschen”",
        amount=DEMOCRACY_PROGRAMMES, fixed=C, quality="derived", sources=["bundeshaushalt_2024", "bh_epl17_2024"],
        desc=("Zuschüsse des Familienministeriums für Demokratieförderung, Vielfalt und Extremismusprävention („Demokratie leben!“) und für Patenschaften („Menschen stärken Menschen“), Titel 1702 684 04. Gefördert werden Partnerschaften für Demokratie in Kommunen, Landes-Demokratiezentren, bundesweite Träger und Modellprojekte.",
              "Grants of the family ministry for democracy promotion, diversity and the prevention of extremism (“Demokratie leben!”) and for mentoring (“Menschen stärken Menschen”), title 1702 684 04. They fund local partnerships for democracy, state democracy centres, national organisations and pilot projects."),
        note=("Kassenwert aus dem Bundeshaushalt (Titel 1702 684 04, Ist 2024: 182,9 Mio. Euro); geplant waren 182,0 Mio. Euro für „Demokratie leben!“ und 18,0 Mio. Euro für „Menschen stärken Menschen“. Der Bundeshaushalt ordnet den Titel der Funktion 165 zu, Forschung und experimentelle Entwicklung außerhalb der Hochschulen; wo die Volkswirtschaftlichen Gesamtrechnungen ihn buchen, wird nicht veröffentlicht. Er ist deshalb aus der Grundlagenforschung herausgelöst. Ganz dem Bund zugeordnet, der das Programm bezahlt, auch wo Kommunen und Länder die Mittel weitergeben.",
              "Cash figure from the federal budget (title 1702 684 04, 2024 actuals: €182.9m); €182.0m were planned for “Demokratie leben!” and €18.0m for “Menschen stärken Menschen”. The federal budget assigns the title to function 165, research and experimental development outside universities; where national accounts book it is not published. It is therefore taken out of basic research. Attributed entirely to the federal level, which pays for the programme, also where municipalities and states pass the money on.")),
      C)
EXTRA_NOTES["exp.general.basic_research"] = ("Ohne die Bundesprogramme „Demokratie leben!“ und „Menschen stärken Menschen“ (182,9 Mio. Euro), die als eigener Posten ausgewiesen sind.",
                                              "Without the federal programmes “Demokratie leben!” and “Menschen stärken Menschen” (€182.9m), shown as an item of their own.")

# =====================================================================================================
# Revision leaf (difference between the COFOG vintage and the latest total)
# =====================================================================================================
TE_LATEST, TR_LATEST = 2147486.0, 2028340.0   # eurostat_gov_10a_main: total expenditure and revenue 2024, S13
REVISION = TE_LATEST - cof("TOTAL")
# Revision of each level's spending without transfers (TE - D7 - D9): gov_10a_main minus gov_10a_exp, 2024.
# Only the three levels with an upward revision are used (social security: -133).
rev_pos = [1741.0, 3217.0, 4556.0, 0.0]
REV_LEAF = {
    "id": "exp.revision",
    "label": {"de": "Noch nicht nach Aufgaben aufgeteilte Datenrevision", "en": "Data revision not yet allocated by function"},
    "description": {"de": "Die Gesamtausgaben des Staates für 2024 wurden im Herbst 2026 um 7,8 Mrd. Euro nach oben revidiert (vor allem Investitionen). Die Gliederung nach Aufgabenbereichen wurde noch nicht angepasst; die Differenz steht deshalb hier.",
                    "en": "Total government expenditure for 2024 was revised upwards by €7.8bn in autumn 2026 (mainly investment). The breakdown by function has not been updated yet, so the difference is shown here."},
    "amount": eur(REVISION),
    "levels": dict(zip(LV[:3], norm_shares(rev_pos[:3]))),
    "quality": "derived",
    "sources": ["eurostat_gov_10a_main", "eurostat_gov_10a_exp"],
    "note": {"de": "Gesamtausgaben laut aktueller Datenlieferung (2.147,5 Mrd. Euro) minus Summe der Aufgabenbereiche (2.139,7 Mrd. Euro). Aufteilung auf die Ebenen nach der Revision ihrer Ausgaben ohne Transfers.",
             "en": "Total expenditure in the latest data release (€2,147.5bn) minus the sum of the functional breakdown (€2,139.7bn). Split across levels according to the revision of each level's spending excluding transfers."},
}

# =====================================================================================================
# Revenue (million euros)
# Tax amounts: eurostat_ntl, sheet DE, column 2024 (national accounts, ESA 2010), typed in below per tax.
# Amounts by level used for the splits: eurostat_gov_10a_main, 2024, sectors S1311 / S1312 / S1313 / S1314.
# =====================================================================================================
# Solidarity surcharge by base tax: bundeshaushalt_2024, revenue chapter 6001, titles 044 01 / 044 02 / 044 04 /
# 044 03 / 044 06 (cash). National accounts include the surcharge in the base taxes; it is deducted there.
SOLI = dict(wage=4096.695, assessed=3449.587, corp=2209.268, nv=1820.009, abg=1058.735)
SOLI_TOTAL = sum(SOLI.values())
WAGE = 286358.0 - SOLI["wage"]                           # NTL D51M C01 Lohnsteuer
ASSESSED = 62041.0 - SOLI["assessed"]                    # NTL D51M C02 Veranlagte Einkommensteuer
CAPITAL = 34652.0 + 18662.0 - SOLI["nv"] - SOLI["abg"]   # NTL D51M C03 + D51O C02 Kapitalertragsteuer und Zinsabschlag
CORP = 42693.0 - SOLI["corp"]                            # NTL D51O C01 Körperschaftsteuer
TRADE = 13479.0 + 61782.0                                # NTL D51M C04 + D51O C03 Gewerbesteuer
OTHER_INC = 15174.0 + 1936.0                             # NTL D51E C01 income tax of the rest of the world + D51O C05 EU energy crisis contribution
PERSONAL = WAGE + ASSESSED
# level splits (derived; see the notes on the leaves)
GEW_LOCAL = 51862.0 / 61782.0                      # gov_10a_main D51B_C2REC local / trade tax paid by corporations
GEW_CENTRAL = 2771.173 / TRADE                     # bundeshaushalt_2024 title 6001 017 01: federal share of the trade tax levy
# cash totals of the flat withholding tax (federal share 44 %) and of withholding tax on dividends (50 %),
# from the federal receipts in bundeshaushalt_2024 titles 6001 018 03 and 6001 013 01
ABG_CASH, NV_CASH = 8477.519 / 0.44, 17011.388 / 0.5
CAP_CENTRAL = (8477.519 + 17011.388) / (ABG_CASH + NV_CASH)
CAP_LOCAL = 0.12 * ABG_CASH / (ABG_CASH + NV_CASH)  # gemfinrefg_1: municipalities receive 12 % of the flat withholding tax
# municipal share of wage and assessed income tax as recorded in national accounts: gov_10a_main D51A_C1REC
# local (61,178) minus the municipal parts of trade tax and withholding tax. Below the statutory 15 % because
# the city states count as state government.
PIT_LOCAL = (61178.0 - GEW_LOCAL * 13479.0 - 0.12 * ABG_CASH) / PERSONAL
PIT = (0.425, 1 - 0.425 - PIT_LOCAL, PIT_LOCAL, 0)
CAP = (CAP_CENTRAL, 1 - CAP_CENTRAL - CAP_LOCAL, CAP_LOCAL, 0)
GEW = (GEW_CENTRAL, 1 - GEW_CENTRAL - GEW_LOCAL, GEW_LOCAL, 0)
D51 = (213188.0, 210549.0, 113040.0)               # gov_10a_main D51REC central / state / local
mod = [PIT[i] * PERSONAL + CAP[i] * CAPITAL + (0.5 if i < 2 else 0) * CORP + GEW[i] * TRADE + (SOLI_TOTAL if i == 0 else 0) for i in range(3)]
OTH_INC = tuple(max(0.0, D51[i] - mod[i]) for i in range(3)) + (0,)   # remainder of D51 per level
VAT = (143609.0, 147568.0, 7587.0, 0)              # gov_10a_main D211REC central / state / local
# remaining NTL items: CHP levy, offshore grid levy, oil stockholding levy, entertainment tax, other municipal
# taxes, business licence fees (D29E), VAT under-compensation (D29G), other taxes on production (D29H, Eurostat
# total 3,989) without the broadcasting fee of enterprises (837), dog and hunting taxes, households' fees
OTHER_CONS = 868 + 1942 + 248 + 900 + 569 + 218 + 320 + (3989 - 837) + 437 + 616
# their split: remainders of gov_10a_main D2REC and D59REC per level after all taxes with a known recipient
OTHER_CONS_LV = (4426.0, 2491.0, 2353.0, 0)

RSRC = ["eurostat_ntl"]

# ---- VAT by rate (derived) ------------------------------------------------------------------------------
# Revenue raised at the reduced rate is not published; what is published is the computational revenue
# forgone by taxing at 7 instead of 19 % (full pass-through, no change in behaviour). Divided by the 12-point
# gap and multiplied by 7 that gives the revenue raised at the reduced rate, for the reduced rate as a whole
# and for the parts the sources name. All figures 2024, million euros:
#   bt_drs_21_5839, answer to question 4: all reduced rates 39,200 (without the temporary reductions for
#     restaurants, gas and district heating)
#   zew_bmf_umsatzsteuersaetze_2025, table 3: food including tap water 27,920
#   bt_drs_21_1600, annex 2: accommodation (no. 102) 1,790; cultural and entertainment services including
#     books, newspapers and works of art (no. 101) 4,065; passenger transport in local traffic and
#     long-distance rail (no. 68) 2,260
#   zew_bmf_umsatzsteuersaetze_2025, table 8: restaurant and catering services without beverages 3,400. In
#     2024 they were taxed at the standard rate, so their revenue is 3,400 / 12 * 19.
# JUDGEMENT: the revenue at 7 % is taken as 7/12 of the revenue forgone, i.e. the same tax base at both rates.
VAT_TOTAL = 298764.0          # NTL D211, as before
VAT_FORGONE = dict(reduced=39200.0, food=27920.0, hotels=1790.0, culture=4065.0, transport=2260.0, restaurants=3400.0)


def euros(m):
    return int(round(m * 1e6))


VAT_E = {k: euros(v / 12 * (19 if k == "restaurants" else 7)) for k, v in VAT_FORGONE.items()}
VAT_E["reduced_other"] = VAT_E["reduced"] - VAT_E["food"] - VAT_E["hotels"] - VAT_E["culture"] - VAT_E["transport"]
VAT_E["standard_other"] = euros(VAT_TOTAL) - VAT_E["reduced"] - VAT_E["restaurants"]
assert VAT_E["reduced_other"] > 0 and VAT_E["standard_other"] > 0
VAT_SRC = RSRC + ["eurostat_gov_10a_main", "bt_drs_21_5839", "zew_bmf_umsatzsteuersaetze_2025", "bt_drs_21_1600"]
VAT_LEVEL_NOTE = ("Aufteilung auf die Ebenen wie bei der gesamten Mehrwertsteuer laut Eurostat.", "Split across levels as for VAT as a whole according to Eurostat.")


def vat_note(de, en):
    return (de + " " + VAT_LEVEL_NOTE[0], en + " " + VAT_LEVEL_NOTE[1])

# ---- contributions on wages by branch (cash figures of the insurers) ---------------------------------------
# Pension insurance: drv_rv_in_zahlen_2026, p. 20: contribution revenue 2024 (305,905) and 2022 (275,622, from
# "Rentenversicherung in Zeitreihen"). The accounts do not split contributions by type. Share on wages, estimated:
# 18.6 % of gross wages up to the 2022 ceiling of 84,600 euros in the wage tax statistics 2022
# (check_distributions.py prints it: 247.6 bn) divided by contribution revenue 2022. JUDGEMENT: one ratio for both years.
PENSION_WAGE = 305905.0 * 247.64 / 275.622
# Health insurance: bmg_kj1_2024 (final accounts 2024), health fund plus insurers:
KV_COMPULSORY = 157485.088 + 669.422 + 18377.532   # accounts 02000 (BAS + Bund) and 02900: compulsorily insured employees
KV_OTHER = 48031.199 + 5292.475                    # accounts 02600 and 02907: "other" (voluntary members and others)


def RL(id, de, en, amount, lv, quality="official", sources=None, note=None, desc=None, code=None):
    return dict(id=id, de=de, en=en, amount=amount, levels=shares(list(lv)), quality=quality, sources=sources or RSRC, note=note, desc=desc, code=code, fixed=None)


REV = [
    G("rev.taxes", "Steuern", "Taxes", code="D2+D5+D91", children=[
        G("rev.taxes.income", "Steuern auf Einkommen und Gewinne", "Taxes on income and profits", code="D51", children=[
            G("rev.taxes.income.personal", "Lohn- und Einkommensteuer", "Wage and income tax", children=[
                RL("rev.taxes.income.personal.wage_tax", "Lohnsteuer", "Wage tax", WAGE, PIT, quality="derived", sources=RSRC + ["bundeshaushalt_2024", "eurostat_gov_10a_main", "gg_art_106", "gemfinrefg_1"], code="D51M",
                   desc=("Vom Arbeitgeber einbehaltene Einkommensteuer auf Löhne, Gehälter und Pensionen.", "Income tax withheld by employers on wages, salaries and civil-service pensions."),
                   note=("Volkswirtschaftliche Gesamtrechnungen (286,4 Mrd. Euro) abzüglich des Solidaritätszuschlags zur Lohnsteuer (4,1 Mrd. Euro, Kasse), der gesondert ausgewiesen ist. Höher als die kassenmäßige Lohnsteuer (rund 249 Mrd. Euro, hochgerechnet aus dem Bundesanteil von 105,8 Mrd. Euro), unter anderem weil das Kindergeld dort abgezogen wird. Gesetzliche Aufteilung 42,5 % Bund, 42,5 % Länder, 15 % Gemeinden; der Gemeindeanteil der Stadtstaaten zählt in der Statistik zu den Ländern.",
                         "National accounts figure (€286.4bn) minus the solidarity surcharge on wage tax (€4.1bn, cash), which is shown separately. Higher than cash wage tax (about €249bn, extrapolated from the federal share of €105.8bn), among other things because child benefit is deducted there. Statutory split 42.5% federal, 42.5% states, 15% municipalities; the municipal share of the city states counts as state level in the statistics.")),
                RL("rev.taxes.income.personal.assessed", "Veranlagte Einkommensteuer", "Assessed income tax", ASSESSED, PIT, quality="derived", sources=RSRC + ["bundeshaushalt_2024", "eurostat_gov_10a_main", "gg_art_106", "gemfinrefg_1"], code="D51M",
                   desc=("Einkommensteuer von Selbständigen, Vermietern und anderen, die per Steuerbescheid zahlen, abzüglich Erstattungen an Arbeitnehmer.", "Income tax of the self-employed, landlords and others who pay by assessment, net of refunds to employees."),
                   note=("Volkswirtschaftliche Gesamtrechnungen (62,0 Mrd. Euro) abzüglich des Solidaritätszuschlags zur Einkommensteuer (3,4 Mrd. Euro, Kasse). Aufteilung wie bei der Lohnsteuer.",
                         "National accounts figure (€62.0bn) minus the solidarity surcharge on assessed income tax (€3.4bn, cash). Split as for wage tax.")),
            ]),
            RL("rev.taxes.income.capital_income", "Kapitalertragsteuer und Abgeltungsteuer", "Withholding taxes on dividends, interest and capital gains", CAPITAL, CAP, quality="derived", sources=RSRC + ["bundeshaushalt_2024", "gemfinrefg_1"], code="D51M+D51O",
               note=("Volkswirtschaftliche Gesamtrechnungen (53,3 Mrd. Euro) abzüglich des Solidaritätszuschlags (2,9 Mrd. Euro, Kasse). Aufteilung nach den gesetzlichen Anteilen (Dividenden: je 50 % Bund und Länder; Zinsen und Veräußerungsgewinne: 44 % Bund, 44 % Länder, 12 % Gemeinden), gewichtet mit dem Kassenaufkommen 2024.",
                     "National accounts figure (€53.3bn) minus the solidarity surcharge (€2.9bn, cash). Split by statutory shares (dividends: 50% federal, 50% states; interest and capital gains: 44% federal, 44% states, 12% municipalities), weighted by 2024 cash receipts.")),
            RL("rev.taxes.income.corporate", "Körperschaftsteuer", "Corporate income tax", CORP, (0.5, 0.5, 0, 0), quality="derived", sources=RSRC + ["bundeshaushalt_2024", "gg_art_106"], code="D51O",
               note=("Volkswirtschaftliche Gesamtrechnungen (42,7 Mrd. Euro) abzüglich des Solidaritätszuschlags zur Körperschaftsteuer (2,2 Mrd. Euro, Kasse). Je zur Hälfte Bund und Länder.",
                     "National accounts figure (€42.7bn) minus the solidarity surcharge on corporate income tax (€2.2bn, cash). Half federal, half states.")),
            RL("rev.taxes.income.trade_tax", "Gewerbesteuer", "Local business tax (trade tax)", TRADE, GEW, quality="derived", sources=RSRC + ["eurostat_gov_10a_main", "bundeshaushalt_2024"], code="D51M+D51O",
               note=("Betrag amtlich. Gemeindeanteil aus den Eurostat-Daten zu den Unternehmenssteuern der Gemeinden abgeleitet; Bundesanteil ist die Gewerbesteuerumlage (2,8 Mrd. Euro). Der Länderanteil enthält die Umlage der Länder und die Gewerbesteuer der Stadtstaaten.",
                     "Official amount. Municipal share derived from Eurostat data on municipalities' taxes on corporate income; the federal share is the trade tax levy (€2.8bn). The state share comprises the states' levy and the trade tax of the city states.")),
            RL("rev.taxes.income.soli", "Solidaritätszuschlag", "Solidarity surcharge", SOLI_TOTAL, C, quality="official", sources=["bundeshaushalt_2024"],
               desc=("Zuschlag von 5,5 % auf Einkommen-, Kapitalertrag- und Körperschaftsteuer; seit 2021 zahlen ihn bei der Einkommensteuer nur noch hohe Einkommen.", "Surcharge of 5.5% on income tax, withholding tax and corporate income tax; since 2021 only high earners pay it on income tax."),
               note=("Kassenaufkommen des Bundes 2024. In den Volkswirtschaftlichen Gesamtrechnungen ist der Zuschlag in den jeweiligen Steuern enthalten; er wurde dort abgezogen.",
                     "Federal cash receipts 2024. In national accounts the surcharge is included in the respective taxes; it has been deducted there.")),
            RL("rev.taxes.income.other", "Einkommensteuern von Steuerausländern und Sonstiges", "Income taxes paid by non-residents and other", OTHER_INC, OTH_INC, quality="derived", sources=RSRC + ["eurostat_gov_10a_main"], code="D51E",
               note=("Einkommensteuer der übrigen Welt (15,2 Mrd. Euro) und EU-Energiekrisenbeitrag (1,9 Mrd. Euro). Aufteilung auf die Ebenen als Rest aus den Eurostat-Daten zu den Einkommensteuern je Ebene.",
                     "Income tax paid by the rest of the world (€15.2bn) and the EU energy crisis contribution (€1.9bn). Split across levels as the remainder from Eurostat data on income taxes by level.")),
        ]),
        G("rev.taxes.consumption", "Steuern auf Konsum, Verbrauch und Umwelt", "Taxes on consumption and the environment", code="D2+D59", children=[
            G("rev.taxes.consumption.vat", "Mehrwertsteuer (Umsatzsteuer)", "Value added tax (VAT)", code="D211",
              desc=("Betrag und Aufteilung auf die Ebenen laut Eurostat (298,8 Mrd. Euro). Der EU-Anteil erscheint als Ausgabe (EU-Beitrag). Die Aufteilung nach Steuersätzen ist aus den geschätzten Mindereinnahmen der ermäßigten Sätze abgeleitet; amtlich wird das Aufkommen nicht nach Sätzen ausgewiesen.",
                    "Amount and split across levels according to Eurostat (€298.8bn). The EU share appears as expenditure (EU contribution). The split by rate is derived from the estimated revenue forgone through the reduced rates; revenue by rate is not published officially."),
              children=[
                G("rev.taxes.consumption.vat.standard", "Zum Regelsatz (2024: 19 %)", "At the standard rate (2024: 19%)", children=[
                    RL("rev.taxes.consumption.vat.standard.restaurants", "Speisen in Restaurants und Gaststätten", "Restaurant and catering meals", VAT_E["restaurants"] / 1e6, VAT, quality="derived", sources=VAT_SRC,
                       desc=("Restaurant- und Verpflegungsdienstleistungen ohne Getränke. 2024 zum Regelsatz besteuert, seit 1. Januar 2026 zum ermäßigten Satz von 7 %.",
                             "Restaurant and catering services without beverages. Taxed at the standard rate in 2024, at the reduced rate of 7% since 1 January 2026."),
                       note=vat_note("Rechnerische Mindereinnahmen bei 7 statt 19 % laut Finanzministerium (3,40 Mrd. Euro), geteilt durch 12 und mal 19.",
                                     "Notional revenue forgone at 7 instead of 19% according to the finance ministry (€3.40bn), divided by 12 and multiplied by 19.")),
                    RL("rev.taxes.consumption.vat.standard.other", "Übrige Waren und Dienstleistungen", "Other goods and services", VAT_E["standard_other"] / 1e6, VAT, quality="derived", sources=VAT_SRC,
                       note=vat_note("Mehrwertsteuer insgesamt abzüglich des Aufkommens zum ermäßigten Satz und der Speisen in Restaurants.",
                                     "Total VAT minus revenue at the reduced rate and from restaurant meals.")),
                ]),
                G("rev.taxes.consumption.vat.reduced", "Zum ermäßigten Satz (7 %)", "At the reduced rate (7%)",
                  desc=("Aufkommen zum ermäßigten Satz, abgeleitet aus den rechnerischen Mindereinnahmen gegenüber dem Regelsatz (39,2 Mrd. Euro im Jahr 2024 laut Bundesregierung): geteilt durch den Abstand von 12 Punkten und mal 7.",
                        "Revenue at the reduced rate, derived from the notional revenue forgone compared with the standard rate (€39.2bn in 2024 according to the federal government): divided by the 12-point gap and multiplied by 7."),
                  children=[
                    RL("rev.taxes.consumption.vat.reduced.food", "Lebensmittel und Leitungswasser", "Food and tap water", VAT_E["food"] / 1e6, VAT, quality="derived", sources=VAT_SRC,
                       desc=("Ermäßigt besteuerte Nahrungsmittel einschließlich Milch, Kaffee, Tee und Speisen zum Mitnehmen, dazu Leitungswasser.",
                             "Food taxed at the reduced rate, including milk, coffee, tea and take-away food, plus tap water."),
                       note=vat_note("Rechnerische Mindereinnahmen laut Finanzministerium (27,92 Mrd. Euro), geteilt durch 12 und mal 7.",
                                     "Notional revenue forgone according to the finance ministry (€27.92bn), divided by 12 and multiplied by 7.")),
                    RL("rev.taxes.consumption.vat.reduced.hotels", "Hotelübernachtungen", "Hotel stays", VAT_E["hotels"] / 1e6, VAT, quality="derived", sources=VAT_SRC,
                       note=vat_note("Mindereinnahmen laut Subventionsbericht (1,79 Mrd. Euro), geteilt durch 12 und mal 7.", "Revenue forgone according to the Subsidy Report (€1.79bn), divided by 12 and multiplied by 7.")),
                    RL("rev.taxes.consumption.vat.reduced.culture", "Kultur, Bücher, Zeitungen und Kunst", "Culture, books, newspapers and art", VAT_E["culture"] / 1e6, VAT, quality="derived", sources=VAT_SRC,
                       note=vat_note("Mindereinnahmen laut Subventionsbericht (4,07 Mrd. Euro), geteilt durch 12 und mal 7.", "Revenue forgone according to the Subsidy Report (€4.07bn), divided by 12 and multiplied by 7.")),
                    RL("rev.taxes.consumption.vat.reduced.transport", "Nahverkehr und Bahn", "Local public transport and rail", VAT_E["transport"] / 1e6, VAT, quality="derived", sources=VAT_SRC,
                       note=vat_note("Mindereinnahmen laut Subventionsbericht (2,26 Mrd. Euro), geteilt durch 12 und mal 7.", "Revenue forgone according to the Subsidy Report (€2.26bn), divided by 12 and multiplied by 7.")),
                    RL("rev.taxes.consumption.vat.reduced.other", "Übrige ermäßigt besteuerte Umsätze", "Other sales at the reduced rate", VAT_E["reduced_other"] / 1e6, VAT, quality="derived", sources=VAT_SRC,
                       note=vat_note("Rest: Aufkommen zum ermäßigten Satz insgesamt abzüglich der vier einzeln ausgewiesenen Bereiche.", "Remainder: revenue at the reduced rate as a whole minus the four areas shown separately.")),
                  ]),
              ]),
            RL("rev.taxes.consumption.energy", "Energiesteuer (Benzin, Diesel, Heizöl, Gas)", "Energy tax (petrol, diesel, heating oil, gas)", 36579.0, C, code="D214A"),
            RL("rev.taxes.consumption.electricity", "Stromsteuer", "Electricity tax", 5671.0, C, code="D214A"),
            RL("rev.taxes.consumption.tobacco", "Tabaksteuer", "Tobacco tax", 15786.0, C, code="D214A"),
            G("rev.taxes.consumption.alcohol_coffee", "Alkohol-, Bier-, Schaumwein- und Kaffeesteuer", "Taxes on spirits, beer, sparkling wine and coffee", code="D214A", children=[
                RL("rev.taxes.consumption.alcohol_coffee.beer", "Biersteuer", "Beer tax", 562.0, ST, sources=RSRC + ["gg_art_106"], code="D214A",
                   note=("Steht den Ländern zu (Art. 106 Abs. 2 Grundgesetz).", "Goes to the states (Article 106(2) of the Basic Law).")),
                RL("rev.taxes.consumption.alcohol_coffee.spirits_sparkling_coffee", "Alkohol-, Schaumwein- und Kaffeesteuer", "Taxes on spirits, sparkling wine and coffee", 1993.0 + 371 + 996 + 3, C, sources=RSRC + ["gg_art_106"], code="D214A",
                   note=("Alkoholsteuer einschließlich Alkopopsteuer (1,99 Mrd. Euro), Kaffeesteuer (1,0 Mrd. Euro), Schaumweinsteuer (0,37 Mrd. Euro) und sonstige Verbrauchsteuern (3 Mio. Euro). Als Verbrauchsteuern stehen sie dem Bund zu (Art. 106 Abs. 1 Grundgesetz).",
                         "Alcohol tax including the tax on alcopops (€1.99bn), coffee tax (€1.0bn), sparkling wine tax (€0.37bn) and other excise duties (€3m). As excise duties they go to the federal level (Article 106(1) of the Basic Law).")),
            ]),
            # Zero-amount leaves for two excise duties that did not exist in 2024 and were debated with the 2027 federal
            # budget, so that a measure can book them at the federal level (like the wealth tax for the states).
            RL("rev.taxes.consumption.sugar_drinks", "Zuckergetränkesteuer (2024 nicht erhoben)", "Tax on sugar-sweetened drinks (not levied in 2024)", 0.0, C, sources=RSRC + ["gg_art_106"], code="D214A",
               desc=("Verbrauchsteuer auf gezuckerte Getränke, Stand November 2026 mit dem Haushaltsbegleitgesetz 2027 ab 1. Januar 2028 geplant. Als Verbrauchsteuer stünde das Aufkommen dem Bund zu (Art. 106 Abs. 1 Grundgesetz).",
                     "Excise duty on sugar-sweetened drinks, planned as of November 2026 from 1 January 2028 with the Budget Accompanying Act 2027. As an excise duty its revenue would go to the federal level (Article 106(1) of the Basic Law).")),
            RL("rev.taxes.consumption.plastic_packaging", "Kunststoffverpackungsteuer (2024 nicht erhoben)", "Tax on plastic packaging (not levied in 2024)", 0.0, C, sources=RSRC + ["gg_art_106"], code="D214A",
               desc=("Verbrauchsteuer auf Kunststoff in Verpackungen, 2026 geplant und im November 2026 vorerst nicht beschlossen. Als Verbrauchsteuer stünde das Aufkommen dem Bund zu (Art. 106 Abs. 1 Grundgesetz).",
                     "Excise duty on plastic in packaging, planned in 2026 and, as of November 2026, not adopted for now. As an excise duty its revenue would go to the federal level (Article 106(1) of the Basic Law).")),
            RL("rev.taxes.consumption.insurance", "Versicherung- und Feuerschutzsteuer", "Insurance tax and fire protection tax", 18318.0 + 724, (18318.0, 724.0, 0, 0), code="D214G"),
            RL("rev.taxes.consumption.motor_vehicle", "Kfz-Steuer", "Motor vehicle tax", 2310.0 + 7358, C, code="D29B+D59D"),
            RL("rev.taxes.consumption.air_travel", "Luftverkehrsteuer", "Air travel tax", 1877.0, C, code="D214H"),
            G("rev.taxes.consumption.co2", "CO2-Preis (nationaler und europäischer Emissionshandel)", "Carbon pricing (national and EU emissions trading)", code="D29F",
              desc=("Erlöse aus der Versteigerung von Emissionsrechten und aus dem nationalen CO2-Preis auf Kraft- und Heizstoffe; fließen in den Klima- und Transformationsfonds des Bundes.",
                    "Proceeds from auctioning emission allowances and from the national carbon price on fuels; they flow into the federal Climate and Transformation Fund."),
              children=[
                # NTL D29F C03 "Nationale CO2-Abgabe" and C01 "Emissionsberechtigungen", 2024. Cash proceeds 2024 according to
                # the German Emissions Trading Authority: 18.5 bn in total (uba_pm_29_2025), of which EU ETS about 5.5 bn
                # (5.4 bn in 2025, 0.1 bn less than in 2024: pv_magazine_emissionshandel_2025), national system 13.0 bn.
                RL("rev.taxes.consumption.co2.national", "Nationaler CO2-Preis auf Kraft- und Heizstoffe", "National carbon price on transport and heating fuels", 10957.0, C,
                   sources=RSRC + ["uba_pm_29_2025", "pv_magazine_emissionshandel_2025"], code="D29F",
                   desc=("Erlöse aus dem nationalen Brennstoffemissionshandel: Wer Benzin, Diesel, Heizöl oder Erdgas in Verkehr bringt, muss für den CO2-Ausstoß Zertifikate kaufen (2024: 45 Euro je Tonne).",
                         "Proceeds from national emissions trading for fuels: suppliers of petrol, diesel, heating oil or natural gas have to buy certificates for the resulting CO2 emissions (2024: €45 per tonne)."),
                   note=("Abgrenzung der Volkswirtschaftlichen Gesamtrechnungen. Die Deutsche Emissionshandelsstelle weist für 2024 Kasseneinnahmen von rund 13 Mrd. Euro aus, für 2025 rund 16 Mrd. Euro.",
                         "National accounts definition. The German Emissions Trading Authority reports cash proceeds of about €13bn for 2024 and about €16bn for 2025.")),
                RL("rev.taxes.consumption.co2.eu_ets", "Europäischer Emissionshandel (Versteigerungserlöse)", "EU emissions trading (auction proceeds)", 7671.0, C,
                   sources=RSRC + ["uba_pm_29_2025", "pv_magazine_emissionshandel_2025"], code="D29F",
                   desc=("Deutschlands Erlöse aus der Versteigerung von Emissionsrechten für Kraftwerke, Industrie und Luftverkehr.",
                         "Germany's proceeds from auctioning emission allowances for power plants, industry and aviation."),
                   note=("Abgrenzung der Volkswirtschaftlichen Gesamtrechnungen. Die Deutsche Emissionshandelsstelle weist für 2024 Versteigerungserlöse von rund 5,5 Mrd. Euro aus.",
                         "National accounts definition. The German Emissions Trading Authority reports auction proceeds of about €5.5bn for 2024.")),
              ]),
            RL("rev.taxes.consumption.gambling", "Lotterie-, Wett- und Spielbankabgaben", "Lottery, betting and casino taxes", 3094.0, ST, code="D214F"),
            RL("rev.taxes.consumption.broadcasting_fee", "Rundfunkbeitrag", "Broadcasting fee", 837.0 + 8264, ST, code="D29H+D59F",
               desc=("Der Rundfunkbeitrag zählt in den Volkswirtschaftlichen Gesamtrechnungen als Steuer, weil ARD, ZDF und Deutschlandradio dort zum Staat (Länderebene) gehören.",
                     "The broadcasting fee counts as a tax in national accounts because the public broadcasters are classified as part of government (state level).")),
            RL("rev.taxes.consumption.other", "Sonstige Abgaben (Umlagen im Strompreis, Vergnügung-, Hundesteuer, Gebühren u. a.)", "Other levies (electricity surcharges, entertainment tax, dog tax, fees etc.)", OTHER_CONS, OTHER_CONS_LV, quality="derived", sources=RSRC + ["eurostat_gov_10a_main"],
               note=("Summe der übrigen Posten der nationalen Steuerliste. Aufteilung auf die Ebenen als Rest aus den Eurostat-Daten je Ebene.", "Sum of the remaining items of the national tax list. Split across levels as the remainder from Eurostat data by level.")),
        ]),
        G("rev.taxes.property", "Steuern auf Vermögen, Erbschaften und Grundbesitz", "Taxes on wealth, inheritance and property", children=[
            RL("rev.taxes.property.property_tax", "Grundsteuer", "Property tax", 16222.0, (0, 0.10, 0.90, 0), quality="derived", sources=RSRC + ["eurostat_gov_10a_main"], code="D29A",
               note=("Betrag amtlich. Gemeindesteuer; rund ein Zehntel entfällt auf die Stadtstaaten, die in der Statistik zu den Ländern zählen (aus Eurostat-Daten je Ebene abgeleitet).",
                     "Official amount. A municipal tax; about one tenth accrues to the city states, which count as state level in the statistics (derived from Eurostat data by level).")),
            RL("rev.taxes.property.real_estate_transfer", "Grunderwerbsteuer", "Real estate transfer tax", 12750.0, ST, code="D214B"),
            RL("rev.taxes.property.inheritance", "Erbschaft- und Schenkungsteuer", "Inheritance and gift tax", 9991.0, ST, sources=RSRC + ["eurostat_gov_10a_main"], code="D91A"),
            RL("rev.taxes.property.wealth_tax", "Vermögensteuer (wird seit 1997 nicht erhoben)", "Wealth tax (not levied since 1997)", 0.0, ST, sources=RSRC + ["gg_art_106"], code="D59A",
               desc=("Das Vermögensteuergesetz besteht fort, wird aber seit 1997 nicht mehr angewendet. Das Aufkommen stünde den Ländern zu (Art. 106 Abs. 2 Grundgesetz).",
                     "The Wealth Tax Act still exists but has not been applied since 1997. The revenue would go to the states (Article 106(2) of the Basic Law).")),
            # Zero-amount leaf for a one-off levy on large fortunes, paid in instalments, as Die Linke proposes; the last
            # such levy was the Lastenausgleich of 1952. Federal by Article 106(1) no. 5 of the Basic Law, unlike the
            # wealth tax above. In national accounts a capital levy is a capital tax (D.91).
            RL("rev.taxes.property.wealth_levy", "Einmalige Vermögensabgabe (2024 nicht erhoben)", "One-off wealth levy (not levied in 2024)", 0.0, C, sources=RSRC + ["gg_art_106"], code="D91B",
               desc=("Einmalige Abgabe auf große Vermögen, die in Raten über mehrere Jahre gezahlt werden darf; in der Bundesrepublik zuletzt mit dem Lastenausgleich von 1952 erhoben. Das Aufkommen stünde allein dem Bund zu (Art. 106 Abs. 1 Nr. 5 Grundgesetz).",
                     "One-off levy on large fortunes that may be paid in instalments over several years; in the Federal Republic last levied with the burden-sharing law of 1952. The revenue would go to the federal level alone (Article 106(1) no. 5 of the Basic Law).")),
        ]),
    ]),
    G("rev.contributions", "Sozialbeiträge", "Social contributions", code="D61",
      desc=("Beiträge zur Renten-, Kranken-, Pflege-, Arbeitslosen- und Unfallversicherung. Eurostat weist sie nach Zahlern aus, nicht nach Versicherungszweigen.",
            "Contributions to pension, health, long-term care, unemployment and accident insurance. Eurostat reports them by payer, not by insurance branch."),
      children=[
        G("rev.contributions.wages", "Beiträge auf Löhne und Gehälter (Arbeitgeber und Arbeitnehmer)", "Contributions on wages and salaries (employers and employees)", code="D611+D613CE",
          desc=("Pflichtbeiträge von Arbeitgebern und Arbeitnehmern zusammen. Die Gesamtsumme stammt aus den Volkswirtschaftlichen Gesamtrechnungen (Arbeitgeber 302,4 Mrd. Euro, Arbeitnehmer 280,2 Mrd. Euro); die Aufteilung auf Renten- und Krankenversicherung beruht auf den Rechnungsergebnissen der Versicherungen.",
                "Compulsory contributions of employers and employees together. The total comes from national accounts (employers €302.4bn, employees €280.2bn); the split into pension and health insurance is based on the insurers' accounts."),
          children=[
            RL("rev.contributions.wages.pension", "Gesetzliche Rentenversicherung: Beiträge auf Löhne", "Statutory pension insurance: contributions on wages", PENSION_WAGE, SS, quality="estimate",
               sources=["drv_rv_in_zahlen_2026", "drv_rv_in_zeitreihen_2026", "destatis_lest_2022"],
               desc=("Beitragssatz 2024: 18,6 % des Bruttolohns bis zur Beitragsbemessungsgrenze von 90.600 Euro im Jahr (Ost: 89.400 Euro), je zur Hälfte von Arbeitgeber und Arbeitnehmer.",
                     "Contribution rate 2024: 18.6% of gross wages up to the contribution ceiling of €90,600 a year (East: €89,400), half each from employer and employee."),
               note=("Die Rentenversicherung weist für 2024 Beitragseinnahmen von 305,9 Mrd. Euro aus, ohne Aufteilung nach Beitragsarten. Der Anteil der Beiträge auf Löhne (89,8 %) ist geschätzt: 18,6 % der Bruttolöhne bis zur Beitragsbemessungsgrenze laut Lohnsteuerstatistik 2022 (247,6 Mrd. Euro) im Verhältnis zu den Beitragseinnahmen 2022 (275,6 Mrd. Euro). Der Rest sind unter anderem Beiträge des Bundes für Kindererziehungszeiten und Beiträge auf Lohnersatzleistungen.",
                     "The pension insurance reports contribution revenue of €305.9bn for 2024 without a breakdown by type. The share of contributions on wages (89.8%) is estimated: 18.6% of gross wages up to the contribution ceiling according to the 2022 wage tax statistics (€247.6bn) relative to contribution revenue in 2022 (€275.6bn). The rest includes federal contributions for child-raising periods and contributions on wage-replacement benefits.")),
            G("rev.contributions.wages.health", "Gesetzliche Krankenversicherung: Beiträge von Beschäftigten und freiwilligen Mitgliedern", "Statutory health insurance: contributions of employees and voluntary members",
              desc=("Beitragssatz 2024: 14,6 % plus durchschnittlich 1,67 % Zusatzbeitrag des Bruttolohns bis zur Beitragsbemessungsgrenze von 62.100 Euro im Jahr, je zur Hälfte von Arbeitgeber und Arbeitnehmer.",
                    "Contribution rate 2024: 14.6% plus an average additional contribution of 1.67% of gross wages up to the contribution ceiling of €62,100 a year, half each from employer and employee."),
              children=[
                RL("rev.contributions.wages.health.compulsory", "Pflichtversicherte Beschäftigte", "Compulsorily insured employees", KV_COMPULSORY, SS, sources=["bmg_kj1_2024", "bundesregierung_rechengroessen_2024", "drv_rv_in_zahlen_2026"],
                   note=("Endgültige Rechnungsergebnisse der gesetzlichen Krankenversicherung 2024: Beiträge für versicherungspflichtige Beschäftigte (158,2 Mrd. Euro) und Zusatzbeiträge (18,4 Mrd. Euro). Kassenzahl, keine Abgrenzung der Volkswirtschaftlichen Gesamtrechnungen.",
                         "Final accounts of statutory health insurance 2024: contributions for compulsorily insured employees (€158.2bn) and additional contributions (€18.4bn). Cash figure, not the national accounts definition.")),
                RL("rev.contributions.wages.health.voluntary", "Freiwillige Mitglieder und sonstige Beiträge", "Voluntary members and other contributions", KV_OTHER, SS, sources=["bmg_kj1_2024", "bundesregierung_rechengroessen_2024"],
                   desc=("Darunter die Beiträge freiwillig versicherter Beschäftigter mit einem Lohn oberhalb der Versicherungspflichtgrenze (2024: 69.300 Euro) und freiwillig versicherter Selbständiger.",
                         "Includes the contributions of voluntarily insured employees with wages above the compulsory insurance threshold (2024: €69,300) and of voluntarily insured self-employed persons."),
                   note=("Endgültige Rechnungsergebnisse 2024: „Sonstige Beiträge“ (48,0 Mrd. Euro) und „Sonstige Zusatzbeiträge“ (5,3 Mrd. Euro) des Gesundheitsfonds. Die Jahresrechnung weist die freiwilligen Mitglieder nicht gesondert aus; ein Teil dieser Beiträge stammt nicht aus Löhnen.",
                         "Final accounts 2024: \"other contributions\" (€48.0bn) and \"other additional contributions\" (€5.3bn) of the health fund. The accounts do not show voluntary members separately; part of these contributions does not come from wages.")),
              ]),
            RL("rev.contributions.wages.other", "Pflege-, Arbeitslosen- und Unfallversicherung sowie Abgrenzungsunterschiede", "Long-term care, unemployment and accident insurance, and differences in definition",
               302350.0 + 280150.0 - PENSION_WAGE - KV_COMPULSORY - KV_OTHER, SS, quality="estimate", sources=RSRC + ["eurostat_gov_10a_main", "drv_rv_in_zahlen_2026", "bmg_kj1_2024"],
               note=("Rest: Beiträge von Arbeitgebern und Arbeitnehmern laut Volkswirtschaftlichen Gesamtrechnungen (582,5 Mrd. Euro) abzüglich der oben ausgewiesenen Kassenzahlen für Renten- und Krankenversicherung. Wegen der unterschiedlichen Abgrenzung nur näherungsweise richtig.",
                     "Remainder: contributions of employers and employees according to national accounts (€582.5bn) minus the cash figures for pension and health insurance shown above. Only approximately right because of the different definitions.")),
          ]),
        RL("rev.contributions.self_employed", "Pflichtbeiträge der Selbständigen", "Compulsory contributions of the self-employed", 11809.0, SS, code="D613CS"),
        RL("rev.contributions.non_employed", "Beiträge von Rentnern und Leistungsbeziehern", "Contributions of pensioners and benefit recipients", 106054.0, SS, code="D613CN",
           desc=("Vor allem Kranken- und Pflegeversicherungsbeiträge der Rentner sowie Beiträge, die Sozialkassen und Bund für Leistungsbezieher zahlen.", "Mainly health and long-term care contributions of pensioners and contributions paid by social funds and the federal government on behalf of benefit recipients.")),
        RL("rev.contributions.voluntary", "Freiwillige Beiträge", "Voluntary contributions", 8233.0, SS, code="D613V"),
        RL("rev.contributions.imputed", "Unterstellte Beiträge für Beamtenpensionen", "Imputed contributions for civil servants' pensions", 48153.0, (8779.0, 31948.0, 4950.0, 711072.0 - 302350.0 - 406246.0), sources=RSRC + ["eurostat_gov_10a_main"], code="D612",
           desc=("Rechnerische Gegenbuchung für Pensionen und Beihilfen, die der Staat seinen Beamten ohne Beitragszahlung gewährt; kein tatsächlicher Geldfluss.", "Bookkeeping counterpart of pensions and health benefits that government grants its civil servants without contributions; not an actual cash flow.")),
    ]),
    G("rev.other", "Sonstige Einnahmen", "Other revenue", children=[
        G("rev.other.sales", "Gebühren, Entgelte und Verkäufe", "Fees, charges and sales", code="P11+P12+P131",
          desc=("Zum Beispiel Lkw-Maut, Kita- und Abwassergebühren, Eintrittsgelder, Verwaltungsgebühren.", "For example the truck toll, day-care and sewage charges, admission fees, administrative fees."),
          children=[
            RL("rev.other.sales.public_broadcasters", "Werbung, Sponsoring und übrige Markterlöse von ARD, ZDF und Deutschlandradio", "Advertising, sponsorship and other market income of ARD, ZDF and Deutschlandradio",
               BROADCASTERS_SALES, (0, BROADCASTERS_SALES, 0, 0), quality="estimate", sources=["kef_25_bericht", "eurostat_gov_10a_main"],
               note=("Eigene Schätzung: Die Finanzkommission KEF erkennt für 2025 bis 2028 Erträge aus Werbung (1.037,9 Mio. Euro), Sponsoring (159,1), Kostenerstattungen (418,8), sonstigen betrieblichen Erträgen wie Programmverwertung, Mieten und Mahngebühren (2.241,1) und Sonstiges (239,7) an, im Jahr rund 1,02 Mrd. Euro. Nicht eingerechnet sind Finanzerträge, die größtenteils aus den Anlagen für die Pensionen stammen, Beteiligungserträge und Rückflüsse der Landesmedienanstalten. Ein Teil der Summe, etwa Erträge aus aufgelösten Rückstellungen und Erstattungen anderer öffentlich-rechtlicher Sender, ist in den Volkswirtschaftlichen Gesamtrechnungen keine Einnahme; der Posten ist deshalb eher zu hoch. Aus den Verkäufen der Länderebene herausgelöst.",
                     "Own estimate: for 2025 to 2028 the funding commission KEF recognises income from advertising (€1,037.9m), sponsorship (159.1), reimbursements (418.8), other operating income such as programme sales, rents and dunning fees (2,241.1) and other income (239.7), about €1.02bn a year. Not included are financial income, most of which comes from the assets that cover the pensions, income from holdings and returns from the state media authorities. Part of the sum, such as income from released provisions and reimbursements by other public broadcasters, is not revenue in national accounts; the item is therefore rather too high. Taken out of the state level's sales.")),
            RL("rev.other.sales.other", "Übrige Gebühren, Entgelte und Verkäufe", "Other fees, charges and sales", 187119.0 - BROADCASTERS_SALES,
               (60346.0, 56882.0 - BROADCASTERS_SALES, 64722.0, 5169.0), sources=["eurostat_gov_10a_main"],
               note=("Rest der Gruppe nach Abzug der Markterlöse der öffentlich-rechtlichen Rundfunkanstalten; die Länderebene ist um diese gemindert.",
                     "Remainder of the group after deducting the market income of the public broadcasters; the state level is reduced by it.")),
          ]),
        RL("rev.other.property_income", "Zinsen, Dividenden und Pachten", "Interest, dividends and rents", 33652.0, (14825.0, 7192.0, 7210.0, 4483.0), sources=["eurostat_gov_10a_main"], code="D4"),
        RL("rev.other.transfers", "Sonstige laufende Übertragungen (u. a. EU-Mittel, Bußgelder)", "Other current transfers (incl. EU funds, fines)", 31463.0, (1966.0 + 2097, 603.0 + 13299, 521.0 + 9671, 3306.0), sources=["eurostat_gov_10a_main"], code="D7"),
        RL("rev.other.capital_transfers", "Vermögensübertragungen (u. a. EU-Investitionszuschüsse)", "Capital transfers (incl. EU investment grants)", 11979.0, (0.55, 0.20, 0.25, 0), quality="estimate", sources=["eurostat_gov_10a_main"], code="D92+D99",
           note=("Betrag amtlich. Eurostat weist die Aufteilung auf die Ebenen nur einschließlich der Zahlungen zwischen den Ebenen aus; die Anteile sind deshalb geschätzt.", "Official amount. Eurostat reports the split by level only including payments between levels; the shares are therefore estimated.")),
        RL("rev.other.subsidies", "Empfangene Subventionen", "Subsidies received", 233.0, (0, 7.0, 226.0, 0), sources=["eurostat_gov_10a_main"], code="D39"),
    ]),
]


def build():
    return {"revenue": [out_node(n) for n in REV], "expenditure": [out_node(n) for n in EXP] + [REV_LEAF]}


def dumps(budget):
    return json.dumps(budget, ensure_ascii=False, indent=2)


def tot(nodes):
    s = 0
    for n in nodes:
        s += tot(n["children"]) if "children" in n else n["amount"]
    return s


if __name__ == "__main__":
    path = os.path.join(OUT, "budget.json")
    budget = build()
    text = dumps(budget)
    if "--check" in sys.argv:
        same = os.path.exists(path) and open(path, encoding="utf-8").read() == text
        print("budget.json is", "identical to the rebuilt version" if same else "DIFFERENT from the rebuilt version")
        sys.exit(0 if same else 1)
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:   # write next to the target, then swap, so readers never see half a file
            f.write(text)
        os.replace(tmp, path)
        print("wrote", path)
    else:
        print("level shares per expenditure leaf in % (central, state, local, social security); amounts in million euros")
        lvl = [0, 0, 0, 0]
        for top in EXP:
            for l in leaves(top):
                a = ALLOC[l["id"]]
                if l["amount"] == 0:
                    continue
                lvl = [t + x for t, x in zip(lvl, a)]
                print(f"{l['id']:<52}{l['amount']:>10.0f}  " + " ".join(f"{x / l['amount'] * 100:5.1f}" for x in a))
        print("expenditure borne by level (bn):", [round(t / 1e3, 1) for t in lvl])
        for d in F:
            print(d, "final-spender targets (bn):", [round(x / 1e3, 1) for x in F[d]])
        print("income tax split", [round(x, 4) for x in PIT], "withholding", [round(x, 4) for x in CAP], "trade tax", [round(x, 4) for x in GEW])
    r, e = tot(budget["revenue"]), tot(budget["expenditure"])
    print("revenue %.3f bn, expenditure %.3f bn, balance %.3f bn" % (r / 1e9, e / 1e9, (r - e) / 1e9))
    for n in budget["revenue"] + budget["expenditure"]:
        print("  %-22s %10.3f bn" % (n["id"], tot([n]) / 1e9))
