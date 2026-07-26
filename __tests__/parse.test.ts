import { describe, it, expect } from "vitest";
import { parseNumber, parseModelText, parseActualCsv, parseHoldingsHtml, firstNumberToken } from "@/lib/parse";
import { SEED_ALIASES, resolveSymbol } from "@/lib/symbols";

describe("parseNumber", () => {
  it("handles suffixes and commas", () => {
    expect(parseNumber("1.11M")).toBe(1_110_000);
    expect(parseNumber("919.88K")).toBeCloseTo(919_880);
    expect(parseNumber("11,250")).toBe(11250);
    expect(parseNumber("1,145.64")).toBeCloseTo(1145.64);
    expect(parseNumber("abc")).toBeNull();
  });
});

describe("resolveSymbol", () => {
  it("maps full company names to tickers", () => {
    expect(resolveSymbol("Highnoon Laboratories Limited", SEED_ALIASES)).toBe("HINOON");
    expect(resolveSymbol("Ghani ChemWorld Limited", SEED_ALIASES)).toBe("GCWL");
    expect(resolveSymbol("FABL", SEED_ALIASES)).toBe("FABL");
    expect(resolveSymbol("Cash", SEED_ALIASES)).toBe("CASH");
  });
  it("handles truncated names", () => {
    expect(resolveSymbol("Ghandhara Indus", SEED_ALIASES)).toBe("GHNI");
  });

  it("snaps OCR-garbled tickers to the nearest known symbol", () => {
    expect(resolveSymbol("FA8L", SEED_ALIASES)).toBe("FABL"); // 8 -> B
    expect(resolveSymbol("TGI", SEED_ALIASES)).toBe("TGL"); // I -> L
    expect(resolveSymbol("HIN00N", SEED_ALIASES)).toBe("HINOON"); // 0 -> O
    expect(resolveSymbol("A1RLINK", SEED_ALIASES)).toBe("AIRLINK"); // 1 -> I
  });

  it("snaps OCR-garbled company names", () => {
    expect(resolveSymbol("Highnoon Laboratones Limited", SEED_ALIASES)).toBe("HINOON");
    expect(resolveSymbol("Tariq Glasss Industries Ltd", SEED_ALIASES)).toBe("TGL");
  });

  it("does not snap a genuinely unknown ticker to a wrong match", () => {
    expect(resolveSymbol("OGDC", SEED_ALIASES)).toBe("OGDC");
  });
});

describe("parseModelText", () => {
  it("extracts weights from model OCR text", () => {
    const text = `Cash 10%\nHighnoon Laboratories Limited 7%\nFaysal Bank Limited 11%`;
    const rows = parseModelText(text, SEED_ALIASES);
    const map = Object.fromEntries(rows.map((r) => [r.symbol, r.targetPct]));
    expect(map.CASH).toBe(10);
    expect(map.HINOON).toBe(7);
    expect(map.FABL).toBe(11);
  });
});

describe("firstNumberToken", () => {
  it("honours suffixes even with a prefix word", () => {
    expect(firstNumberToken("amount 1.11M")).toBe(1_110_000);
    expect(firstNumberToken("11,250")).toBe(11250);
    expect(firstNumberToken("1,145.64")).toBeCloseTo(1145.64);
  });
});

describe("parseHoldingsHtml", () => {
  const html = `
    <table>
      <thead><tr>
        <th>symbol</th><th>Quantity</th><th>Avg. price</th><th>Curr. price</th>
        <th>Today P&amp;L</th><th>Unrealized Profit</th><th>Market Value</th><th>Portfolio %</th>
      </tr></thead>
      <tbody>
        <tr><td><a href="https://zar.sarmaaya.pk/portfolio/1/stock/661">FABL<svg></svg></a> Faysal Bank Limited</td>
            <td>11250</td><td>93.19</td><td>98.68</td><td>-3.37K</td><td>61.74K</td><td>1.11M</td><td>10.36%</td></tr>
        <tr><td>CASH</td><td>amount 1.11M</td><td></td><td></td><td></td><td></td><td></td><td>10.33%</td></tr>
        <tr><td><span>G</span> <a href="/portfolio/1/stock/999">GCWL</a> Ghani Chemworld Limited</td>
            <td>47500</td><td>17.87</td><td>15.68</td><td>-6.18K</td><td>-103.98K</td><td>744.80K</td><td>6.95%</td></tr>
      </tbody>
    </table>`;

  it("extracts holdings, prices and cash deterministically", () => {
    const rows = parseHoldingsHtml(html, SEED_ALIASES);
    const by = Object.fromEntries(rows.map((r) => [r.symbol, r]));
    expect(rows.length).toBe(3);
    expect(by.FABL.quantity).toBe(11250);
    expect(by.FABL.price).toBeCloseTo(98.68);
    expect(by.FABL.value).toBeUndefined(); // left to qty*price for exactness
    expect(by.CASH.value).toBe(1_110_000);
    // logo letter "G" must not become the ticker
    expect(by.GCWL.quantity).toBe(47500);
    expect(by.GCWL.price).toBeCloseTo(15.68);
  });
});

describe("parseActualCsv", () => {
  it("parses a headered CSV incl. CASH", () => {
    const csv = `symbol,quantity,current price,market value\nFABL,11250,98.68,1110000\nCASH,0,1,1110000`;
    const rows = parseActualCsv(csv, SEED_ALIASES);
    const fabl = rows.find((r) => r.symbol === "FABL")!;
    expect(fabl.quantity).toBe(11250);
    expect(fabl.price).toBeCloseTo(98.68);
    const cash = rows.find((r) => r.symbol === "CASH")!;
    expect(cash.value).toBe(1110000);
  });
});
