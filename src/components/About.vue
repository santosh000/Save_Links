<template>
  <section class="about-card">
    <h4>About Save Links</h4>
    <p>Save Links is a simple bookmark manager that keeps your links on your device.</p>
    <p class="about-sub">Save and organize your links even when you're offline.</p>
    <p class="about-sub">Want to use your links on another device? Create an account and sign in to sync them.</p>
    <ul>
      <li>Your links are saved on your device first.</li>
      <li>You don't need an account to use Save Links.</li>
      <li>Sync is optional — use it only when you need it.</li>
      <li>Your local profile and account are separate.</li>
      <li>Your data stays on your device unless you choose to sync it.</li>
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
.about-card p.about-sub {
  margin-top: 8px;
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
