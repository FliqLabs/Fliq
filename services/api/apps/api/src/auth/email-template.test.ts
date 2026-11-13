import { describe, expect, it } from "vitest";
import { renderSignInEmail } from "./email-template.js";

describe("renderSignInEmail", () => {
  const link = "https://fliq.cash/auth/verify?token=el_abc&x=<1>";
  const { html, text } = renderSignInEmail(link, 15);

  it("puts the link on the button and in the plain-text part", () => {
    expect(html).toContain('href="https://fliq.cash/auth/verify?token=el_abc&amp;x=&lt;1&gt;"');
    expect(text).toContain(link);
  });

  it("states how long the link lasts", () => {
    expect(html).toContain("expires in 15 minutes");
    expect(text).toContain("expires in 15 minutes");
  });
});
