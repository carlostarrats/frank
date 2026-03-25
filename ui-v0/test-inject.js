// Test script — run via: agent-browser eval "$(cat ui/test-inject.js)"
// Or load in browser console

if (window._frankAddTab) {
  window._frankAddTab({
    schema: "v1",
    type: "screen",
    label: "Dashboard",
    timestamp: "2026-03-23T20:00:00Z",
    platform: "web",
    sections: [
      {
        type: "header",
        contains: [
          "Acme logo wordmark",
          "Dashboard nav link",
          "Reports nav link",
          "Search input",
          "User avatar"
        ]
      },
      {
        type: "stats-row",
        contains: [
          "Revenue stat card — $84,320 value — +12.4% badge",
          "Orders stat card — 1,284 value — +8.1% badge"
        ]
      },
      {
        type: "list",
        label: "Recent Orders",
        contains: [
          "Order # column header",
          "Customer column header",
          "Status column header",
          "#ORD-001 — Sarah Johnson — Fulfilled badge",
          "#ORD-002 — Mike Chen — Pending badge"
        ]
      }
    ]
  });
  document.title = "INJECTED";
}
