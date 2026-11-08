/**
 * @fileoverview The copy line under a sent post: where it was copied, a copy that finally failed, and a copy sent with
 * no answer back, which may have landed and is never resent on its own.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deliveries as demoDeliveries } from "@/lib/demo-data";
import { DeliveryView } from "./delivery-view";

const first = demoDeliveries.find((d) => d.tone === "success")!;

describe("copy line", () => {
  it("says where a copy landed, which failed and which may have been sent", () => {
    const html = renderToStaticMarkup(
      <DeliveryView deliveries={[first]} copies={{ [first.id]: [{ kind: "telegram", state: "sent" }, { kind: "discord", state: "uncertain" }] }} />,
    );
    expect(html).toContain("Also on Telegram");
    expect(html).toContain("No answer from Discord, so the copy may have been sent. Check the channel");
    expect(html).not.toContain("failed");
  });
});
