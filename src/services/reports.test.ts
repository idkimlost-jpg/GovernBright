import { describe, expect, it } from "vitest";
import { csvCell } from "./reports.js";

describe("CSV export", () => {
  it("quotes cells, doubles quotes and neutralizes spreadsheet formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("-2+3")).toBe("\"'-2+3\"");
    expect(csvCell(null)).toBe('""');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
