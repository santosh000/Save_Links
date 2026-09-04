<template>
  <section class="about-card">
    <h4>About Save Links</h4>
    <p>Save Links is a local-first bookmark manager for saving, organizing, and accessing links offline, with optional cloud synchronization across browsers.</p>
    <p class="about-sub">Local use requires no account. GitHub sign-in currently enables cloud synchronization.</p>
    <p class="about-sub">Google and email login are planned for a future release.</p>
    <ul>
      <li>Your links are saved on your device first.</li>
      <li>You don't need an account to use Save Links.</li>
      <li>GitHub sign-in enables optional cloud synchronization.</li>
      <li>Your local profile and account are separate.</li>
      <li>Your data stays on your device unless you choose to sync it.</li>
      <li>Cloud sync is not a backup — use export for backups.</li>
    </ul>
  </section>
</template>

<script setup>
</script>

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