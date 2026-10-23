import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import LocationFilter from "../src/components/LocationFilter.jsx";
import { SUPPORTED_CITIES } from "../src/services/subscriptions.js";

// The exact option contract: "All" first, then the five supported cities.
const OPTIONS = ["All", ...SUPPORTED_CITIES];

function renderFilterHtml(value) {
  return renderToString(
    React.createElement(LocationFilter, { value, onChange: () => {} })
  );
}

describe("LocationFilter rendering contract", () => {
  it("renders exactly All + the five supported cities as buttons, in order", () => {
    const html = renderFilterHtml("All");
    const buttons = html.split("<button").slice(1);

    expect(buttons).toHaveLength(OPTIONS.length);

    buttons.forEach((chunk, index) => {
      expect(chunk).toContain(`>${OPTIONS[index]}</span>`);
    });
  });

  it("marks 'All' as the only active option by default", () => {
    const html = renderFilterHtml("All");
    const buttons = html.split("<button").slice(1);

    expect(buttons[0]).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("marks only the selected city as active", () => {
    const html = renderFilterHtml("Delhi");
    const buttons = html.split("<button").slice(1);
    const delhiIndex = OPTIONS.indexOf("Delhi");

    expect(buttons[delhiIndex]).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(buttons[0]).toContain('aria-pressed="false"');
  });
});
