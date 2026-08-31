<template>
  <section class="about-card">
    <h4>About Save Links</h4>
    <p>
      Save Links is a <strong>local-first</strong> bookmark manager. No backend,
      no authentication — all data stays in your browser.
    </p>
    <ul>
      <li>Links, folders, stats, and profile are stored locally on this device.</li>
      <li>Cards, filters, and categories update instantly and locally.</li>
      <li>Nothing leaves this device.</li>
    </ul>
  </section>
</template>

<style scoped>
.about-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
}
.about-card h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-h);
}
.about-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}
.about-card ul {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}
.about-card li + li {
  margin-top: 4px;
}
.about-card code {
  font-size: 12px;
  background: var(--muted-bg);
  padding: 2px 6px;
  border-radius: 6px;
}
</style>
