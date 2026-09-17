<template>
  <section class="about-card">
    <h4>About Save Links</h4>
    <p>Save Links is a local-first bookmark manager for saving, organizing, and accessing links offline, with optional cloud synchronization across browsers.</p>
    <p class="about-sub">Local use requires no account. Google or GitHub sign-in enables optional cloud synchronization.</p>
    <p class="about-sub">Email login is planned for a future release.</p>
    <ul>
      <li>Your links are saved on your device first.</li>
      <li>You don't need an account to use Save Links.</li>
      <li>Google or GitHub sign-in enables optional cloud synchronization.</li>
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
  background: transparent;
  padding: 0;
}
.about-card h4 {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  color: var(--text-h);
}
.about-card p {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text);
}
.about-card p.about-sub {
  margin-top: 8px;
}
.about-card ul {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text);
}
.about-card li + li {
  margin-top: 4px;
}
.about-card code {
  font-size: var(--text-xs);
  background: var(--muted-bg);
  padding: 2px 6px;
  border-radius: 6px;
}
</style>