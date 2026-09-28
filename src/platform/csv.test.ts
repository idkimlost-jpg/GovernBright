import { describe, expect, it } from "vitest";
import { findColumns, parseCsv } from "./csv.js";

describe("CSV parsing", () => {
  it("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","multi\nline"\r\n\r\n1,2,3\n')).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "multi\nline"], ["1", "2", "3"]]);
  });

  it("finds columns by loose header aliases", () => {
    expect(findColumns(["Event Time", "User Email", "App Name"], { app: ["app name"], email: ["email"], date: ["time"], amount: ["amount"] }))
      .toEqual({ app: 2, email: 1, date: 0, amount: -1 });
  });
});
