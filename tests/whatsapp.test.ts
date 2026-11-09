import { test } from "node:test";
import assert from "node:assert/strict";
import { isMobileDevice, whatsappLinks, whatsappNumber } from "../shared/whatsapp";

test("número de WhatsApp a partir del teléfono", () => {
  assert.equal(whatsappNumber("+34 620 450 696"), "34620450696");
  assert.equal(whatsappNumber("620450696"), "34620450696");
  assert.equal(whatsappNumber("0034 620-450-696"), "34620450696");
  assert.equal(whatsappNumber("123"), null);
  assert.deepEqual(whatsappLinks("+34 620 450 696"), {
    app: "whatsapp://send?phone=34620450696",
    web: "https://wa.me/34620450696",
  });
});

test("detección de móvil", () => {
  assert.equal(isMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148"), true);
  assert.equal(isMobileDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36"), true);
  assert.equal(isMobileDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0"), false);
});
