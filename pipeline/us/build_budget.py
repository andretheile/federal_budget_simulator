#!/usr/bin/env python3
"""Builds countries/us/budget.json (US federal government, unified budget, fiscal year 2025).

    python3 pipeline/us/build_budget.py            diagnostics: checks against the official tables, reconciliation, leaves
    python3 pipeline/us/build_budget.py --check    rebuild in memory, compare with budget.json and with the indicators
                                                   in country.json; exit status 1 on any difference
    python3 pipeline/us/build_budget.py --write    rebuild and replace countries/us/budget.json

Inputs (all in .cache/, written by fetch_inputs.py; nothing there is executed):
  omb/outlays_fy2027.xlsx    Public Budget Database: outlays by account and subfunction, thousand dollars. Every
                             spending leaf is a set of its rows; every row of fiscal year 2025 lands in exactly one leaf.
  omb/receipts_fy2027.xlsx   Public Budget Database: receipts by account and source. Every revenue leaf is a set of its rows.
  omb/hist01z1, hist02z1, hist03z2, hist10z1 (_fy2027.xlsx)
                             Historical Tables 1.1, 2.1, 3.2 and 10.1: the published totals that the leaves must add up
                             to, and GDP by fiscal year.
  omb/ap_4_tables_fy2027.xlsx  Analytical Perspectives, Table 4-1 (future cost of outstanding student loans).
  mts/*.csv                  Monthly Treasury Statements for September 2025 and 2026 (Treasury's final figures for
                             fiscal years 2025 and 2026): the comparison with OMB, gross receipts and refunds.
  census/, bea/              population (country.json) and NIPA Table 3.18B (national-accounts comparison).

Every amount in budget.json is a sum of rows of the Public Budget Database. Where a leaf is the same set of rows as
a line of Historical Table 3.2, that line is named in the leaf's code and checked here to the million. What is
published and what is arranged by this script is listed in README.md.
"""
import csv, json, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "countries", "us"))
sys.path.insert(0, os.path.join(HERE, "..", "de"))
from xlsx import X  # the generic stdlib reader of the German pipeline

YEAR = "2025"
CENTRAL = {"central": 1}

# ---- reading the sources ----------------------------------------------------------------------------------


def cache(rel):
    path = os.path.join(CACHE, rel)
    if not os.path.exists(path):
        sys.exit("missing %s: run pipeline/us/fetch_inputs.py first" % rel)
    return path


def number(text):
    text = str(text).strip().replace(",", "").lstrip("'")
    if text in ("", "null") or set(text) <= {"."}:
        return 0.0
    return float(text)


def load_pbd(name, meta):
    """Rows of a Public Budget Database workbook: the meta columns named in `meta` and the fiscal year's value in
    thousand dollars."""
    rows = X(cache("omb/" + name)).rows("Sheet1")
    _, head = next(rows)
    col = head.index(YEAR)
    out = []
    for line, r in rows:
        r = r + [""] * (len(head) - len(r))
        row = {key: r[head.index(title)].strip() for key, title in meta.items()}
        row["v"] = int(round(number(r[col])))
        row["line"] = line
        out.append(row)
    return out


OUTLAYS = load_pbd("outlays_fy2027.xlsx", {
    "agency": "Agency Code", "agency_name": "Agency Name", "bureau": "Bureau Code", "bureau_name": "Bureau Name",
    "account": "Account Code", "name": "Account Name", "sub": "Subfunction Code", "onoff": "On- or Off- Budget"})
RECEIPTS = load_pbd("receipts_fy2027.xlsx", {
    "cat": "Source Category Code", "subcat": "Source Subcategory", "agency": "Agency Code", "account": "Account Code",
    "name": "Account Name", "onoff": "On- or Off- Budget"})


def hist_rows(name):
    return [r for _, r in X(cache("omb/" + name)).rows("Table")]


def hist_year_row(name):
    for r in hist_rows(name):
        if r and r[0].strip() == YEAR:
            return [number(v) for v in r[1:]]
    sys.exit("no row %s in %s" % (YEAR, name))


H11 = hist_year_row("hist01z1_fy2027.xlsx")   # receipts, outlays, deficit; on-budget (3); off-budget (3); millions
H21 = hist_year_row("hist02z1_fy2027.xlsx")   # individual, corporate, social insurance (total, on, off), excise, other, total (3)
H101 = hist_year_row("hist10z1_fy2027.xlsx")  # GDP in billions, deflators


def load_h32():
    """Table 3.2: {code: millions} for every subfunction, 'F050' etc. for function totals, 'DOD:<title>' for the
    titles of subfunction 051, and 'TOTAL'."""
    rows = hist_rows("hist03z2_fy2027.xlsx")
    col = rows[2].index(YEAR)
    out, function, members = {}, None, {}
    for r in rows[3:]:
        label = r[0].strip()
        value = number(r[col]) if len(r) > col else 0.0
        head = re.match(r"^(\d{3}) (.*?)(:?)$", label)
        if head and head.group(3) == ":":
            function = head.group(1) if head.group(1).endswith("0") else function
            continue
        if head and not head.group(2).startswith("Subtotal"):
            out[head.group(1)] = value
            members.setdefault(function, []).append(value)
        elif label.startswith("Total outlays"):
            out["TOTAL"] = value
        elif label.startswith("Total,"):
            out["F" + function] = value
        elif function == "050" and not head and not label.startswith("("):
            out["DOD:" + label] = value
    # A function with a single subfunction (570 Medicare, 650 Social Security) has no "Total," line.
    for code, values in members.items():
        out.setdefault("F" + code, sum(values))
    return out


H32 = load_h32()


def load_mts(table, date):
    path = cache("mts/mts_table_%s_%s.csv" % (table, date))
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def mts_value(rows, desc, column, line=None):
    hits = [r for r in rows if r["classification_desc"].strip() == desc and (line is None or r["line_code_nbr"] == line)]
    if len(hits) != 1:
        sys.exit("MTS: %d rows for %r" % (len(hits), desc))
    return number(hits[0][column])


MTS25_4 = load_mts("4", "2025-09-30")
MTS25_9 = load_mts("9", "2025-09-30")
MTS25_1 = load_mts("1", "2025-09-30")
MTS26_4 = load_mts("4", "2026-09-30")
MTS26_1 = load_mts("1", "2026-09-30")


def nipa(series):
    with open(cache("bea/NipaDataA.txt"), encoding="utf-8") as f:
        for row in csv.reader(f):
            if len(row) == 3 and row[0] == series and row[1] == YEAR:
                return number(row[2])
    sys.exit("BEA series %s missing" % series)


def ap41(program):
    """Analytical Perspectives Table 4-1: (outstanding 2024, future cost 2024, outstanding 2025, future cost 2025)."""
    for _, r in X(cache("omb/ap_4_tables_fy2027.xlsx")).rows("Table 1"):
        if r and r[0].strip() == program:
            return [number(v) for v in r[1:5]]
    sys.exit("Table 4-1: no row %r" % program)


# ---- selecting rows ----------------------------------------------------------------------------------------


def matches(row, rule):
    for key, want in rule.items():
        if isinstance(want, (tuple, list)):
            if row[key] not in want:
                return False
        elif row[key] != want:
            return False
    return True


def q(rows=None, strict=True, **rule):
    """Sum in thousand dollars of the rows that match. A figure quoted in a text must come from rows that
    exist: with `strict`, a rule that matches no row stops the build instead of quoting zero."""
    hits = [r["v"] for r in (rows or OUTLAYS) if matches(r, rule)]
    if strict and not hits:
        sys.exit("no row matches %r" % rule)
    return sum(hits)


def sub(*codes, strict=True):
    return q(sub=codes, strict=strict)


def acct(sub_, agency, bureau, account):
    return q(sub=sub_, agency=agency, bureau=bureau, account=account)


def rq(**rule):
    return q(RECEIPTS, **rule)


# ---- numbers in running text -------------------------------------------------------------------------------


def _group(n, sep):
    s = "%d" % n
    out = ""
    while len(s) > 3:
        out = sep + s[-3:] + out
        s = s[:-3]
    return s + out


def _bn(thousands):
    """(integer part, decimal digit) of an absolute amount in billions, rounded to one decimal."""
    tenths = int(round(abs(thousands) / 1e5))
    return tenths // 10, tenths % 10


def en(thousands):
    whole, tenth = _bn(thousands)
    return "$%s.%d billion" % (_group(whole, ","), tenth)


def de(thousands):
    whole, tenth = _bn(thousands)
    return "%s,%d Mrd. Dollar" % (_group(whole, "."), tenth)


def T(de_text, en_text):
    return {"en": en_text, "de": de_text}


# ---- the tree ----------------------------------------------------------------------------------------------
# A leaf takes the rows its `take` rules match, and then every row of its `rest` subfunctions that no `take` rule
# of any leaf has matched. Sources: the ids of countries/us/sources.json.

PBD_OUT = ["omb_pbd_outlays_fy2027"]
H3 = ["omb_hist_fy2027", "omb_pbd_outlays_fy2027"]
PBD_REC = ["omb_pbd_receipts_fy2027"]


def L(id, en_label, de_label, take=(), rest=(), quality="official", sources=None, desc=None, note=None, code=None):
    return dict(id=id, en=en_label, de=de_label, take=list(take), rest=list(rest), quality=quality,
                sources=sources or PBD_OUT, desc=desc, note=note, code=code)


def G(id, en_label, de_label, children, desc=None, code=None):
    return dict(id=id, en=en_label, de=de_label, children=children, desc=desc, code=code)


def S(*codes):
    return {"sub": codes}


def A(sub_, agency, bureau, account):
    return {"sub": sub_, "agency": agency, "bureau": bureau, "account": account}


# Figures quoted in texts (thousand dollars).
F600, F370, F150, F500 = (H32["F600"] * 1000, H32["F370"] * 1000, H32["F150"] * 1000, H32["F500"] * 1000)
EMPLOYER = sub("951", "952")
MORTGAGE = sub("371")
DEPOSIT = sub("373")
OCS = sub("953", "954")
FMS_IN, FMS_OUT = acct("155", "184", "70", "824210"), acct("155", "184", "70", "8242")
STUDENT_LOANS = sub("502") - q(sub="502", agency="018", bureau="45", account="0200") \
    - q(sub="502", agency="018", bureau="40", account="0201") - q(sub="502", agency="018", bureau="45", account="0202") \
    - q(sub="502", agency="015", account="0932")
NEG_SUBSIDY = acct("502", "018", "00", "278110")
SL24_OUT, SL24_COST, SL25_OUT, SL25_COST = ap41("Federal Student Loans")
GROSS_INTEREST, INT_ON, INT_OFF, INT_OTHER, INT_INVEST = (sub(c) for c in ("901", "902", "903", "908", "909"))
NIPA_SMI = nipa("M31809") * 1000  # supplementary medical insurance premiums, netting difference (millions -> thousands)

EXP = [
    G("exp.social_security", "Social Security", "Social Security (gesetzliche Rentenversicherung)", code="650", desc=T(
        "Alters-, Hinterbliebenen- und Erwerbsminderungsrenten aus den beiden Treuhandfonds der Social Security, finanziert vor allem aus Lohnsummensteuern. Die Fonds stehen gesetzlich außerhalb des Haushalts („off-budget“), zählen aber zum Gesamthaushalt und zu seinem Defizit.",
        "Old-age, survivors' and disability benefits paid from the two Social Security trust funds, financed mainly by payroll taxes. By law the trust funds are \"off-budget,\" but they are part of the unified budget and its deficit."), children=[
        L("exp.social_security.oasi", "Old-age and survivors insurance (OASI)", "Alters- und Hinterbliebenenrenten (OASI)",
          rest=["651"], quality="derived", sources=H3, code="651 less 017-00-8007",
          desc=T("Renten für Ruheständler, ihre Ehepartner und Kinder sowie Hinterbliebene, einschließlich der Verwaltungskosten des Fonds.",
                 "Benefits for retired workers, their spouses and children, and survivors, including the trust fund's administrative costs."),
          note=T("Teilfunktion 651 der OMB (%s) ohne den Fonds der Erwerbsminderungsrente: der Old-Age and Survivors Insurance Trust Fund (%s), die Zahlungen des allgemeinen Haushalts an beide Treuhandfonds (%s) und deren Verbuchung als Einnahme der Fonds, die sich aufheben, sowie kleinere Posten, zusammen −%s." % (
              de(sub("651")), de(acct("651", "017", "00", "8006")), de(q(sub="651", agency="016", account="0404")), de(sub("651") - acct("651", "017", "00", "8006") - acct("651", "017", "00", "8007"))),
                 "OMB subfunction 651 (%s) without the Disability Insurance Trust Fund: the Old-Age and Survivors Insurance Trust Fund (%s), the general fund's payments to both trust funds (%s) and their booking as receipts of the trust funds, which cancel out, and smaller items, together −%s." % (
              en(sub("651")), en(acct("651", "017", "00", "8006")), en(q(sub="651", agency="016", account="0404")), en(sub("651") - acct("651", "017", "00", "8006") - acct("651", "017", "00", "8007"))))),
        L("exp.social_security.di", "Disability insurance (DI)", "Erwerbsminderungsrenten (DI)",
          take=[A("651", "017", "00", "8007")], code="017-00-8007",
          desc=T("Renten für Erwerbstätige, die wegen einer Behinderung nicht mehr arbeiten können, und ihre Angehörigen.",
                 "Benefits for workers who can no longer work because of a disability, and their dependents."),
          note=T("Konto „Federal Disability Insurance Trust Fund“ der OMB-Haushaltsdatenbank.", "Account \"Federal Disability Insurance Trust Fund\" of OMB's Public Budget Database.")),
    ]),
    G("exp.medicare", "Medicare", "Medicare (Krankenversicherung der Älteren)", code="570", desc=T(
        "Krankenversicherung für Menschen ab 65 Jahren und für Menschen mit Behinderung. Die Beträge sind netto: Der Haushalt zieht die Beiträge der Versicherten und die Zahlungen der Bundesstaaten für Teil D als Einnahmen von den Ausgaben ab.",
        "Health insurance for people aged 65 and over and for people with disabilities. The amounts are net: the budget deducts the premiums paid by beneficiaries and the states' payments for Part D from spending as offsetting receipts."), children=[
        L("exp.medicare.part_a", "Hospital insurance (Part A)", "Krankenhausversicherung (Teil A)",
          take=[A("571", "009", "38", "8005"), A("571", "009", "00", "800590"), A("571", "009", "00", "800553")], quality="derived", code="009-38-8005",
          desc=T("Krankenhaus, Pflegeeinrichtungen nach einem Klinikaufenthalt, häusliche Pflege, Hospiz.", "Hospital stays, skilled nursing after a hospital stay, home health care, hospice."),
          note=T("Ausgaben des Hospital Insurance Trust Fund (%s) abzüglich der Beiträge freiwillig Versicherter (%s) und Rückzahlungen (%s)." % (
              de(acct("571", "009", "38", "8005")), de(acct("571", "009", "00", "800590")), de(acct("571", "009", "00", "800553"))),
                 "Outlays of the Hospital Insurance Trust Fund (%s) less premiums of voluntary enrollees (%s) and refunds (%s)." % (
              en(acct("571", "009", "38", "8005")), en(acct("571", "009", "00", "800590")), en(acct("571", "009", "00", "800553"))))),
        L("exp.medicare.part_b", "Medical insurance (Part B), net of premiums", "Ambulante Versorgung (Teil B), abzüglich Beiträge",
          take=[A("571", "009", "38", "8004"), A("571", "009", "00", "800450"), A("571", "009", "00", "800470"), A("571", "009", "00", "800445")],
          quality="derived", sources=PBD_OUT + ["bea_nipa_3_18b"], code="009-38-8004",
          desc=T("Arztbesuche, ambulante Behandlung, Medizinprodukte; Teil B ist freiwillig und wird zu etwa einem Viertel aus Beiträgen bezahlt.",
                 "Doctors' services, outpatient care, medical equipment; Part B is voluntary and about a quarter of it is paid for by premiums."),
          note=T("Ausgaben des Supplementary Medical Insurance Trust Fund für Teil B (%s) abzüglich der Beiträge von Älteren (%s) und Menschen mit Behinderung (%s) und Rückzahlungen (%s). In den Volkswirtschaftlichen Gesamtrechnungen zählen die Beiträge zu Teil B und D als Einnahmen (BEA, NIPA-Tabelle 3.18B: %s)." % (
              de(acct("571", "009", "38", "8004")), de(acct("571", "009", "00", "800450")), de(acct("571", "009", "00", "800470")), de(acct("571", "009", "00", "800445")), de(NIPA_SMI)),
                 "Outlays of the Supplementary Medical Insurance Trust Fund for Part B (%s) less premiums of aged (%s) and disabled enrollees (%s) and refunds (%s). The national accounts count the premiums for Parts B and D as revenue (BEA, NIPA Table 3.18B: %s)." % (
              en(acct("571", "009", "38", "8004")), en(acct("571", "009", "00", "800450")), en(acct("571", "009", "00", "800470")), en(acct("571", "009", "00", "800445")), en(NIPA_SMI)))),
        L("exp.medicare.part_d", "Prescription drugs (Part D), net of premiums and state payments", "Arzneimittel (Teil D), abzüglich Beiträge und Zahlungen der Bundesstaaten",
          take=[A("571", "009", "38", "8308"), A("571", "009", "00", "800435"), A("571", "009", "00", "800436")], quality="derived", code="009-38-8308",
          desc=T("Zuschüsse zu privaten Arzneimittelversicherungen der Medicare-Versicherten.", "Subsidies for the private prescription drug plans of Medicare beneficiaries."),
          note=T("Ausgaben des Medicare Prescription Drug Account (%s) abzüglich der über den Bund erhobenen Beiträge (%s) und der Zahlungen der Bundesstaaten für Versicherte, die auch Medicaid erhalten (%s)." % (
              de(acct("571", "009", "38", "8308")), de(acct("571", "009", "00", "800435")), de(acct("571", "009", "00", "800436"))),
                 "Outlays of the Medicare Prescription Drug Account (%s) less premiums collected through the government (%s) and payments of the states for beneficiaries who also receive Medicaid (%s)." % (
              en(acct("571", "009", "38", "8308")), en(acct("571", "009", "00", "800435")), en(acct("571", "009", "00", "800436"))))),
        L("exp.medicare.other", "Fraud control, administration and transfers between the funds", "Betrugsbekämpfung, Verwaltung und Zahlungen zwischen den Fonds",
          rest=["571"], quality="derived", sources=H3, code="571, rest",
          note=T("Rest der Teilfunktion 571 (Medicare, %s): Konto zur Bekämpfung von Betrug und Missbrauch (%s) und kleinere Konten. Enthält auch die Zahlungen des allgemeinen Haushalts an die Medicare-Fonds (%s) und deren Verbuchung als Einnahme der Fonds; beide heben sich fast auf." % (
              de(sub("571")), de(acct("571", "009", "38", "8393")), de(acct("571", "009", "38", "0580"))),
                 "Remainder of subfunction 571 (Medicare, %s): the Health Care Fraud and Abuse Control account (%s) and smaller accounts. Also contains the general fund's payments to the Medicare trust funds (%s) and their booking as receipts of the funds; the two almost cancel out." % (
              en(sub("571")), en(acct("571", "009", "38", "8393")), en(acct("571", "009", "38", "0580"))))),
    ]),
    G("exp.health", "Health", "Gesundheit", code="550", children=[
        L("exp.health.medicaid", "Medicaid (federal share)", "Medicaid (Bundesanteil)", take=[A("551", "009", "38", "0512")], code="009-38-0512",
          desc=T("Zuschüsse des Bundes an die Bundesstaaten für die Gesundheitsversorgung von Menschen mit geringem Einkommen. Den Rest der Kosten tragen die Bundesstaaten; er ist hier nicht enthalten.",
                 "Federal grants to the states for health care for people with low incomes. The states pay the rest of the cost, which is not included here."),
          note=T("Konto „Grants to States for Medicaid“.", "Account \"Grants to States for Medicaid.\"")),
        L("exp.health.chip", "Children's Health Insurance Program (CHIP)", "Krankenversicherung für Kinder (CHIP)", take=[A("551", "009", "38", "0515")], code="009-38-0515",
          desc=T("Zuschüsse an die Bundesstaaten für die Krankenversicherung von Kindern aus Familien knapp oberhalb der Medicaid-Grenze.", "Grants to the states for health insurance of children in families just above the Medicaid limit.")),
        L("exp.health.aca_credits", "Premium tax credits for marketplace insurance (ACA)", "Prämienzuschüsse für Versicherungen der Marktplätze (ACA, „Obamacare“)",
          take=[A("551", "015", "45", "0949")], code="015-45-0949",
          desc=T("Zuschüsse zu Krankenversicherungen, die auf den Marktplätzen des Affordable Care Act gekauft werden, ausgezahlt als Steuergutschrift.",
                 "Subsidies for health insurance bought on the Affordable Care Act marketplaces, paid as a tax credit."),
          note=T("Konto „Refundable Premium Tax Credit“. Ausgabe ist nur der Teil, der über die geschuldete Einkommensteuer hinaus ausgezahlt wird; der Rest mindert die Einkommensteuer.",
                 "Account \"Refundable Premium Tax Credit.\" Only the part paid out beyond the income tax owed counts as spending; the rest reduces income tax revenue.")),
        L("exp.health.other_care", "Other health care services", "Übrige Gesundheitsversorgung", rest=["551"], quality="derived", sources=H3, code="551, rest",
          desc=T("Öffentlicher Gesundheitsdienst (CDC), Gesundheitszentren (HRSA), Indian Health Service, psychische Gesundheit und Suchthilfe (SAMHSA), Krankenversicherung der Bundes- und Postpensionäre, TRICARE for Life für Militärpensionäre, Ausgleichszahlungen zwischen Versicherern der Marktplätze und anderes.",
                 "Public health (CDC), community health centers (HRSA), Indian Health Service, mental health and addiction services (SAMHSA), health benefits of federal and postal retirees, TRICARE for Life for military retirees, risk-adjustment payments between marketplace insurers, and other programs."),
          note=T("Teilfunktion 551 (%s) ohne Medicaid, CHIP und die Prämienzuschüsse." % de(sub("551")), "Subfunction 551 (%s) without Medicaid, CHIP and the premium tax credits." % en(sub("551")))),
        L("exp.health.research", "Health research and training (NIH)", "Gesundheitsforschung und Ausbildung (NIH)", rest=["552"], sources=H3, code="552",
          note=T("Teilfunktion 552, davon National Institutes of Health %s." % de(acct("552", "009", "25", "9915")), "Subfunction 552, of which National Institutes of Health %s." % en(acct("552", "009", "25", "9915")))),
        L("exp.health.safety", "Food, drug and workplace safety", "Lebensmittel-, Arzneimittel- und Arbeitssicherheit", rest=["554"], sources=H3, code="554",
          note=T("Teilfunktion 554: Arzneimittelbehörde FDA, Lebensmittelkontrolle, Arbeitsschutz.", "Subfunction 554: Food and Drug Administration, food safety inspection, occupational safety.")),
    ]),
    L("exp.net_interest", "Net interest", "Nettozinsen", rest=["901", "902", "903", "908", "909"], sources=H3, code="900",
      desc=T("Zinsen auf die Staatsanleihen im Besitz der Öffentlichkeit, abzüglich der Zinsen, die der Bund selbst einnimmt.",
             "Interest on Treasury securities held by the public, less interest the government receives."),
      note=T("Funktion 900 der OMB: Zinsen auf Staatsanleihen %s; abgezogen sind die Zinsen, die bundeseigene Treuhandfonds auf ihre Staatsanleihen erhalten (%s, etwa die Pensionsfonds für Soldaten und Beamte, und %s für die Social-Security-Fonds), da sie innerhalb des Staates bleiben, sowie übrige Zinseinnahmen, vor allem aus Förderkrediten (%s), und Kapitalerträge (%s)." % (
          de(GROSS_INTEREST), de(INT_ON), de(INT_OFF), de(INT_OTHER), de(INT_INVEST)),
             "OMB function 900: interest on Treasury debt securities %s, less the interest that federal trust funds receive on the Treasury securities they hold (%s, for example the military and civil service retirement funds, and %s for the Social Security trust funds), since it stays within the government, and less other interest received, mainly from federal credit programs (%s), and other investment income (%s)." % (
          en(GROSS_INTEREST), en(INT_ON), en(INT_OFF), en(INT_OTHER), en(INT_INVEST)))),
    G("exp.defense", "National defense", "Verteidigung", code="050", children=[
        L("exp.defense.military_personnel", "Military personnel", "Militärpersonal", take=[dict(sub="051", bureau="05")], sources=H3, code="051 Military Personnel",
          desc=T("Sold und Zulagen der aktiven Truppe, der Reserve und der Nationalgarde sowie die Beiträge des Verteidigungsministeriums zu den Fonds für Militärpensionen und für die Krankenversorgung der Pensionäre.",
                 "Pay and allowances of active forces, reserves and the National Guard, and the Defense Department's contributions to the military retirement fund and to retiree health care.")),
        L("exp.defense.operation_maintenance", "Operation and maintenance", "Betrieb und Instandhaltung", take=[dict(sub="051", bureau="10")], sources=H3, code="051 Operation and Maintenance",
          desc=T("Ausbildung, Treibstoff, Ersatzteile, Stützpunkte, das militärische Gesundheitssystem und zivile Beschäftigte.", "Training, fuel, spare parts, bases, the military health system and civilian staff.")),
        L("exp.defense.procurement", "Procurement", "Beschaffung", take=[dict(sub="051", bureau="15")], sources=H3, code="051 Procurement",
          desc=T("Flugzeuge, Schiffe, Fahrzeuge, Raketen, Munition.", "Aircraft, ships, vehicles, missiles, ammunition.")),
        L("exp.defense.rdte", "Research, development, test and evaluation", "Forschung, Entwicklung und Erprobung", take=[dict(sub="051", bureau="20")], sources=H3, code="051 Research, Development, Test, and Evaluation"),
        L("exp.defense.construction_housing", "Military construction and family housing", "Militärbauten und Wohnungen für Soldatenfamilien", take=[dict(sub="051", bureau=("25", "30"))],
          quality="derived", sources=H3, code="051 Military Construction + Family Housing"),
        L("exp.defense.other_dod", "Revolving funds and other defense accounts", "Betriebsmittelfonds und übrige Konten", rest=["051"], sources=H3, code="051 Other",
          note=T("Zeile „Other“ der Tabelle 3.2: Betriebsmittel- und Treuhandfonds des Verteidigungsministeriums, abzüglich Einnahmen.", "Line \"Other\" of Table 3.2: revolving, management and trust funds of the Department of Defense, less receipts.")),
        L("exp.defense.atomic_energy", "Nuclear weapons and other atomic energy defense activities (Department of Energy)", "Atomwaffen und andere militärische Nuklearprogramme (Energieministerium)", rest=["053"], sources=H3, code="053"),
        L("exp.defense.related", "Other defense-related activities", "Übrige verteidigungsbezogene Aufgaben", rest=["054"], sources=H3, code="054",
          desc=T("Nationale Sicherheitsaufgaben des FBI, Cybersicherheit (CISA), Pensionsfonds der CIA und andere.", "National security work of the FBI, cybersecurity (CISA), the CIA retirement system and others."),
          note=T("Teilfunktion 054. Enthält auch die Zahlungen des allgemeinen Haushalts an den Fonds für Militärpensionen (%s) und deren Verbuchung als Einnahme des Fonds; beide heben sich auf." % de(q(sub="054", account="0040")),
                 "Subfunction 054. Also contains the general fund's payment to the Military Retirement Fund (%s) and its booking as a receipt of the fund; the two cancel out." % en(q(sub="054", account="0040")))),
    ]),
    G("exp.income_security", "Income security", "Einkommenssicherung", code="600", desc=T(
        "Leistungen für Menschen mit geringem Einkommen, Arbeitslosenunterstützung und Pensionen der Bundesbediensteten. Die OMB weist für diese Funktion %s aus; hier sind %s an Arbeitgeberbeiträgen der Behörden zu den Pensionsfonds und %s an Nettoeinnahmen aus Hypothekengarantien abgezogen (siehe die beiden Posten)." % (de(F600), de(-EMPLOYER), de(-MORTGAGE)),
        "Benefits for people with low incomes, unemployment compensation and retirement benefits of federal employees. OMB's total for this function is %s; here %s of agencies' employer contributions to the retirement funds and %s of net receipts from mortgage guarantees are deducted (see the two items)." % (en(F600), en(-EMPLOYER), en(-MORTGAGE))), children=[
        G("exp.income_security.nutrition", "Food and nutrition assistance", "Ernährungshilfe", code="605", children=[
            L("exp.income_security.nutrition.snap", "Supplemental Nutrition Assistance Program (SNAP)", "Lebensmittelhilfe SNAP („Food Stamps“)", take=[A("605", "005", "84", "3505")], code="005-84-3505",
              desc=T("Monatliches Guthaben für Lebensmittel für Haushalte mit geringem Einkommen.", "A monthly benefit for buying food for households with low incomes.")),
            L("exp.income_security.nutrition.other", "School meals, WIC and other food assistance", "Schulessen, WIC und andere Ernährungshilfen", rest=["605"], quality="derived", sources=H3, code="605, rest",
              note=T("Teilfunktion 605 ohne SNAP: Schulessen und andere Kinderernährung (%s), Ernährungsprogramm für Schwangere, Mütter und Kleinkinder WIC (%s) und weitere." % (de(acct("605", "005", "84", "3539")), de(acct("605", "005", "84", "3510"))),
                     "Subfunction 605 without SNAP: school meals and other child nutrition (%s), WIC, the Special Supplemental Nutrition Program for Women, Infants, and Children (%s), and others." % (en(acct("605", "005", "84", "3539")), en(acct("605", "005", "84", "3510"))))),
        ]),
        G("exp.income_security.other", "Other income support", "Weitere Leistungen für Geringverdienende", code="609", children=[
            L("exp.income_security.other.ssi", "Supplemental Security Income (SSI)", "Grundsicherung für Ältere und Menschen mit Behinderung (SSI)",
              take=[A("609", "016", "00", "0406"), A("609", "016", "00", "309600")], quality="derived", code="016-00-0406",
              desc=T("Mindestleistung für Ältere, Blinde und Menschen mit Behinderung mit geringem Einkommen und Vermögen, aus Steuermitteln.", "A minimum income for aged, blind and disabled people with little income and few assets, paid from general revenue."),
              note=T("Konto „Supplemental Security Income Program“ (%s) abzüglich zurückgeforderter Überzahlungen (%s)." % (de(acct("609", "016", "00", "0406")), de(acct("609", "016", "00", "309600"))),
                     "Account \"Supplemental Security Income Program\" (%s) less recovered overpayments (%s)." % (en(acct("609", "016", "00", "0406")), en(acct("609", "016", "00", "309600"))))),
            L("exp.income_security.other.eitc", "Earned income tax credit, refundable part", "Steuergutschrift für Erwerbstätige (EITC), ausgezahlter Teil", take=[A("609", "015", "45", "0906")], code="015-45-0906",
              note=T("Ausgabe ist nur der Teil, der über die geschuldete Einkommensteuer hinaus ausgezahlt wird; der Rest mindert die Einkommensteuer.", "Only the part paid out beyond the income tax owed counts as spending; the rest reduces income tax revenue.")),
            L("exp.income_security.other.ctc", "Child tax credit, refundable part", "Kinder-Steuergutschrift, ausgezahlter Teil", take=[A("609", "015", "45", "0922")], code="015-45-0922",
              note=T("Ausgabe ist nur der Teil, der über die geschuldete Einkommensteuer hinaus ausgezahlt wird; der Rest mindert die Einkommensteuer.", "Only the part paid out beyond the income tax owed counts as spending; the rest reduces income tax revenue.")),
            L("exp.income_security.other.tanf", "Temporary Assistance for Needy Families (TANF)", "Sozialhilfe für Familien (TANF)", take=[A("609", "009", "70", "1552")], code="009-70-1552",
              desc=T("Pauschalzuschuss an die Bundesstaaten für Geldleistungen und Dienste für Familien mit Kindern.", "A block grant to the states for cash assistance and services for families with children.")),
            L("exp.income_security.other.rest", "Child care, foster care, refugee assistance and other", "Kinderbetreuung, Pflegefamilien, Flüchtlingshilfe und anderes", rest=["609"], quality="derived", sources=H3, code="609, rest",
              note=T("Rest der Teilfunktion 609 (%s), darunter die pandemiebedingten Steuergutschriften für Arbeitgeber (%s)." % (de(sub("609")), de(acct("609", "015", "45", "0936"))),
                     "Remainder of subfunction 609 (%s), including the pandemic refundable credits for employers (%s)." % (en(sub("609")), en(acct("609", "015", "45", "0936"))))),
        ]),
        L("exp.income_security.unemployment", "Unemployment compensation", "Arbeitslosenunterstützung", rest=["603"], sources=H3, code="603",
          desc=T("Arbeitslosengeld der Bundesstaaten aus dem Arbeitslosenversicherungsfonds des Bundes.", "State unemployment benefits paid from the federal Unemployment Trust Fund.")),
        L("exp.income_security.housing", "Housing assistance, net of mortgage-guarantee receipts", "Wohnungshilfen, abzüglich Einnahmen aus Hypothekengarantien",
          rest=["604", "371"], quality="derived", sources=H3, code="604 + 371",
          desc=T("Mietgutscheine („Section 8“), objektbezogene Mietzuschüsse, Sozialwohnungen, Hilfe für Wohnungslose.", "Rental vouchers (\"Section 8\"), project-based rental assistance, public housing, homeless assistance."),
          note=T("Eigene Zuordnung. Wohnungshilfen (Teilfunktion 604): %s, davon Mietgutscheine %s und objektbezogene Mietzuschüsse %s. Abgezogen: die Nettoeinnahmen der Hypothekengarantien des Bundes (Teilfunktion 371) von %s, vor allem der Hypothekenversicherung der Federal Housing Administration, der Garantiegebühren von Fannie Mae und Freddie Mac und von Ginnie Mae. Der Haushalt bucht sie als negative Ausgaben in der Funktion 370 („Commerce and housing credit“), die insgesamt negativ war (−%s) und deshalb nicht als eigener Posten gezeigt werden kann." % (
              de(sub("604")), de(acct("604", "025", "03", "0302")), de(acct("604", "025", "09", "0303")), de(-MORTGAGE), de(F370)),
                 "Own allocation. Housing assistance (subfunction 604): %s, of which tenant-based vouchers %s and project-based rental assistance %s. Deducted: the net receipts of federal mortgage guarantees (subfunction 371) of %s, mainly from the Federal Housing Administration's mortgage insurance, guarantee fees of Fannie Mae and Freddie Mac, and Ginnie Mae. The budget books them as negative spending in function 370 (\"Commerce and housing credit\"), which as a whole was negative (−%s) and therefore cannot be shown as an item of its own." % (
              en(sub("604")), en(acct("604", "025", "03", "0302")), en(acct("604", "025", "09", "0303")), en(-MORTGAGE), en(F370)))),
        L("exp.income_security.federal_retirement", "Federal civilian and military retirement, net of agency contributions", "Pensionen für Bundesbeamte und Soldaten, abzüglich der Beiträge der Behörden",
          rest=["602", "951", "952"], quality="derived", sources=H3, code="602 + 951 + 952",
          desc=T("Pensionen und Erwerbsminderungsleistungen aus dem Pensionsfonds der zivilen Bundesbediensteten und dem Fonds für Militärpensionen.", "Retirement and disability benefits paid from the Civil Service Retirement and Disability Fund and the Military Retirement Fund."),
          note=T("Eigene Zuordnung. Gezahlte Pensionen (Teilfunktion 602): %s. Abgezogen: %s, die Bundesbehörden als Arbeitgeber für ihr eigenes Personal an die Pensionsfonds, an die Social Security und an Medicare gezahlt haben (Teilfunktionen 951 und 952, „undistributed offsetting receipts“). Diese Beiträge sind bereits als Ausgaben der Behörden gezählt, etwa beim Militärpersonal, und der Haushalt ordnet ihre Gegenbuchung keiner Funktion zu. Der Abzug an dieser Stelle hält die Summe gleich den amtlichen Ausgaben, ohne einen negativen Posten." % (
              de(sub("602")), de(-EMPLOYER)),
                 "Own allocation. Retirement benefits paid (subfunction 602): %s. Deducted: %s that federal agencies paid as employers for their own staff into the retirement funds, Social Security and Medicare (subfunctions 951 and 952, \"undistributed offsetting receipts\"). These contributions are already counted as spending of the agencies, for example under military personnel, and the budget assigns their counterpart to no function. Deducting them here keeps the total equal to official outlays without a negative item." % (
              en(sub("602")), en(-EMPLOYER)))),
        L("exp.income_security.other_retirement", "Railroad retirement and pension insurance (PBGC)", "Eisenbahnerrenten und Insolvenzsicherung von Betriebsrenten (PBGC)", rest=["601"], sources=H3, code="601"),
    ]),
    G("exp.veterans", "Veterans benefits and services", "Leistungen für Veteranen", code="700", children=[
        L("exp.veterans.compensation", "Disability compensation and pensions", "Entschädigungen und Renten", rest=["701"], sources=H3, code="701",
          desc=T("Entschädigung für im Dienst erlittene Gesundheitsschäden und bedürftigkeitsabhängige Renten.", "Compensation for service-connected disabilities and means-tested pensions.")),
        L("exp.veterans.health", "Veterans' health care", "Gesundheitsversorgung", rest=["703"], sources=H3, code="703"),
        L("exp.veterans.education", "Education, training and rehabilitation (GI Bill)", "Bildung und Rehabilitation (GI Bill)", rest=["702"], sources=H3, code="702"),
        L("exp.veterans.other", "Housing loans and other services", "Wohnungsbaukredite und übrige Leistungen", rest=["704", "705"], quality="derived", sources=H3, code="704 + 705"),
    ]),
    G("exp.transportation", "Transportation", "Verkehr", code="400", children=[
        L("exp.transportation.highways", "Highways", "Fernstraßen (Highways)", take=[dict(sub="401", agency="021", bureau="15")], quality="derived", code="021-15 in 401",
          note=T("Konten der Federal Highway Administration in Teilfunktion 401, vor allem Zuschüsse an die Bundesstaaten aus dem Highway Trust Fund.", "Accounts of the Federal Highway Administration in subfunction 401, mainly grants to the states from the Highway Trust Fund.")),
        L("exp.transportation.transit", "Public transit", "Öffentlicher Nahverkehr", take=[dict(sub="401", agency="021", bureau="36")], quality="derived", code="021-36 in 401"),
        L("exp.transportation.rail", "Rail, including Amtrak", "Bahn, einschließlich Amtrak", take=[dict(sub="401", agency="021", bureau="27")], quality="derived", code="021-27 in 401"),
        L("exp.transportation.other_ground", "Highway safety and other ground transportation", "Verkehrssicherheit und übriger Landverkehr", rest=["401"], quality="derived", sources=H3, code="401, rest"),
        L("exp.transportation.air", "Aviation", "Luftverkehr", rest=["402"], sources=H3, code="402",
          desc=T("Flugsicherung und Flughäfen (FAA), Fluggastkontrollen (TSA).", "Air traffic control and airports (FAA), passenger screening (TSA).")),
        L("exp.transportation.water_other", "Coast Guard, shipping and other", "Küstenwache, Schifffahrt und Sonstiges", rest=["403", "407"], quality="derived", sources=H3, code="403 + 407"),
    ]),
    G("exp.justice", "Administration of justice", "Justiz und innere Sicherheit", code="750", children=[
        L("exp.justice.cbp", "Customs and Border Protection (CBP)", "Zoll- und Grenzschutzbehörde (CBP)", take=[dict(sub="751", agency="024", bureau="58")], quality="derived", code="024-58 in 751",
          desc=T("Grenzkontrollen, Grenzpolizei, Zollabfertigung.", "Border checks, the Border Patrol, customs clearance."),
          note=T("Konten der CBP in Teilfunktion 751. Die Zollgebühren, die der Haushalt der Behörde nicht direkt zurechnet, stehen bei der übrigen Strafverfolgung.", "Accounts of CBP in subfunction 751. Customs user fees, which the budget does not attribute to the agency itself, are under other law enforcement.")),
        L("exp.justice.ice", "Immigration and Customs Enforcement (ICE)", "Einwanderungs- und Zollbehörde (ICE)", take=[dict(sub="751", agency="024", bureau="55")], quality="derived", code="024-55 in 751",
          desc=T("Festnahme, Haft und Abschiebung von Ausländern ohne Aufenthaltsrecht; Ermittlungen.", "Arrest, detention and removal of non-citizens without a right to stay; investigations.")),
        L("exp.justice.other_enforcement", "FBI, DEA, Secret Service and other law enforcement, net of fees", "FBI, DEA, Secret Service und übrige Strafverfolgung, abzüglich Gebühren",
          rest=["751"], quality="derived", sources=H3, code="751, rest",
          note=T("Rest der Teilfunktion 751 (%s), einschließlich der gebührenfinanzierten Einwanderungsbehörde USCIS und abzüglich der Einnahmen aus Einwanderungs- und Zollgebühren." % de(sub("751")),
                 "Remainder of subfunction 751 (%s), including the fee-funded immigration services (USCIS) and less receipts from immigration and customs user fees." % en(sub("751")))),
        L("exp.justice.courts", "Courts, prosecutors and marshals", "Gerichte, Staatsanwaltschaften und Marshals", rest=["752"], sources=H3, code="752"),
        L("exp.justice.prisons", "Federal prisons", "Bundesgefängnisse", rest=["753"], sources=H3, code="753"),
        L("exp.justice.assistance", "Justice grants and compensation for victims", "Zuschüsse an die Justiz der Bundesstaaten und Opferentschädigung", rest=["754"], sources=H3, code="754"),
    ]),
    G("exp.community", "Community and regional development", "Kommunal- und Regionalentwicklung", code="450", children=[
        L("exp.community.disaster_relief_fund", "FEMA Disaster Relief Fund", "Katastrophenhilfefonds der FEMA", take=[A("453", "024", "70", "0702")], code="024-70-0702",
          desc=T("Hilfe der Bundesbehörde für Katastrophenschutz nach erklärten Katastrophen.", "Aid of the Federal Emergency Management Agency after declared disasters.")),
        L("exp.community.disaster_other", "Flood insurance, disaster loans and other disaster aid", "Hochwasserversicherung, Katastrophendarlehen und übrige Katastrophenhilfe", rest=["453"], quality="derived", sources=H3, code="453, rest"),
        L("exp.community.development", "Community and regional development grants", "Zuschüsse für Kommunal- und Regionalentwicklung", rest=["451", "452"], quality="derived", sources=H3, code="451 + 452"),
    ]),
    G("exp.natural_resources", "Natural resources and environment", "Umwelt und natürliche Ressourcen", code="300", children=[
        L("exp.natural_resources.pollution", "Pollution control (EPA)", "Umweltschutz (Umweltbehörde EPA)", rest=["304"], sources=H3, code="304"),
        L("exp.natural_resources.water", "Water resources", "Wasserwirtschaft", rest=["301"], sources=H3, code="301",
          desc=T("Bauten und Unterhalt des Corps of Engineers und des Bureau of Reclamation.", "Projects of the Army Corps of Engineers and the Bureau of Reclamation.")),
        L("exp.natural_resources.land", "Conservation and land management, net of offshore royalties", "Naturschutz und Verwaltung bundeseigener Flächen, abzüglich Offshore-Förderabgaben",
          rest=["302", "953", "954"], quality="derived", sources=H3, code="302 + 953 + 954",
          desc=T("Forstverwaltung und Waldbrandbekämpfung, Naturschutzprogramme für Landwirte, Verwaltung der Flächen und Bodenschätze des Bundes.", "Forest Service and wildland fire, conservation programs for farmers, management of federal lands and minerals."),
          note=T("Eigene Zuordnung. Teilfunktion 302: %s, bereits abzüglich der Förderabgaben an Land. Abgezogen außerdem: Pachten und Förderabgaben für Öl und Gas auf dem äußeren Festlandsockel und Verkäufe von Vermögen (Teilfunktionen 953 und 954, %s), die der Haushalt keiner Funktion zuordnet." % (de(sub("302")), de(-OCS)),
                 "Own allocation. Subfunction 302: %s, already net of royalties on public lands. Also deducted: rents and royalties for oil and gas on the Outer Continental Shelf and sales of major assets (subfunctions 953 and 954, %s), which the budget assigns to no function." % (en(sub("302")), en(-OCS)))),
        L("exp.natural_resources.recreation", "National parks and recreation", "Nationalparks und Erholung", rest=["303"], sources=H3, code="303"),
        L("exp.natural_resources.other", "Weather, oceans and other (NOAA)", "Wetter- und Meeresdienst (NOAA) und Sonstiges", rest=["306"], sources=H3, code="306"),
    ]),
    G("exp.education", "Education, training, employment and social services", "Bildung, Ausbildung, Beschäftigung und soziale Dienste", code="500", children=[
        L("exp.education.schools_colleges", "Schools, colleges and student aid, student loans netted", "Schulen, Hochschulen und Studienförderung, Studienkredite saldiert",
          rest=["501", "502", "503"], quality="derived", sources=H3 + ["omb_ap_credit_fy2027"], code="501 + 502 + 503",
          desc=T("Zuschüsse für Schulen mit benachteiligten Schülern (Title I) und für Sonderpädagogik, Pandemiehilfen für Schulen, Pell-Stipendien und die Studienkredite des Bundes.",
                 "Grants to schools for disadvantaged students (Title I) and for special education, pandemic aid to schools, Pell grants and the federal student loans."),
          note=T("Schulen (Teilfunktion 501): %s. Pell-Stipendien und übrige Studienförderung: %s. Die Studienkredite des Bundes senkten die Ausgaben 2025 dagegen um %s: Ein Kredit zählt bei Vergabe mit seinen erwarteten Gesamtkosten, und spätere Änderungen dieser Kosten werden gebucht, sobald sie geschätzt werden. 2025 buchte das Direktkreditprogramm %s als negative Subvention; die OMB schätzt die künftigen Kosten aller ausstehenden Studienkredite Ende 2025 auf %s, nach %s ein Jahr zuvor (Analytical Perspectives, Tabelle 4-1). Weil die Hochschulförderung (Teilfunktion 502) damit insgesamt negativ war (%s), ist sie hier mit Schulen und Bildungsforschung (503) zusammengefasst." % (
              de(sub("501")), de(sub("502") - STUDENT_LOANS), de(-STUDENT_LOANS), de(-NEG_SUBSIDY), de(SL25_COST * 1e6), de(SL24_COST * 1e6), "−" + de(-sub("502"))),
                 "Schools (subfunction 501): %s. Pell grants and other student aid: %s. The federal student loans, by contrast, lowered spending in 2025 by %s: a loan counts at its expected lifetime cost when it is made, and later changes in that cost are booked when they are estimated. In 2025 the Direct Loan program booked %s as negative subsidy; OMB puts the future cost of all outstanding federal student loans at %s at the end of 2025, after %s a year earlier (Analytical Perspectives, Table 4-1). Because higher education (subfunction 502) was negative as a whole (−%s), it is combined here with schools and education research (503)." % (
              en(sub("501")), en(sub("502") - STUDENT_LOANS), en(-STUDENT_LOANS), en(-NEG_SUBSIDY), en(SL25_COST * 1e6), en(SL24_COST * 1e6), en(-sub("502"))))),
        L("exp.education.social_services", "Social services", "Soziale Dienste", rest=["506"], sources=H3, code="506",
          desc=T("Head Start, Kinder- und Jugendhilfe, Altenhilfe, berufliche Rehabilitation.", "Head Start, child welfare, services for the aging, vocational rehabilitation.")),
        L("exp.education.training", "Job training and labor services", "Arbeitsförderung und Arbeitsverwaltung", rest=["504", "505"], quality="derived", sources=H3, code="504 + 505"),
    ]),
    G("exp.agriculture", "Agriculture", "Landwirtschaft", code="350", children=[
        L("exp.agriculture.farm_income", "Farm income support and crop insurance", "Einkommensstützung und Ernteversicherung", rest=["351"], sources=H3, code="351"),
        L("exp.agriculture.research_services", "Agricultural research and services", "Agrarforschung und -dienste", rest=["352"], sources=H3, code="352"),
    ]),
    G("exp.international", "International affairs", "Internationale Angelegenheiten", code="150", desc=T(
        "Die OMB weist für diese Funktion %s aus, einschließlich negativer Ausgaben der internationalen Finanzprogramme." % de(F150),
        "OMB's total for this function is %s, including negative outlays of the international financial programs." % en(F150)), children=[
        L("exp.international.aid", "Development and humanitarian aid", "Entwicklungs- und humanitäre Hilfe", rest=["151"], sources=H3, code="151",
          desc=T("Globale Gesundheitsprogramme, Katastrophen- und Flüchtlingshilfe, Entwicklungshilfe, Nahrungsmittelhilfe, Beiträge zur Weltbanktochter IDA, Millennium Challenge Corporation, Friedenskorps.",
                 "Global health programs, disaster and refugee assistance, development assistance, food aid, contributions to the World Bank's IDA, the Millennium Challenge Corporation, the Peace Corps.")),
        L("exp.international.security", "Security assistance, net of the Foreign Military Sales trust fund", "Sicherheitshilfe, saldiert mit dem Treuhandfonds für Rüstungsexporte (FMS)",
          rest=["152"], take=[A("155", "184", "70", "8242"), A("155", "184", "70", "824210")], quality="derived", sources=H3, code="152 + 184-70-8242",
          note=T("Internationale Sicherheitshilfe (Teilfunktion 152): %s, davon Economic Support Fund %s und Militärfinanzierung für Partnerstaaten (Foreign Military Financing) %s. Saldiert: der Treuhandfonds für Rüstungsverkäufe an ausländische Regierungen (Foreign Military Sales), über den auch die Militärfinanzierung ausgegeben wird; 2025 nahm er %s mehr ein als er auszahlte. Er gehört zur Teilfunktion 155 (internationale Finanzprogramme), die insgesamt negativ war." % (
              de(sub("152")), de(q(sub="152", account="1037")), de(q(sub="152", account="1082")), de(-(FMS_IN + FMS_OUT))),
                 "International security assistance (subfunction 152): %s, of which the Economic Support Fund %s and Foreign Military Financing %s. Netted: the trust fund for arms sales to foreign governments (Foreign Military Sales), through which Foreign Military Financing is also spent; in 2025 it took in %s more than it paid out. It belongs to subfunction 155 (international financial programs), which was negative as a whole." % (
              en(sub("152")), en(q(sub="152", account="1037")), en(q(sub="152", account="1082")), en(-(FMS_IN + FMS_OUT))))),
        L("exp.international.diplomacy", "Diplomacy, embassies and exchanges", "Diplomatie, Botschaften und Austausch", rest=["153", "154", "155"], quality="derived", sources=H3, code="153 + 154 + 155, rest",
          note=T("Teilfunktionen 153 und 154 (%s), abzüglich der Visa- und Passgebühren, sowie der Rest der internationalen Finanzprogramme (%s, vor allem der Devisenstabilisierungsfonds)." % (de(sub("153", "154")), "−" + de(-(sub("155") - FMS_IN - FMS_OUT))),
                 "Subfunctions 153 and 154 (%s), net of visa and passport fees, and the rest of the international financial programs (−%s, mainly the Exchange Stabilization Fund)." % (en(sub("153", "154")), en(-(sub("155") - FMS_IN - FMS_OUT))))),
    ]),
    G("exp.science", "General science, space and technology", "Wissenschaft, Raumfahrt und Technologie", code="250", children=[
        L("exp.science.space", "Space flight and research (NASA)", "Raumfahrt und -forschung (NASA)", rest=["252"], sources=H3, code="252"),
        L("exp.science.basic_research", "General science and basic research", "Grundlagenforschung", rest=["251"], sources=H3, code="251",
          desc=T("Vor allem die National Science Foundation und das Wissenschaftsbüro des Energieministeriums.", "Mainly the National Science Foundation and the Department of Energy's Office of Science.")),
    ]),
    G("exp.general_government", "General government", "Allgemeine Verwaltung", code="800", children=[
        L("exp.general_government.irs", "Internal Revenue Service (IRS)", "Bundessteuerbehörde (IRS)", take=[dict(sub="803", agency="015", bureau="45")], quality="derived", code="015-45 in 803",
          desc=T("Steuerberatung, Steuerprüfung und -vollstreckung, Betrieb und IT der Steuerbehörde. Die auszahlbaren Steuergutschriften, die sie überweist, stehen bei den Programmen, denen sie dienen.",
                 "Taxpayer services, enforcement, operations and IT of the tax agency. The refundable tax credits it pays out are shown with the programs they serve.")),
        L("exp.general_government.fiscal_assistance", "General payments to states and territories", "Allgemeine Zahlungen an Bundesstaaten und Territorien", rest=["806"], sources=H3, code="806"),
        L("exp.general_government.congress", "Congress and legislative agencies", "Kongress und Einrichtungen der Legislative", rest=["801"], sources=H3, code="801"),
        L("exp.general_government.other", "Other general government, net of general receipts", "Übrige allgemeine Verwaltung, abzüglich allgemeiner Einnahmen",
          rest=["802", "803", "804", "805", "808", "809"], quality="derived", sources=H3, code="802-809, rest",
          note=T("Weißes Haus, Finanzverwaltung ohne IRS, Personal- und Liegenschaftsverwaltung, Schadensersatzzahlungen des Bundes; abzüglich allgemeiner Einnahmen des Haushalts (Teilfunktion 809).",
                 "White House, Treasury's fiscal operations other than the IRS, personnel and property management, federal claims and judgments; less general receipts of the budget (subfunction 809).")),
    ]),
    G("exp.energy", "Energy", "Energie", code="270", children=[
        L("exp.energy.supply", "Energy supply", "Energieversorgung", rest=["271"], sources=H3, code="271"),
        L("exp.energy.other", "Energy conservation, Strategic Petroleum Reserve and regulation", "Energieeinsparung, strategische Ölreserve und Regulierung", rest=["272", "274", "276"], quality="derived", sources=H3, code="272 + 274 + 276"),
    ]),
    G("exp.commerce", "Commerce, postal service and deposit insurance", "Wirtschaftsförderung, Post und Einlagensicherung", code="370 without 371", desc=T(
        "Die Funktion „Commerce and housing credit“ der OMB war 2025 negativ (−%s): Die Einnahmen aus Hypothekengarantien und Einlagensicherung überstiegen die Ausgaben. Die Hypothekengarantien sind bei den Wohnungshilfen abgezogen; hier steht der Rest." % de(F370),
        "OMB's function \"Commerce and housing credit\" was negative in 2025 (−%s): receipts from mortgage guarantees and deposit insurance exceeded spending. Mortgage credit is deducted under housing assistance; the rest is here." % en(F370)), children=[
        L("exp.commerce.commerce", "Commerce and small business, net of deposit insurance", "Wirtschafts- und Mittelstandsförderung, abzüglich Einlagensicherung",
          rest=["376", "373"], quality="derived", sources=H3, code="376 + 373",
          note=T("Eigene Zuordnung. Übrige Wirtschaftsförderung (Teilfunktion 376): %s, darunter die Halbleiterförderung nach dem CHIPS Act (%s) und der Universaldienstfonds für Telekommunikation (%s). Abgezogen: die Einlagensicherung (Teilfunktion 373), deren Einnahmen die Kosten um %s überstiegen, vor allem beim Einlagensicherungsfonds der FDIC." % (
              de(sub("376")), de(q(sub="376", account="0520", agency="006")), de(q(sub="376", account="5183")), de(-DEPOSIT)),
                 "Own allocation. Other advancement of commerce (subfunction 376): %s, including semiconductor subsidies under the CHIPS Act (%s) and the Universal Service Fund for telecommunications (%s). Deducted: deposit insurance (subfunction 373), whose receipts exceeded its costs by %s, mainly at the FDIC's Deposit Insurance Fund." % (
              en(sub("376")), en(q(sub="376", account="0520", agency="006")), en(q(sub="376", account="5183")), en(-DEPOSIT)))),
        L("exp.commerce.postal", "Postal Service", "Post (Postal Service)", rest=["372"], sources=H3, code="372",
          note=T("Ausgaben der Post abzüglich ihrer eigenen Einnahmen. Der Postal Service Fund steht gesetzlich außerhalb des Haushalts („off-budget“).", "Outlays of the Postal Service less its own revenue. The Postal Service Fund is \"off-budget\" by law.")),
    ]),
]

# --- revenue --------------------------------------------------------------------------------------------------

MTS_IIT = [mts_value(MTS25_4, d, "current_fytd_gross_rcpt_amt", l) for d, l in (("Withheld", "102"), ("Other", "110"))]
MTS_IIT_REFUNDS = mts_value(MTS25_4, "Total -- Individual Income Taxes", "current_fytd_refund_amt")
MTS_CIT = [mts_value(MTS25_4, "Corporation Income Taxes", c) for c in ("current_fytd_gross_rcpt_amt", "current_fytd_refund_amt")]
MTS_CUSTOMS = [mts_value(MTS25_4, "Customs Duties", c) for c in ("current_fytd_gross_rcpt_amt", "current_fytd_refund_amt")]
MTS26_CUSTOMS = [mts_value(MTS26_4, "Customs Duties", c) for c in ("current_fytd_gross_rcpt_amt", "current_fytd_refund_amt", "current_fytd_net_rcpt_amt")]
MTS26_FED = mts_value(MTS26_4, "Deposit of Earnings, Federal Reserve System", "current_fytd_net_rcpt_amt")
K = 1e-3  # MTS dollars -> thousand dollars

REC_SRC = PBD_REC + ["omb_hist_fy2027"]
REV = [
    L("rev.individual_income", "Individual income taxes", "Einkommensteuer", take=[dict(cat="931")], sources=REC_SRC + ["treasury_mts_2025_09"], code="931",
      note=T("Nach Erstattungen. Laut Monatsausweis des Finanzministeriums für September 2025 (Tabelle 4): einbehaltene Steuer %s, übrige Zahlungen %s, Erstattungen %s." % (de(MTS_IIT[0] * K), de(MTS_IIT[1] * K), de(MTS_IIT_REFUNDS * K)),
             "Net of refunds. Treasury's Monthly Treasury Statement for September 2025 (Table 4): withheld %s, other payments %s, refunds %s." % (en(MTS_IIT[0] * K), en(MTS_IIT[1] * K), en(MTS_IIT_REFUNDS * K)))),
    L("rev.corporate_income", "Corporation income taxes", "Körperschaftsteuer", take=[dict(cat="932")], sources=REC_SRC + ["treasury_mts_2025_09"], code="932",
      note=T("Nach Erstattungen: %s eingenommen, %s erstattet (Monatsausweis September 2025, Tabelle 4)." % (de(MTS_CIT[0] * K), de(MTS_CIT[1] * K)),
             "Net of refunds: %s collected, %s refunded (Monthly Treasury Statement, September 2025, Table 4)." % (en(MTS_CIT[0] * K), en(MTS_CIT[1] * K)))),
    G("rev.social_insurance", "Social insurance and retirement receipts", "Sozialversicherungsbeiträge", code="933", children=[
        G("rev.social_insurance.social_security", "Social Security payroll taxes", "Beiträge zur Social Security", desc=T(
            "6,2 % des Lohns für Arbeitnehmer und Arbeitgeber, also 12,4 %, bis zur Beitragsbemessungsgrenze von 176.100 Dollar im Kalenderjahr 2025, für Selbständige entsprechend. Die Beiträge fließen in die Treuhandfonds der Social Security und stehen gesetzlich außerhalb des Haushalts („off-budget“).",
            "6.2% of wages each for employees and employers, 12.4% in all, up to the taxable maximum of $176,100 in calendar year 2025, and the same for the self-employed. The taxes go to the Social Security trust funds and are \"off-budget\" by law."), children=[
            L("rev.social_insurance.social_security.oasi", "Old-age and survivors insurance (OASI)", "Alters- und Hinterbliebenenrente (OASI)",
              take=[dict(cat="933", account=("800610", "800611"))], sources=REC_SRC + ["irs_pub15_2025"], code="020-800610 + 800611"),
            L("rev.social_insurance.social_security.di", "Disability insurance (DI)", "Erwerbsminderungsrente (DI)",
              take=[dict(cat="933", account=("800701", "800711"))], sources=REC_SRC + ["irs_pub15_2025"], code="020-800701 + 800711"),
        ]),
        L("rev.social_insurance.medicare", "Medicare payroll taxes (Hospital Insurance)", "Medicare-Beiträge (Krankenhausversicherung)",
          take=[dict(cat="933", account=("800501", "800511", "800510"))], sources=REC_SRC + ["irs_pub15_2025"], code="009-800501 + 800511 + 800510",
          desc=T("1,45 % des Lohns für Arbeitnehmer und Arbeitgeber ohne Obergrenze, dazu 0,9 % für Arbeitnehmer auf den Teil des Lohns über 200.000 Dollar.", "1.45% of wages each for employees and employers, without a cap, plus 0.9% for employees on wages above $200,000.")),
        L("rev.social_insurance.unemployment", "Unemployment insurance taxes", "Beiträge zur Arbeitslosenversicherung", take=[dict(cat="933", subcat="10")], sources=REC_SRC, code="933-10",
          desc=T("Einzahlungen der Bundesstaaten aus ihren Arbeitgeberabgaben und die Arbeitslosensteuer des Bundes (FUTA).", "Deposits of the states from their employer taxes, and the federal unemployment tax (FUTA).")),
        L("rev.social_insurance.federal_employees", "Federal employees' retirement contributions", "Pensionsbeiträge der Bundesbediensteten", take=[dict(cat="933", subcat="15")], sources=REC_SRC, code="933-15"),
        L("rev.social_insurance.railroad", "Railroad retirement taxes", "Beiträge zur Eisenbahnerrente", take=[dict(cat="933", account=("801020", "801021", "801120"))], quality="derived", sources=REC_SRC, code="060-801020 + 801021 + 801120"),
    ]),
    G("rev.excise", "Excise taxes", "Verbrauchsteuern", code="934", children=[
        L("rev.excise.highway", "Fuel and truck taxes (Highway Trust Fund)", "Kraftstoff- und Lkw-Steuern (Highway Trust Fund)", take=[dict(cat="934", account=("810210", "810211"))], sources=REC_SRC, code="069-810210 + 810211"),
        L("rev.excise.aviation", "Aviation taxes (Airport and Airway Trust Fund)", "Luftverkehrsteuern (Airport and Airway Trust Fund)", take=[dict(cat="934", account="810310")], sources=REC_SRC, code="069-810310"),
        L("rev.excise.tobacco", "Tobacco taxes", "Tabaksteuer", take=[dict(cat="934", account="015500")], sources=REC_SRC, code="015500"),
        L("rev.excise.alcohol", "Alcohol taxes", "Alkoholsteuer", take=[dict(cat="934", account="015600")], sources=REC_SRC, code="015600"),
        L("rev.excise.stock_buybacks", "Excise tax on stock buybacks", "Steuer auf Aktienrückkäufe", take=[dict(cat="934", account="015220")], sources=REC_SRC, code="015220",
          desc=T("Steuer auf den Rückkauf eigener Aktien durch börsennotierte Unternehmen.", "Tax on repurchases of their own shares by listed corporations.")),
        L("rev.excise.other", "Other excise taxes", "Übrige Verbrauchsteuern", rest=["934"], quality="derived", sources=REC_SRC, code="934, rest",
          note=T("Unter anderem die Abgabe der Hersteller von Markenarzneimitteln (%s), Abgaben für den Superfund und den Ölunfallfonds, Waffen- und Munitionssteuer; abzüglich der Kraftstoffsteuer-Gutschriften, die aus dem allgemeinen Haushalt gezahlt werden (%s)." % (de(rq(account="800408")), de(-rq(account="015800"))),
                 "Among them the fee on branded prescription drug manufacturers (%s), taxes for the Superfund and the Oil Spill Liability Trust Fund, taxes on firearms and ammunition; less fuel tax credits paid from the general fund (%s)." % (en(rq(account="800408")), en(-rq(account="015800"))))),
    ]),
    L("rev.customs", "Customs duties", "Zölle", take=[dict(cat="936")], sources=REC_SRC + ["treasury_mts_2025_09", "treasury_mts_2026_09"], code="936",
      desc=T("Zölle auf eingeführte Waren und die Hafenunterhaltungsgebühr.", "Duties on imported goods, and the harbor maintenance fee."),
      note=T("Nach Erstattungen: %s erhoben, %s erstattet (Monatsausweis September 2025, Tabelle 4). Im Haushaltsjahr 2026 waren es %s erhoben, %s erstattet und %s netto (Monatsausweis September 2026)." % (
          de(MTS_CUSTOMS[0] * K), de(MTS_CUSTOMS[1] * K), de(MTS26_CUSTOMS[0] * K), de(MTS26_CUSTOMS[1] * K), de(MTS26_CUSTOMS[2] * K)),
             "Net of refunds: %s collected, %s refunded (Monthly Treasury Statement, September 2025, Table 4). In fiscal year 2026, %s was collected, %s refunded and %s kept (Monthly Treasury Statement, September 2026)." % (
          en(MTS_CUSTOMS[0] * K), en(MTS_CUSTOMS[1] * K), en(MTS26_CUSTOMS[0] * K), en(MTS26_CUSTOMS[1] * K), en(MTS26_CUSTOMS[2] * K)))),
    L("rev.estate_gift", "Estate and gift taxes", "Erbschaft- und Schenkungsteuer", take=[dict(cat="935")], sources=REC_SRC, code="935"),
    G("rev.miscellaneous", "Miscellaneous receipts", "Sonstige Einnahmen", code="937", children=[
        L("rev.miscellaneous.federal_reserve", "Earnings of the Federal Reserve", "Gewinnabführung der Federal Reserve", take=[dict(cat="937", account="065000")], sources=REC_SRC + ["treasury_mts_2026_09"], code="065000",
          note=T("Im Haushaltsjahr 2026: %s (Monatsausweis September 2026)." % de(MTS26_FED * K), "Fiscal year 2026: %s (Monthly Treasury Statement, September 2026)." % en(MTS26_FED * K))),
        L("rev.miscellaneous.other", "Fees, fines and other receipts", "Gebühren, Strafen und übrige Einnahmen", rest=["937"], quality="derived", sources=REC_SRC, code="937, rest",
          note=T("Unter anderem Beiträge der Telekommunikationsanbieter zum Universaldienstfonds (%s), Einnahmen des Ausgleichsprogramms zwischen Versicherern der Marktplätze (%s), Strafen und Einziehungen." % (de(rq(account="518310")), de(rq(account="573310"))),
                 "Among them the telecommunications carriers' contributions to the Universal Service Fund (%s), receipts of the risk-adjustment program between marketplace insurers (%s), fines and forfeitures." % (en(rq(account="518310")), en(rq(account="573310"))))),
    ]),
]

# ---- assigning rows to leaves ----------------------------------------------------------------------------------


def leaves(nodes):
    for n in nodes:
        if "children" in n:
            yield from leaves(n["children"])
        else:
            yield n


def assign(nodes, rows, rest_key):
    """Give every row to exactly one leaf; returns {leaf id: thousand dollars} and the rows nobody took."""
    owner = {}
    for leaf in leaves(nodes):
        for rule in leaf["take"]:
            hits = [i for i, r in enumerate(rows) if matches(r, rule)]
            if not hits:
                sys.exit("%s: rule %r matches no row" % (leaf["id"], rule))
            for i in hits:
                if i in owner:
                    sys.exit("row %d taken by both %s and %s" % (rows[i]["line"], owner[i], leaf["id"]))
                owner[i] = leaf["id"]
    rest = {}
    for leaf in leaves(nodes):
        for code in leaf["rest"]:
            if code in rest:
                sys.exit("%s is the rest of both %s and %s" % (code, rest[code], leaf["id"]))
            rest[code] = leaf["id"]
    for i, r in enumerate(rows):
        if i not in owner and r[rest_key] in rest:
            owner[i] = rest[r[rest_key]]
    amounts = {leaf["id"]: 0 for leaf in leaves(nodes)}
    for i, leaf_id in owner.items():
        amounts[leaf_id] += rows[i]["v"]
    unassigned = [r for i, r in enumerate(rows) if i not in owner and r["v"] != 0]
    return amounts, unassigned


EXP_AMOUNTS, EXP_LEFT = assign(EXP, OUTLAYS, "sub")
REV_AMOUNTS, REV_LEFT = assign(REV, RECEIPTS, "cat")
if EXP_LEFT or REV_LEFT:
    for r in EXP_LEFT + REV_LEFT:
        print("unassigned:", r)
    sys.exit("rows with a value are left without a leaf")
for amounts in (EXP_AMOUNTS, REV_AMOUNTS):
    for leaf_id, v in amounts.items():
        if v < 0:
            sys.exit("%s is negative (%d thousand dollars); the pack format allows no negative amounts" % (leaf_id, v))

# ---- output ------------------------------------------------------------------------------------------------------


def out_node(n, amounts):
    o = {"id": n["id"], "label": {"en": n["en"], "de": n["de"]}}
    if n.get("desc"):
        o["description"] = n["desc"]
    if n.get("code"):
        o["code"] = n["code"]
    if "children" in n:
        o["children"] = [out_node(c, amounts) for c in n["children"]]
        return o
    o["amount"] = amounts[n["id"]] * 1000
    o["levels"] = dict(CENTRAL)
    o["quality"] = n["quality"]
    o["sources"] = n["sources"]
    if n.get("note"):
        o["note"] = n["note"]
    return o


def build():
    return {"revenue": [out_node(n, REV_AMOUNTS) for n in REV], "expenditure": [out_node(n, EXP_AMOUNTS) for n in EXP]}


def dumps(budget):
    return json.dumps(budget, ensure_ascii=False, indent=2) + "\n"


def tot(nodes):
    return sum(tot(n["children"]) if "children" in n else n["amount"] for n in nodes)


# ---- checks against the published tables ----------------------------------------------------------------------


def checks(budget):
    """Returns a list of problems; prints the comparisons."""
    problems = []
    rev, exp = tot(budget["revenue"]), tot(budget["expenditure"])
    print("totals, million dollars        pack (PBD)    OMB Table 1.1   difference")
    for name, mine, official in (("receipts", rev, H11[0]), ("outlays", exp, H11[1]), ("surplus or deficit (-)", rev - exp, H11[2])):
        diff = mine / 1e6 - official
        print("  %-26s %14.3f %14.0f %10.3f" % (name, mine / 1e6, official, diff))
        if abs(diff) > 0.5:
            problems.append("%s differs from Table 1.1 by %.3f million" % (name, diff))
    # every subfunction of Table 3.2 against the sum of its PBD rows
    worst = 0.0
    for code, official in H32.items():
        if re.fullmatch(r"\d{3}", code):
            mine = sub(code, strict=False) / 1000
            diff = mine - official
            worst = max(worst, abs(diff))
            if abs(diff) > 1:
                problems.append("subfunction %s: PBD %.3f, Table 3.2 %.0f million" % (code, mine, official))
    titles = {"05": "Military Personnel", "10": "Operation and Maintenance", "15": "Procurement",
              "20": "Research, Development, Test, and Evaluation", "25": "Military Construction", "30": "Family Housing"}
    for bureau, title in titles.items():
        diff = q(sub="051", bureau=bureau) / 1000 - H32["DOD:" + title]
        worst = max(worst, abs(diff))
        if abs(diff) > 1:
            problems.append("051 %s: PBD differs from Table 3.2 by %.3f million" % (title, diff))
    print("subfunctions and defence titles: largest difference PBD vs Table 3.2 %.3f million" % worst)
    # revenue groups against Table 2.1
    for name, mine, official in (("individual income taxes", rq(cat="931"), H21[0]), ("corporation income taxes", rq(cat="932"), H21[1]),
                                 ("social insurance", rq(cat="933"), H21[2]), ("excise taxes", rq(cat="934"), H21[5]),
                                 ("other receipts", rq(cat=("935", "936", "937")), H21[6])):
        diff = mine / 1000 - official
        if abs(diff) > 1:
            problems.append("%s: PBD %.3f, Table 2.1 %.0f million" % (name, mine / 1000, official))
    return problems


def reconciliation():
    """OMB against Treasury's final statement for fiscal year 2025, by function (billion dollars)."""
    mts_total = [mts_value(MTS25_1, "Year-to-Date", c, "280") for c in ("current_month_gross_rcpt_amt", "current_month_gross_outly_amt", "current_month_dfct_sur_amt")]
    print("\nfiscal year 2025, billion dollars      OMB (pack)     Treasury MTS   OMB - MTS")
    omb_total = (H11[0], H11[1], -H11[2])  # Table 1.1 signs a deficit negative, the MTS line counts it positive
    for i, name in enumerate(("receipts", "outlays", "deficit")):
        print("  %-34s %12.3f %14.3f %10.3f" % (name, omb_total[i] / 1e3, mts_total[i] / 1e9, omb_total[i] / 1e3 - mts_total[i] / 1e9))
    names = {"050": "National Defense", "150": "International Affairs", "250": "General Science, Space, and Technology", "270": "Energy",
             "300": "Natural Resources and Environment", "350": "Agriculture", "370": "Commerce and Housing Credit", "400": "Transportation",
             "450": "Community and Regional Development", "500": "Education, Training, Employment, and Social Services", "550": "Health",
             "570": "Medicare", "600": "Income Security", "650": "Social Security", "700": "Veterans Benefits and Services",
             "750": "Administration of Justice", "800": "General Government", "900": "Net Interest", "950": "Undistributed Offsetting Receipts"}
    groups = {n["code"]: n for n in EXP}
    print("  by function                          OMB 3.2   Treasury Tab. 9   OMB - MTS     pack group")
    for code, name in names.items():
        omb = H32["F" + code] / 1e3
        mts = mts_value(MTS25_9, name, "current_fytd_rcpt_outly_amt") / 1e9
        node = groups.get(code) or groups.get(code + " without 371")
        pack = (tot([out_node(node, EXP_AMOUNTS)]) / 1e9) if node else 0.0
        print("  %s %-31s %10.3f %14.3f %11.3f %14.3f" % (code, name[:31], omb, mts, omb - mts, pack))
    fy26 = [mts_value(MTS26_1, "Year-to-Date", c, "280") for c in ("current_month_gross_rcpt_amt", "current_month_gross_outly_amt", "current_month_dfct_sur_amt")]
    print("fiscal year 2026 (Treasury, September 2026 statement): receipts %.3f, outlays %.3f, deficit %.3f billion" % tuple(x / 1e9 for x in fy26))
    print("national accounts, fiscal year 2025 (BEA NIPA Table 3.18B, billion): budget receipts %.3f, budget outlays %.3f, "
          "NIPA current receipts %.3f, current expenditures %.3f, net federal saving %.3f" % tuple(
              nipa(s) / 1e3 for s in ("M31801", "M31819", "M31818", "M31849", "M31856")))
    print("own allocations (billion): employer contributions %.3f -> federal pensions; mortgage credit %.3f -> housing; "
          "deposit insurance %.3f -> commerce; offshore royalties and asset sales %.3f -> land management" % (
              EMPLOYER / 1e6, MORTGAGE / 1e6, DEPOSIT / 1e6, OCS / 1e6))


def indicators():
    """GDP (Table 10.1) and population (Census) as they must stand in country.json."""
    gdp = round(H101[0] * 1e9)
    with open(cache("census/NST-EST2025-ALLDATA.csv"), encoding="latin-1") as f:
        us = [r for r in csv.DictReader(f) if r["SUMLEV"] == "010"]
    return {"gdp": gdp, "population": int(us[0]["POPESTIMATE" + YEAR])}


def check_country():
    path = os.path.join(OUT, "country.json")
    country = json.load(open(path, encoding="utf-8"))
    problems = []
    for key, value in indicators().items():
        have = country["indicators"][key]["value"]
        if have != value:
            problems.append("country.json %s is %s, the source gives %s" % (key, have, value))
    if country["baseYear"] != int(YEAR):
        problems.append("country.json baseYear is %s, the build is for %s" % (country["baseYear"], YEAR))
    return problems


if __name__ == "__main__":
    path = os.path.join(OUT, "budget.json")
    budget = build()
    text = dumps(budget)
    problems = checks(budget)
    if "--check" in sys.argv:
        problems += check_country()
        same = os.path.exists(path) and open(path, encoding="utf-8").read() == text
        print("budget.json is", "identical to the rebuilt version" if same else "DIFFERENT from the rebuilt version")
        for p in problems:
            print("PROBLEM:", p)
        sys.exit(0 if same and not problems else 1)
    for p in problems:
        print("PROBLEM:", p)
    if problems:
        sys.exit(1)
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:  # write next to the target, then swap
            f.write(text)
        os.replace(tmp, path)
        print("wrote", path)
    else:
        reconciliation()
        print("\nindicators for country.json:", indicators())
        print("\nleaves, billion dollars")
        for side in ("revenue", "expenditure"):
            for top in budget[side]:
                print("  %-58s %10.3f" % (top["id"], tot([top]) / 1e9))
                for leaf in leaves([top]):
                    if leaf is not top:
                        print("      %-54s %10.3f  %s" % (leaf["id"], leaf["amount"] / 1e9, leaf["quality"]))
    r, e = tot(budget["revenue"]), tot(budget["expenditure"])
    print("revenue %.3f bn, expenditure %.3f bn, balance %.3f bn" % (r / 1e9, e / 1e9, (r - e) / 1e9))
