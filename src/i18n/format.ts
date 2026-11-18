/**
 * Numbers, money, shares and dates for one language, all through `Intl`.
 *
 * Money is written the way a newspaper would: "12,4 Mrd. €" in German, "€12.4bn" in English.
 * `Intl`'s own compact notation would turn 2,028 billion into "2 Bio. €" / "€2tn"; budget figures
 * are discussed in billions, so the unit is capped there: the locale's compact pattern is taken
 * from `Intl` and the number inside it is replaced by our own.
 */
import type { NumberParam } from "../engine/index.ts";
import { baseLanguage, hasDictionary, intlLocale, localize, messagesFor, type Messages } from "./index.ts";

export interface SignOptions {
  /** Write "+" in front of positive values. Zero never gets a sign. */
  signed?: boolean;
}

export interface MoneyOptions extends SignOptions {
  /** Drop a trailing ",0": "20 Mrd. €" instead of "20,0 Mrd. €". For round, chosen values such as slider settings. */
  trim?: boolean;
}

export interface Formatters {
  language: string;
  /** Compact from a million up, exact below: "12,4 Mrd. €", "60,5 Mio. €", "1.430 €". */
  money(value: number, options?: MoneyOptions): string;
  /** A fraction as a percentage with a fixed number of decimals (default 1): 0.028 -> "2,8 %". */
  percent(fraction: number, options?: SignOptions & { digits?: number }): string;
  /** An unsigned share that never rounds a real amount to "0 %": "41,1 %", "0,04 %", "weniger als 0,01 %". */
  share(fraction: number): string;
  number(value: number, options?: SignOptions & { digits?: number }): string;
  /** People, households and other things that are counted, to three significant digits: "1,23 Mio.", "12.400". */
  count(value: number): string;
  /** The value of a policy parameter in its unit. */
  param(param: NumberParam, value: number): string;
  /** Money to the last unit, never compact: "1.000.000 €", "€277,825". For values someone typed or will type. */
  exactMoney(value: number, options?: SignOptions): string;
  /** An amount that may be below one unit, which is then written to one significant digit: "0,001 XTS". */
  smallMoney(value: number): string;
  /** The currency's symbol as this language writes it: "€". */
  currencySymbol: string;
  /** The currency's name for running text: "Euro" in German, "euro" in English. */
  currencyName: string;
  /** A number someone typed in this language: "66.760" and "23,97" in German, "66,760" and "23.97" in English. NaN if it is none. */
  parse(text: string): number;
  /** An ISO date (YYYY-MM-DD). */
  date(iso: string): string;
  /** A language's own name: "Deutsch", "English". */
  languageName(code: string): string;
}

const MINUS = "−";
const NUMERIC_PARTS = new Set(["integer", "group", "decimal", "fraction"]);
/** From here on a value is written in millions; 999,500 would already round to "1,0 Mio.". */
const COMPACT_FROM = 999_500;
const BILLIONS_FROM = 999_500_000;

/** Number of decimals needed to show multiples of `step`: 1 -> 0, 0.5 -> 1, 0.25 -> 2. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  for (let digits = 0; digits <= 6; digits++) {
    const scaled = step * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return digits;
  }
  return 6;
}

function typographicMinus(text: string): string {
  return text.replace(/-/g, MINUS);
}

interface CompactPattern {
  /** The parts around the number, with one placeholder where the number goes. */
  parts: { type: string; value: string }[];
  /** What "1" in this pattern stands for: 1e9 for "Mrd.", 1e6 for "Mio.". */
  unit: number;
}

export function createFormatters(
  language: string,
  currency: string,
  messages: Messages = messagesFor(language),
): Formatters {
  const locale = intlLocale(language);
  const base = { numberingSystem: "latn" } as const;
  const cache = new Map<string, Intl.NumberFormat>();
  const numberFormat = (key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat => {
    let format = cache.get(key);
    if (!format) cache.set(key, (format = new Intl.NumberFormat(locale, { ...base, ...options })));
    return format;
  };
  const sign = (signed: boolean | undefined): Intl.NumberFormatOptions["signDisplay"] =>
    signed ? "exceptZero" : "auto";

  const plain = (value: number, min: number, max: number): string =>
    numberFormat(`plain:${min}:${max}`, { minimumFractionDigits: min, maximumFractionDigits: max }).format(value);

  /**
   * Our own abbreviation for the unit, if this language has a dictionary of its own that gives one
   * and the locale counts in millions and billions. A language shown with the English fallback
   * dictionary keeps the abbreviations of its own locale.
   */
  const ownWords = hasDictionary(language);
  const abbreviation = (unit: number): string | undefined =>
    !ownWords ? undefined : unit === 1e9 ? messages.units.billion : unit === 1e6 ? messages.units.million : undefined;
  const named = <T extends { type: string; value: string }>(part: T, unit: number): T =>
    part.type === "compact" ? { ...part, value: abbreviation(unit) ?? part.value } : part;

  const patterns = new Map<string, CompactPattern | null>();
  /** The locale's compact currency pattern around a sample of the given size, e.g. ["−", N, " ", "Mrd.", " ", "€"]. */
  const compactPattern = (sample: number, negative: boolean, signed: boolean): CompactPattern | null => {
    const key = `${sample}:${negative}:${signed}`;
    const known = patterns.get(key);
    if (known !== undefined) return known;
    const parts = numberFormat(`compact:${signed}`, {
      style: "currency",
      currency,
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 1,
      signDisplay: sign(signed),
    }).formatToParts(negative ? -sample : sample);
    let shown = "";
    const out: CompactPattern["parts"] = [];
    for (const part of parts) {
      if (NUMERIC_PARTS.has(part.type)) {
        if (part.type === "integer" || part.type === "fraction") shown += part.value;
        else if (part.type === "decimal") shown += ".";
        if (out[out.length - 1]?.type !== "number") out.push({ type: "number", value: "" });
      } else {
        out.push({ type: part.type, value: part.type === "minusSign" ? MINUS : part.value });
      }
    }
    const number = Number(shown);
    const hasUnit = parts.some((part) => part.type === "compact");
    const unit = sample / number;
    const pattern =
      hasUnit && Number.isFinite(number) && number > 0 ? { parts: out.map((part) => named(part, unit)), unit } : null;
    patterns.set(key, pattern);
    return pattern;
  };

  const exactMoney = (value: number, signed: boolean | undefined): string => {
    const digits = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0;
    // A value that rounds to zero must not keep its sign ("−0 €").
    const rounded = Number(value.toFixed(digits));
    return typographicMinus(
      numberFormat(`money:${digits}:${signed}`, {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
        signDisplay: sign(signed),
      }).format(rounded === 0 ? 0 : rounded),
    );
  };

  const money: Formatters["money"] = (value, options = {}) => {
    if (!Number.isFinite(value)) return "–";
    const abs = Math.abs(value);
    if (abs < COMPACT_FROM) return exactMoney(value, options.signed);
    const pattern = compactPattern(abs >= BILLIONS_FROM ? 1.5e9 : 1.5e6, value < 0, options.signed === true);
    if (!pattern) return exactMoney(value, options.signed);
    const scaled = abs / pattern.unit;
    const billions = pattern.unit >= 1e9;
    const max = billions || scaled < 99.95 ? 1 : 0;
    const min = billions && !options.trim ? 1 : 0;
    const number = plain(scaled, Math.min(min, max), max);
    return pattern.parts.map((part) => (part.type === "number" ? number : part.value)).join("");
  };

  const percent: Formatters["percent"] = (fraction, options = {}) => {
    const digits = options.digits ?? 1;
    const rounded = Number((fraction * 100).toFixed(digits)) / 100;
    return typographicMinus(
      numberFormat(`percent:${digits}:${options.signed}`, {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: sign(options.signed),
      }).format(rounded === 0 ? 0 : rounded),
    );
  };

  const share: Formatters["share"] = (fraction) => {
    const abs = Math.abs(fraction);
    if (!Number.isFinite(abs)) return "–";
    if (abs === 0) return percent(0, { digits: 0 });
    if (abs < 0.00005) return messages.common.lessThan(percent(0.0001, { digits: 2 }));
    if (abs < 0.00095) return percent(abs, { digits: 2 });
    if (abs < 0.9995) return percent(abs, { digits: 1 });
    return percent(abs, { digits: 0 });
  };

  const number: Formatters["number"] = (value, options = {}) => {
    const digits = options.digits ?? 0;
    return typographicMinus(
      numberFormat(`number:${digits}:${options.signed}`, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: sign(options.signed),
      }).format(value),
    );
  };

  const count: Formatters["count"] = (value) => {
    const abs = Math.abs(value);
    const compact = abs >= COMPACT_FROM;
    const format = numberFormat(`count:${compact}`, {
      notation: compact ? "compact" : "standard",
      compactDisplay: "short",
      maximumSignificantDigits: 3,
    });
    if (!compact) return typographicMinus(format.format(value));
    const unit = abs >= BILLIONS_FROM ? 1e9 : 1e6;
    return typographicMinus(
      format
        .formatToParts(value)
        .map((part) => named(part, unit).value)
        .join(""),
    );
  };

  const param: Formatters["param"] = (definition, value) => {
    const digits = decimalsOf(definition.step);
    // The pack's own display unit, such as "ct/l", wins over the generic one; a no-break space keeps the two together.
    const label = definition.unitLabel ? localize(definition.unitLabel, language) : "";
    if (label) return `${number(value, { digits })} ${label}`;
    switch (definition.unit) {
      case "percent":
        return percent(value / 100, { digits });
      case "percent_gdp":
        return messages.units.ofGdp(percent(value / 100, { digits }));
      case "currency":
        return money(value, { trim: true });
      case "years":
        return numberFormat(`years:${digits}`, {
          style: "unit",
          unit: "year",
          unitDisplay: "long",
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(value);
      case "count":
        return number(value, { digits });
    }
  };

  const wholeMoney: Formatters["exactMoney"] = (value, options = {}) =>
    typographicMinus(
      numberFormat(`exact:${options.signed}`, {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
        signDisplay: sign(options.signed),
      }).format(Math.round(value) === 0 ? 0 : value),
    );

  const smallMoney: Formatters["smallMoney"] = (value) =>
    Math.abs(value) >= 1 || value === 0
      ? wholeMoney(value)
      : typographicMinus(numberFormat("small", { style: "currency", currency, maximumSignificantDigits: 1 }).format(value));

  const currencySymbol =
    numberFormat("symbol", { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency;

  let currencyName = currency;
  try {
    currencyName = new Intl.DisplayNames([locale], { type: "currency" }).of(currency) ?? currency;
  } catch {
    // An engine without display names: the code will do.
  }
  // English writes currency names in lower case in running text ("each additional euro"), apart
  // from a qualifier in front ("US dollar").
  if (baseLanguage(language) === "en" && currencyName !== currency) currencyName = currencyName.replace(/(\S+)$/, (word) => word.toLowerCase());

  const separators = numberFormat("separators", { useGrouping: true, minimumFractionDigits: 1 }).formatToParts(12345.6);
  const groupMark = separators.find((part) => part.type === "group")?.value ?? ",";
  const decimalMark = separators.find((part) => part.type === "decimal")?.value ?? ".";
  const parse: Formatters["parse"] = (text) => {
    let s = text.replace(/[\s  ]/g, "").replace(/[−–]/g, "-");
    if (s === "" || s === "-") return NaN;
    const groups = s.split(groupMark).length - 1;
    const decimals = s.split(decimalMark).length - 1;
    // Only the group mark, but not followed by groups of three digits: it was meant as the decimal
    // point ("23.97" typed in German). The other way round likewise.
    if (decimals === 0 && groups === 1 && !/\d\D\d{3}$/.test(s)) s = s.replace(groupMark, decimalMark);
    else if (groups === 0 && decimals > 1) return NaN;
    s = s.split(groupMark).join("").replace(decimalMark, ".");
    return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
  };

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const date: Formatters["date"] = (iso) => {
    const time = Date.parse(`${iso}T00:00:00Z`);
    return Number.isNaN(time) ? iso : dateFormat.format(time);
  };

  const languageName: Formatters["languageName"] = (code) => {
    try {
      const name = new Intl.DisplayNames([intlLocale(code)], { type: "language" }).of(code);
      return name ? name.charAt(0).toLocaleUpperCase(intlLocale(code)) + name.slice(1) : code;
    } catch {
      return code;
    }
  };

  return {
    language,
    money,
    percent,
    share,
    number,
    count,
    param,
    exactMoney: wholeMoney,
    smallMoney,
    currencySymbol,
    currencyName,
    parse,
    date,
    languageName,
  };
}

/** The decimals a value needs to be written exactly, up to `max`: 42 -> 0, 18.6 -> 1, 23.97 -> 2. */
export function decimalsIn(value: number, max = 2): number {
  for (let digits = 0; digits < max; digits++) {
    const scaled = value * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, Math.abs(scaled))) return digits;
  }
  return max;
}
