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
              amount=EU_OWN, fixed=C, quality="official", sources=["eurostat_gov_10a_main"], code="D76",
              desc=("Deutschlands Zahlungen an den EU-Haushalt aus Mehrwertsteuer- und BNE-Eigenmitteln. Zölle, die Deutschland für die EU erhebt, zählen nicht zu den Staatseinnahmen und sind hier nicht enthalten.",
                    "Germany's payments to the EU budget from VAT-based and GNI-based own resources. Customs duties collected on behalf of the EU are not government revenue and are not included."),
              note=("Betrag aus der aktuellen Datenlieferung (Oktober 2026); die funktionale Gliederung beruht auf einem etwas älteren Datenstand.",
                    "Amount from the latest data release (October 2026); the breakdown by function is based on a slightly older vintage.")),
            L("exp.general.executive.bundestag_mp_pay", "Bundestag: Diäten der Abgeordneten", "Bundestag: MPs' pay",
              amount=MP_PAY, fixed=C, quality="official", sources=["bundeshaushalt_2024"],
              desc=("Entschädigungen und Amtszulagen nach § 11 Abgeordnetengesetz, Ist 2024. Ohne Kostenpauschale, Mitarbeiter und Altersversorgung.",
                    "Salaries and office allowances under section 11 of the Members of the Bundestag Act, 2024 actuals. Excludes the expense allowance, staff and pensions."),
              note=("Kassenwert aus dem Bundeshaushalt (Titel 0212 411 01).", "Cash figure from the federal budget (title 0212 411 01).")),
            L("exp.general.executive.bundestag_other", "Bundestag: übrige Ausgaben", "Bundestag: other spending",
              amount=BUNDESTAG - MP_PAY, fixed=C, quality="derived", sources=["bundeshaushalt_2024"],
              desc=("Mitarbeiter der Abgeordneten, Fraktionen, Verwaltung, Gebäude, Kostenpauschale, Altersversorgung.", "MPs' staff, parliamentary groups, administration, buildings, expense allowance, pensions."),
              note=("Einzelplan 02 (1.150,4 Mio. Euro, Ist 2024) abzüglich der Diäten.", "Budget section 02 (EUR 1,150.4 million, 2024 actuals) minus MPs' pay.")),
            L("exp.general.executive.other", "Übrige Regierung, Parlamente, Finanzämter, Auswärtiger Dienst", "Other government, parliaments, tax offices, foreign service",
              amount=cof("GF0101") - EU_OWN - BUNDESTAG, seed=(0.30, 0.35, 0.35, 0), quality="estimate",
              sources=SRC_EXP + ["eurostat_gov_10a_main", "bundeshaushalt_2024"],
              note=("Rest der Gruppe nach Abzug von EU-Beitrag und Bundestag; Aufteilung auf die Ebenen geschätzt.", "Remainder of the group after deducting the EU contribution and the Bundestag; split across levels estimated.")),
        ]),
        CL("exp.general.foreign_aid", "GF0102", "Entwicklungshilfe und wirtschaftliche Auslandshilfe", "Development aid and foreign economic aid", None, fixed=C, quality="derived",
           note=("Betrag amtlich (Eurostat). Vollständig dem Bund zugeordnet, der für die Entwicklungszusammenarbeit zuständig ist; kleinere Beiträge der Länder sind nicht gesondert ausgewiesen.", "Amount official (Eurostat). Attributed entirely to the federal level, which is responsible for development cooperation; smaller contributions by the states are not shown separately."),
           desc=("Abgrenzung der Staatsausgabenstatistik (COFOG 01.2). Die international gemeldete Entwicklungshilfe (ODA) ist anders abgegrenzt und höher, weil sie zum Beispiel Kosten für Geflüchtete im Inland mitzählt.",
                 "As defined in government expenditure statistics (COFOG 01.2). Official development assistance (ODA) as reported internationally is defined differently and is higher, for example because it counts the cost of refugees in the donor country.")),
        CL("exp.general.general_services", "GF0103", "Allgemeine Dienste (Personal-, Planungs- und Statistikämter, zentrale Verwaltung)", "General services (personnel, planning and statistical offices, central administration)", (0.25, 0.35, 0.40, 0)),
        CL("exp.general.basic_research", "GF0104", "Grundlagenforschung", "Basic research", (0.55, 0.45, 0, 0)),
        CL("exp.general.rd", "GF0105", "Forschung zur öffentlichen Verwaltung", "Research on public administration", (0.5, 0.5, 0, 0)),
        CL("exp.general.other", "GF0106", "Sonstige allgemeine Verwaltung", "Other general administration", (0.2, 0.3, 0.5, 0.01)),
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
           note=("Betrag amtlich (Eurostat). Den Ländern zugeordnet, die für den Justizvollzug zuständig sind.", "Amount official (Eurostat). Attributed to the states, which are responsible for the prison system.")),
        CL("exp.safety.rd", "GF0305", "Forschung zu Sicherheit und Justiz", "Research on safety and justice", (0.5, 0.5, 0, 0)),
        CL("exp.safety.other", "GF0306", "Sonstige Sicherheit und Ordnung", "Other public order and safety", (0.3, 0.3, 0.4, 0)),
    ]),
    G("exp.economy", "Wirtschaft, Verkehr und Energie", "Economy, transport and energy", code="GF04", children=[
        CL("exp.economy.general_labour", "GF0401", "Wirtschafts- und Arbeitsmarktförderung", "Business and labour market support", (0.45, 0.2, 0.1, 0.25)),
        CL("exp.economy.agriculture", "GF0402", "Land- und Forstwirtschaft, Fischerei", "Agriculture, forestry and fishing", (0.4, 0.5, 0.1, 0)),
        CL("exp.economy.energy", "GF0403", "Energie (u. a. Förderung erneuerbarer Energien, Preisbremsen)", "Energy (incl. support for renewables, price brakes)", (0.92, 0.05, 0.03, 0)),
        CL("exp.economy.industry", "GF0404", "Bergbau, Industrie und Bau", "Mining, manufacturing and construction", (0.5, 0.4, 0.1, 0)),
        CL("exp.economy.transport", "GF0405", "Verkehr (Straßen, Schiene, Nahverkehr)", "Transport (roads, rail, local public transport)", (0.40, 0.25, 0.35, 0)),
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
           note=("Betrag amtlich (Eurostat). Den Gemeinden zugeordnet.", "Amount official (Eurostat). Attributed to the municipalities.")),
        CL("exp.housing.rd", "GF0605", "Forschung zu Wohnen und Stadtentwicklung", "Research on housing and urban development", (0.3, 0.6, 0.1, 0)),
        CL("exp.housing.other", "GF0606", "Sonstige kommunale Infrastruktur", "Other community amenities", (0.05, 0.35, 0.6, 0)),
    ]),
    G("exp.health", "Gesundheit", "Health", code="GF07", children=[
        CL("exp.health.medical_products", "GF0701", "Arzneimittel, Heil- und Hilfsmittel", "Medicines, medical products and appliances", (0.005, 0.01, 0.005, 0.98)),
        CL("exp.health.outpatient", "GF0702", "Ärzte, Zahnärzte und ambulante Behandlung", "Doctors, dentists and outpatient care", (0.01, 0.02, 0.01, 0.96)),
        CL("exp.health.hospitals", "GF0703", "Krankenhäuser", "Hospitals", (0.01, 0.08, 0.03, 0.88)),
        CL("exp.health.public_health", "GF0704", "Öffentlicher Gesundheitsdienst und Vorsorge", "Public health services and prevention", (0.3, 0.3, 0.4, 0)),
        CL("exp.health.rd", "GF0705", "Gesundheitsforschung", "Health research", (0.5, 0.5, 0, 0)),
        CL("exp.health.other", "GF0706", "Verwaltung der Krankenkassen und sonstige Gesundheitsausgaben", "Health insurance administration and other health spending", (0.1, 0.1, 0.05, 0.75)),
    ]),
    G("exp.culture", "Kultur, Sport, Rundfunk und Religion", "Culture, sport, broadcasting and religion", code="GF08", children=[
        CL("exp.culture.sport", "GF0801", "Sport und Erholung (Bäder, Sportstätten, Parks)", "Sport and recreation (pools, sports facilities, parks)", (0.03, 0.12, 0.85, 0)),
        CL("exp.culture.culture", "GF0802", "Kultur (Theater, Museen, Bibliotheken)", "Culture (theatres, museums, libraries)", (0.15, 0.40, 0.45, 0)),
        CL("exp.culture.broadcasting", "GF0803", "Öffentlich-rechtlicher Rundfunk und Medien", "Public broadcasting and media", (0.05, 0.95, 0, 0),
           desc=("ARD, ZDF und Deutschlandradio zählen in der Statistik zum Staat (Länderebene), der Rundfunkbeitrag entsprechend zu den Steuern.",
                 "The public broadcasters ARD, ZDF and Deutschlandradio count as part of government (state level) in the statistics, and the broadcasting fee accordingly counts as a tax.")),
        CL("exp.culture.religion", "GF0804", "Kirchen und Religionsgemeinschaften (Staatsleistungen u. a.)", "Churches and religious communities (state payments etc.)", (0.05, 0.75, 0.2, 0)),
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
                    "Pension expenditure 2024 (EUR 360.1 billion) times the share of old-age pensions (79.9%). Federal share: federal payments to the pension insurance (EUR 116.1 billion) relative to its total spending (EUR 402.8 billion).")),
            L("exp.social.old_age.other", "Beamtenpensionen, Kranken- und Pflegeleistungen für Ältere und weitere Altersleistungen", "Civil servants' pensions, health and care benefits for the elderly and other old-age benefits",
              amount=cof("GF1002") - P_OLD, seed=(0.17, 0.33, 0.08, 0.42), quality="estimate", sources=SRC_EXP + ["drv_rv_in_zahlen_2026", "bundeshaushalt_2024"],
              note=("Rest der Gruppe „Alter“ nach Abzug der gesetzlichen Altersrenten; Aufteilung auf die Ebenen geschätzt.", "Remainder of the old-age group after deducting statutory old-age pensions; split across levels estimated.")),
        ]),
        G("exp.social.survivors", "Hinterbliebene: Witwen- und Waisenrenten", "Survivors: widows' and orphans' pensions", code="GF1003", children=[
            L("exp.social.survivors.statutory_pensions", "Hinterbliebenenrenten der gesetzlichen Rentenversicherung", "Survivors' pensions of the statutory pension insurance",
              amount=P_SURV, fixed=SS, quality="derived", sources=["drv_rv_in_zahlen_2026", "sozialpolitik_aktuell_viii51", "bundeshaushalt_2024"],
              note=("Rentenausgaben 2024 mal Anteil der Hinterbliebenenrenten (13,5 %); Bundesanteil wie bei den Altersrenten.", "Pension expenditure 2024 times the share of survivors' pensions (13.5%); federal share as for old-age pensions.")),
            L("exp.social.survivors.other", "Hinterbliebenenversorgung der Beamten und weitere Leistungen", "Survivors' benefits for civil servants and other benefits",
              amount=cof("GF1003") - P_SURV, seed=(0.3, 0.45, 0.1, 0.15), quality="estimate", sources=SRC_EXP + ["drv_rv_in_zahlen_2026"],
              note=("Rest der Gruppe nach Abzug der gesetzlichen Hinterbliebenenrenten; Aufteilung geschätzt.", "Remainder of the group after deducting statutory survivors' pensions; split estimated.")),
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
            L("exp.social.family.other", "Kindergeld (soweit als Ausgabe gebucht), Kinder- und Jugendhilfe, Unterhaltsvorschuss", "Child benefit (as far as recorded as spending), child and youth welfare, maintenance advances",
              amount=cof("GF1004") - ELTERNGELD, seed=(0.2, 0.25, 0.55, 0), quality="estimate", sources=SRC_EXP + ["bundeshaushalt_2024", "ba_kindergeld_2024"],
              note=("Rest der Gruppe nach Abzug des Elterngelds; Aufteilung geschätzt. Die Geldleistungen der gesamten Gruppe betragen laut Eurostat 38,6 Mrd. Euro, die Familienkasse zahlte 2024 aber 54,5 Mrd. Euro Kindergeld aus: Die Volkswirtschaftlichen Gesamtrechnungen buchen demnach nur einen Teil des Kindergelds als Ausgabe, der Rest wird dort offenbar mit der Lohnsteuer verrechnet.",
                    "Remainder of the group after deducting parental allowance; split estimated. Cash benefits of the whole group amount to EUR 38.6 billion according to Eurostat, whereas the family benefits office paid out EUR 54.5 billion in child benefit in 2024: national accounts thus record only part of child benefit as spending, the rest is evidently netted against wage tax there.")),
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
                    "Payment entitlements according to the Federal Employment Agency (2024 monthly average times 12). Federal share 69.9%: federal contribution of EUR 12.36 billion (2024 actuals).")),
            L("exp.social.basic_security.asylum_benefits", "Asylbewerberleistungen", "Asylum seekers' benefits",
              amount=ASYL, seed=(0, 0.4, 0.6, 0), quality="derived", sources=["destatis_asylblg_ausgaben"],
              desc=("Bruttoausgaben nach dem Asylbewerberleistungsgesetz: Unterkunft, Verpflegung, Geldleistungen und Krankenhilfe.", "Gross expenditure under the Asylum Seekers' Benefits Act: accommodation, food, cash benefits and health care."),
              note=("Betrag amtlich (Destatis, revidiert). Länder und Kommunen tragen die Kosten; die Aufteilung zwischen beiden ist geschätzt, weil sie je nach Land unterschiedlich geregelt ist.",
                    "Amount official (Destatis, revised). States and municipalities bear the cost; the split between the two is estimated because rules differ by state.")),
            L("exp.social.basic_security.other", "Arbeitsförderung, Jobcenter-Verwaltung, Sozialhilfe, Grundsicherung im Alter, Wohngeld", "Employment promotion, job centre administration, social assistance, basic security in old age, housing benefit",
              amount=cof("GF1005") + cof("GF1006") + cof("GF1007") - ALG1 - BG_CASH - KDU - ASYL, seed=(0.27, 0.13, 0.33, 0.27), quality="estimate",
              sources=SRC_EXP + ["bundeshaushalt_2024", "ba_geschaeftsbericht_2024", "ba_sgb2_zeitreihe", "destatis_asylblg_ausgaben"],
              note=("Rest der drei Gruppen nach Abzug der einzeln ausgewiesenen Leistungen. Die Einzelwerte sind Kassenzahlen, die Gruppensumme stammt aus den Volkswirtschaftlichen Gesamtrechnungen; der Rest ist deshalb nur näherungsweise richtig.",
                    "Remainder of the three groups after deducting the benefits shown separately. The individual items are cash figures, the group total comes from national accounts; the remainder is therefore only approximately right.")),
        ]),
        CL("exp.social.rd", "GF1008", "Sozialforschung", "Research on social protection", (0.5, 0.5, 0, 0)),
        CL("exp.social.other", "GF1009", "Verwaltung der Sozialversicherungen und sonstige soziale Sicherung", "Administration of social insurance and other social protection", (0.1, 0.1, 0.3, 0.5)),
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
            ALLOC[l["id"]] = a
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
GRUSI = 11059.914          # 1102 632 01: reimbursement of basic security in old age and for reduced earning capacity
WOHNGELD_FED = 2347.167    # 2501 632 01: federal half of housing benefit
move("exp.social.basic_security.other", "local", "central", GRUSI)
move("exp.social.basic_security.other", "state", "central", WOHNGELD_FED)
GKV = 14500.0 + 70.802 + 1518.092   # 1501 636 06 and 636 03: health fund; 1001 636 04: farmers' health insurance
hl = ["exp.health.medical_products", "exp.health.outpatient", "exp.health.hospitals", "exp.health.other"]
sstot = sum(ALLOC[h][3] for h in hl)
for h in hl:
    move(h, "social_security", "central", GKV * ALLOC[h][3] / sstot)
move("exp.economy.transport", "state", "central", 12724.535)            # 6001 031 05 (revenue side): regionalisation funds
move("exp.education.tertiary", "state", "central", 1301.740)            # 3002 632 51: student grants (BAföG)
move("exp.education.secondary", "state", "central", 508.475)            # 3002 632 50: grants for school pupils (BAföG)
move("exp.housing.housing_development", "state", "central", 1656.001)   # 2501 882 06: social housing

EXTRA_NOTES = {
    "exp.social.old_age.other": ("Dem Bund zugerechnet: der Teil der Bundesmittel für die Rentenversicherung, der nicht auf Renten entfällt (u. a. Krankenversicherung der Rentner), und die Zuschüsse zur Alterssicherung der Landwirte.",
                                 "Attributed to the federal level: the part of federal funding of the pension insurance not related to pensions (e.g. pensioners' health insurance) and the subsidies to farmers' old-age insurance."),
    "exp.social.basic_security.other": ("Dem Bund zugerechnet: Erstattung der Grundsicherung im Alter (11,1 Mrd. Euro) und der Bundesanteil am Wohngeld (2,3 Mrd. Euro).",
                                        "Attributed to the federal level: reimbursement of basic security in old age (EUR 11.1 billion) and the federal share of housing benefit (EUR 2.3 billion)."),
    "exp.economy.transport": ("Die Regionalisierungsmittel des Bundes für den Schienennahverkehr der Länder (12,7 Mrd. Euro) sind dem Bund zugerechnet.",
                              "The federal regionalisation funds for the states' regional rail services (EUR 12.7 billion) are attributed to the federal level."),
    "exp.education.tertiary": ("Das BAföG für Studierende (1,3 Mrd. Euro) ist dem Bund zugerechnet.", "Federal student grants (BAföG, EUR 1.3 billion) are attributed to the federal level."),
    "exp.education.secondary": ("Das BAföG für Schülerinnen und Schüler (0,5 Mrd. Euro) ist dem Bund zugerechnet.", "Federal grants for school pupils (BAföG, EUR 0.5 billion) are attributed to the federal level."),
    "exp.housing.housing_development": ("Die Finanzhilfen des Bundes für den sozialen Wohnungsbau (1,7 Mrd. Euro) sind dem Bund zugerechnet.", "Federal grants for social housing (EUR 1.7 billion) are attributed to the federal level."),
}
for h in hl:
    EXTRA_NOTES[h] = ("Der Bundeszuschuss an die gesetzliche Krankenversicherung (14,5 Mrd. Euro) und die Zuschüsse zur Krankenversicherung der Landwirte sind anteilig dem Bund zugerechnet.",
                      "The federal subsidy to statutory health insurance (EUR 14.5 billion) and the subsidies to farmers' health insurance are attributed pro rata to the federal level.")

GENERIC_NOTE = ("Betrag amtlich (Eurostat). Die Aufteilung auf die Ebenen ist aus den Eurostat-Daten je Aufgabenbereich abgeleitet und innerhalb des Bereichs geschätzt; siehe Methodik.",
                "Amount official (Eurostat). The split across levels is derived from Eurostat data per division and estimated within the division; see methodology.")


def shares(vec):
    tot = sum(vec)
    s = [max(0.0, v / tot) for v in vec]
    s = [round(x, 4) for x in s]
    d = round(1 - sum(s), 4)
    i = s.index(max(s))
    s[i] = round(s[i] + d, 4)
    return {k: v for k, v in zip(LV, s) if v > 0}


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
             "en": "Shares of the payment entitlements of all recipients under Social Code Book II in 2024 (EUR 46.9 billion, Federal Employment Agency statistics). The shares refer to all benefit types together and are applied unchanged to this component. Naturalised persons count as German."},
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
                    "en": "Total government expenditure for 2024 was revised upwards by EUR 7.8 billion in autumn 2026 (mainly investment). The breakdown by function has not been updated yet, so the difference is shown here."},
    "amount": eur(REVISION),
    "levels": dict(zip(LV[:3], norm_shares(rev_pos[:3]))),
    "quality": "derived",
    "sources": ["eurostat_gov_10a_main", "eurostat_gov_10a_exp"],
    "note": {"de": "Gesamtausgaben laut aktueller Datenlieferung (2.147,5 Mrd. Euro) minus Summe der Aufgabenbereiche (2.139,7 Mrd. Euro). Aufteilung auf die Ebenen nach der Revision ihrer Ausgaben ohne Transfers.",
             "en": "Total expenditure in the latest data release (EUR 2,147.5 billion) minus the sum of the functional breakdown (EUR 2,139.7 billion). Split across levels according to the revision of each level's spending excluding transfers."},
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


def RL(id, de, en, amount, lv, quality="official", sources=None, note=None, desc=None, code=None):
    return dict(id=id, de=de, en=en, amount=amount, levels=shares(list(lv)), quality=quality, sources=sources or RSRC, note=note, desc=desc, code=code, fixed=None)


REV = [
    G("rev.taxes", "Steuern", "Taxes", code="D2+D5+D91", children=[
        G("rev.taxes.income", "Steuern auf Einkommen und Gewinne", "Taxes on income and profits", code="D51", children=[
            G("rev.taxes.income.personal", "Lohn- und Einkommensteuer", "Wage and income tax", children=[
                RL("rev.taxes.income.personal.wage_tax", "Lohnsteuer", "Wage tax", WAGE, PIT, quality="derived", sources=RSRC + ["bundeshaushalt_2024", "eurostat_gov_10a_main", "gg_art_106", "gemfinrefg_1"], code="D51M",
                   desc=("Vom Arbeitgeber einbehaltene Einkommensteuer auf Löhne, Gehälter und Pensionen.", "Income tax withheld by employers on wages, salaries and civil-service pensions."),
                   note=("Volkswirtschaftliche Gesamtrechnungen (286,4 Mrd. Euro) abzüglich des Solidaritätszuschlags zur Lohnsteuer (4,1 Mrd. Euro, Kasse), der gesondert ausgewiesen ist. Höher als die kassenmäßige Lohnsteuer (rund 249 Mrd. Euro, hochgerechnet aus dem Bundesanteil von 105,8 Mrd. Euro), unter anderem weil das Kindergeld dort abgezogen wird. Gesetzliche Aufteilung 42,5 % Bund, 42,5 % Länder, 15 % Gemeinden; der Gemeindeanteil der Stadtstaaten zählt in der Statistik zu den Ländern.",
                         "National accounts figure (EUR 286.4 billion) minus the solidarity surcharge on wage tax (EUR 4.1 billion, cash), which is shown separately. Higher than cash wage tax (about EUR 249 billion, extrapolated from the federal share of EUR 105.8 billion), among other things because child benefit is deducted there. Statutory split 42.5% federal, 42.5% states, 15% municipalities; the municipal share of the city states counts as state level in the statistics.")),
                RL("rev.taxes.income.personal.assessed", "Veranlagte Einkommensteuer", "Assessed income tax", ASSESSED, PIT, quality="derived", sources=RSRC + ["bundeshaushalt_2024", "eurostat_gov_10a_main", "gg_art_106", "gemfinrefg_1"], code="D51M",
                   desc=("Einkommensteuer von Selbständigen, Vermietern und anderen, die per Steuerbescheid zahlen, abzüglich Erstattungen an Arbeitnehmer.", "Income tax of the self-employed, landlords and others who pay by assessment, net of refunds to employees."),
                   note=("Volkswirtschaftliche Gesamtrechnungen (62,0 Mrd. Euro) abzüglich des Solidaritätszuschlags zur Einkommensteuer (3,4 Mrd. Euro, Kasse). Aufteilung wie bei der Lohnsteuer.",
                         "National accounts figure (EUR 62.0 billion) minus the solidarity surcharge on assessed income tax (EUR 3.4 billion, cash). Split as for wage tax.")),
            ]),
            RL("rev.taxes.income.capital_income", "Kapitalertragsteuer und Abgeltungsteuer", "Withholding taxes on dividends, interest and capital gains", CAPITAL, CAP, quality="derived", sources=RSRC + ["bundeshaushalt_2024", "gemfinrefg_1"], code="D51M+D51O",
               note=("Volkswirtschaftliche Gesamtrechnungen (53,3 Mrd. Euro) abzüglich des Solidaritätszuschlags (2,9 Mrd. Euro, Kasse). Aufteilung nach den gesetzlichen Anteilen (Dividenden: je 50 % Bund und Länder; Zinsen und Veräußerungsgewinne: 44 % Bund, 44 % Länder, 12 % Gemeinden), gewichtet mit dem Kassenaufkommen 2024.",
                     "National accounts figure (EUR 53.3 billion) minus the solidarity surcharge (EUR 2.9 billion, cash). Split by statutory shares (dividends: 50% federal, 50% states; interest and capital gains: 44% federal, 44% states, 12% municipalities), weighted by 2024 cash receipts.")),
            RL("rev.taxes.income.corporate", "Körperschaftsteuer", "Corporate income tax", CORP, (0.5, 0.5, 0, 0), quality="derived", sources=RSRC + ["bundeshaushalt_2024", "gg_art_106"], code="D51O",
               note=("Volkswirtschaftliche Gesamtrechnungen (42,7 Mrd. Euro) abzüglich des Solidaritätszuschlags zur Körperschaftsteuer (2,2 Mrd. Euro, Kasse). Je zur Hälfte Bund und Länder.",
                     "National accounts figure (EUR 42.7 billion) minus the solidarity surcharge on corporate income tax (EUR 2.2 billion, cash). Half federal, half states.")),
            RL("rev.taxes.income.trade_tax", "Gewerbesteuer", "Local business tax (trade tax)", TRADE, GEW, quality="derived", sources=RSRC + ["eurostat_gov_10a_main", "bundeshaushalt_2024"], code="D51M+D51O",
               note=("Betrag amtlich. Gemeindeanteil aus den Eurostat-Daten zu den Unternehmenssteuern der Gemeinden abgeleitet; Bundesanteil ist die Gewerbesteuerumlage (2,8 Mrd. Euro). Der Länderanteil enthält die Umlage der Länder und die Gewerbesteuer der Stadtstaaten.",
                     "Amount official. Municipal share derived from Eurostat data on municipalities' taxes on corporate income; the federal share is the trade tax levy (EUR 2.8 billion). The state share comprises the states' levy and the trade tax of the city states.")),
            RL("rev.taxes.income.soli", "Solidaritätszuschlag", "Solidarity surcharge", SOLI_TOTAL, C, quality="official", sources=["bundeshaushalt_2024"],
               desc=("Zuschlag von 5,5 % auf Einkommen-, Kapitalertrag- und Körperschaftsteuer; seit 2021 zahlen ihn bei der Einkommensteuer nur noch hohe Einkommen.", "Surcharge of 5.5% on income tax, withholding tax and corporate income tax; since 2021 only high earners pay it on income tax."),
               note=("Kassenaufkommen des Bundes 2024. In den Volkswirtschaftlichen Gesamtrechnungen ist der Zuschlag in den jeweiligen Steuern enthalten; er wurde dort abgezogen.",
                     "Federal cash receipts 2024. In national accounts the surcharge is included in the respective taxes; it has been deducted there.")),
            RL("rev.taxes.income.other", "Einkommensteuern von Steuerausländern und Sonstiges", "Income taxes paid by non-residents and other", OTHER_INC, OTH_INC, quality="derived", sources=RSRC + ["eurostat_gov_10a_main"], code="D51E",
               note=("Einkommensteuer der übrigen Welt (15,2 Mrd. Euro) und EU-Energiekrisenbeitrag (1,9 Mrd. Euro). Aufteilung auf die Ebenen als Rest aus den Eurostat-Daten zu den Einkommensteuern je Ebene.",
                     "Income tax paid by the rest of the world (EUR 15.2 billion) and the EU energy crisis contribution (EUR 1.9 billion). Split across levels as the remainder from Eurostat data on income taxes by level.")),
        ]),
        G("rev.taxes.consumption", "Steuern auf Konsum, Verbrauch und Umwelt", "Taxes on consumption and the environment", code="D2+D59", children=[
            RL("rev.taxes.consumption.vat", "Mehrwertsteuer (Umsatzsteuer)", "Value added tax (VAT)", 298764.0, VAT, sources=RSRC + ["eurostat_gov_10a_main"], code="D211",
               note=("Aufteilung auf die Ebenen laut Eurostat. Der EU-Anteil erscheint als Ausgabe (EU-Beitrag).", "Split across levels as reported by Eurostat. The EU share appears as expenditure (EU contribution).")),
            RL("rev.taxes.consumption.energy", "Energiesteuer (Benzin, Diesel, Heizöl, Gas)", "Energy tax (petrol, diesel, heating oil, gas)", 36579.0, C, code="D214A"),
            RL("rev.taxes.consumption.electricity", "Stromsteuer", "Electricity tax", 5671.0, C, code="D214A"),
            RL("rev.taxes.consumption.tobacco", "Tabaksteuer", "Tobacco tax", 15786.0, C, code="D214A"),
            RL("rev.taxes.consumption.alcohol_coffee", "Alkohol-, Bier-, Schaumwein- und Kaffeesteuer", "Taxes on spirits, beer, sparkling wine and coffee", 1993.0 + 371 + 562 + 996 + 3, (3363.0, 562.0, 0, 0), code="D214A",
               note=("Die Biersteuer (0,6 Mrd. Euro) steht den Ländern zu, der Rest dem Bund.", "Beer tax (EUR 0.6 billion) goes to the states, the rest to the federal level.")),
            RL("rev.taxes.consumption.insurance", "Versicherung- und Feuerschutzsteuer", "Insurance tax and fire protection tax", 18318.0 + 724, (18318.0, 724.0, 0, 0), code="D214G"),
            RL("rev.taxes.consumption.motor_vehicle", "Kfz-Steuer", "Motor vehicle tax", 2310.0 + 7358, C, code="D29B+D59D"),
            RL("rev.taxes.consumption.air_travel", "Luftverkehrsteuer", "Air travel tax", 1877.0, C, code="D214H"),
            RL("rev.taxes.consumption.co2", "CO2-Preis (nationaler und europäischer Emissionshandel)", "Carbon pricing (national and EU emissions trading)", 7671.0 + 10957, C, code="D29F",
               desc=("Erlöse aus der Versteigerung von Emissionsrechten und aus dem nationalen CO2-Preis auf Kraft- und Heizstoffe; fließen in den Klima- und Transformationsfonds des Bundes.",
                     "Proceeds from auctioning emission allowances and from the national carbon price on fuels; they flow into the federal Climate and Transformation Fund.")),
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
                     "Amount official. A municipal tax; about one tenth accrues to the city states, which count as state level in the statistics (derived from Eurostat data by level).")),
            RL("rev.taxes.property.real_estate_transfer", "Grunderwerbsteuer", "Real estate transfer tax", 12750.0, ST, code="D214B"),
            RL("rev.taxes.property.inheritance", "Erbschaft- und Schenkungsteuer", "Inheritance and gift tax", 9991.0, ST, sources=RSRC + ["eurostat_gov_10a_main"], code="D91A"),
            RL("rev.taxes.property.wealth_tax", "Vermögensteuer (wird seit 1997 nicht erhoben)", "Wealth tax (not levied since 1997)", 0.0, ST, sources=RSRC + ["gg_art_106"], code="D59A",
               desc=("Das Vermögensteuergesetz besteht fort, wird aber seit 1997 nicht mehr angewendet. Das Aufkommen stünde den Ländern zu (Art. 106 Abs. 2 Grundgesetz).",
                     "The Wealth Tax Act still exists but has not been applied since 1997. The revenue would go to the states (Article 106(2) of the Basic Law).")),
        ]),
    ]),
    G("rev.contributions", "Sozialbeiträge", "Social contributions", code="D61",
      desc=("Beiträge zur Renten-, Kranken-, Pflege-, Arbeitslosen- und Unfallversicherung. Eurostat weist sie nach Zahlern aus, nicht nach Versicherungszweigen.",
            "Contributions to pension, health, long-term care, unemployment and accident insurance. Eurostat reports them by payer, not by insurance branch."),
      children=[
        RL("rev.contributions.employers", "Arbeitgeberbeiträge zur Sozialversicherung", "Employers' social insurance contributions", 302350.0, SS, sources=RSRC + ["eurostat_gov_10a_main"], code="D611"),
        RL("rev.contributions.employees", "Arbeitnehmerbeiträge zur Sozialversicherung", "Employees' social insurance contributions", 280150.0, SS, code="D613CE"),
        RL("rev.contributions.self_employed", "Pflichtbeiträge der Selbständigen", "Compulsory contributions of the self-employed", 11809.0, SS, code="D613CS"),
        RL("rev.contributions.non_employed", "Beiträge von Rentnern und Leistungsbeziehern", "Contributions of pensioners and benefit recipients", 106054.0, SS, code="D613CN",
           desc=("Vor allem Kranken- und Pflegeversicherungsbeiträge der Rentner sowie Beiträge, die Sozialkassen und Bund für Leistungsbezieher zahlen.", "Mainly health and long-term care contributions of pensioners and contributions paid by social funds and the federal government on behalf of benefit recipients.")),
        RL("rev.contributions.voluntary", "Freiwillige Beiträge", "Voluntary contributions", 8233.0, SS, code="D613V"),
        RL("rev.contributions.imputed", "Unterstellte Beiträge für Beamtenpensionen", "Imputed contributions for civil servants' pensions", 48153.0, (8779.0, 31948.0, 4950.0, 711072.0 - 302350.0 - 406246.0), sources=RSRC + ["eurostat_gov_10a_main"], code="D612",
           desc=("Rechnerische Gegenbuchung für Pensionen und Beihilfen, die der Staat seinen Beamten ohne Beitragszahlung gewährt; kein tatsächlicher Geldfluss.", "Bookkeeping counterpart of pensions and health benefits that government grants its civil servants without contributions; not an actual cash flow.")),
    ]),
    G("rev.other", "Sonstige Einnahmen", "Other revenue", children=[
        RL("rev.other.sales", "Gebühren, Entgelte und Verkäufe", "Fees, charges and sales", 187119.0, (60346.0, 56882.0, 64722.0, 5169.0), sources=["eurostat_gov_10a_main"], code="P11+P12+P131",
           desc=("Zum Beispiel Lkw-Maut, Kita- und Abwassergebühren, Eintrittsgelder, Verwaltungsgebühren.", "For example the truck toll, day-care and sewage charges, admission fees, administrative fees.")),
        RL("rev.other.property_income", "Zinsen, Dividenden und Pachten", "Interest, dividends and rents", 33652.0, (14825.0, 7192.0, 7210.0, 4483.0), sources=["eurostat_gov_10a_main"], code="D4"),
        RL("rev.other.transfers", "Sonstige laufende Übertragungen (u. a. EU-Mittel, Bußgelder)", "Other current transfers (incl. EU funds, fines)", 31463.0, (1966.0 + 2097, 603.0 + 13299, 521.0 + 9671, 3306.0), sources=["eurostat_gov_10a_main"], code="D7"),
        RL("rev.other.capital_transfers", "Vermögensübertragungen (u. a. EU-Investitionszuschüsse)", "Capital transfers (incl. EU investment grants)", 11979.0, (0.55, 0.20, 0.25, 0), quality="estimate", sources=["eurostat_gov_10a_main"], code="D92+D99",
           note=("Betrag amtlich. Eurostat weist die Aufteilung auf die Ebenen nur einschließlich der Zahlungen zwischen den Ebenen aus; die Anteile sind deshalb geschätzt.", "Amount official. Eurostat reports the split by level only including payments between levels; the shares are therefore estimated.")),
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
