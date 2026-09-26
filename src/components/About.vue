<script setup>
// Public repository URL: taken from the project's own configuration
// (README / CONTRIBUTING / MAINTAINERS / git remote).
const GITHUB_URL = 'https://github.com/santosh000/Save_Links'

defineProps({
  version: { type: String, default: '' },
})
</script>

<template>
  <section class="about-card">
    <div class="about-header">
      <span class="about-logo" aria-hidden="true">
        <img src="/logo.png" alt="" width="26" height="26" />
      </span>
      <div class="about-heading">
        <h4>About Save Links</h4>
        <p class="about-lead">A simple, local-first place to save, organize, and access your links.</p>
      </div>
    </div>

    <p class="about-intro">Your links are saved on your device first. You don't need an account to use Save Links. Optional sign-in enables cloud synchronization across devices.</p>

    <div class="about-principles">
      <section class="about-principle">
        <h5>Local-first</h5>
        <p>Your links stay on your device first. Use Save Links without an account.</p>
      </section>
      <section class="about-principle">
        <h5>Optional sync</h5>
        <p>Sign in with Google or GitHub when you want your links across devices.</p>
      </section>
      <section class="about-principle">
        <h5>Your data, your choice</h5>
        <p>Cloud sync is optional. Export your data when you want a backup.</p>
      </section>
    </div>

    <div class="about-open">
      <div class="about-open-text">
        <h5>The project</h5>
        <p>Explore the project, report an issue, or follow development on GitHub.</p>
      </div>
      <a
        class="about-github"
        :href="GITHUB_URL"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View Save Links on GitHub"
        title="GitHub"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
      </a>
    </div>

    <div class="about-meta">
      <p class="about-made">Made with <span class="about-heart">&hearts;</span>, built local-first.</p>
      <p class="about-version">Save Links &middot; v{{ version }}</p>
    </div>
  </section>
</template>

<style scoped>
.about-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.about-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.about-logo {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--muted-bg);
}
.about-logo img { display: block; }
.about-heading h4 {
  margin: 0 0 2px;
  font-size: var(--text-lg);
  color: var(--text-h);
}
.about-lead {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text);
  line-height: var(--leading-normal);
}

.about-intro {
  margin: 0;
  max-width: 68ch;
  font-size: var(--text-sm);
  color: var(--muted);
  line-height: var(--leading-normal);
}

.about-principles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}
.about-principle {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-3);
}
.about-principle h5,
.about-open h5 {
  margin: 0 0 4px;
  font-size: var(--text-md);
  color: var(--text-h);
}
.about-principle p,
.about-open p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--muted);
  line-height: var(--leading-normal);
}

.about-open {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-4);
}
.about-open-text { min-width: 0; }
.about-open p { max-width: 60ch; }
.about-github {
  width: var(--control-height);
  height: var(--control-height);
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card);
  color: var(--text-h);
  text-decoration: none;
  transition: background-color var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}
@media (hover: hover) and (pointer: fine) {
  .about-github:hover {
    background: var(--muted-bg);
    color: var(--accent);
    border-color: var(--accent-border);
  }
}
.about-github:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
.about-github svg { width: 18px; height: 18px; }

.about-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-4);
}
.about-made {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--muted);
}
.about-heart { color: var(--error); }
.about-version {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
