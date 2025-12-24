<script lang="ts">
  import { locale, locales, t, type Locale } from '$lib/i18n';

  function handleChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    locale.set(target.value as Locale);
  }
</script>

<div class="language-switcher">
  <label for="language-select">{$t('settings.general.language')}</label>
  <select id="language-select" value={$locale} onchange={handleChange}>
    {#each locales as loc}
      <option value={loc.code}>{loc.nativeName}</option>
    {/each}
  </select>
</div>

<style>
  .language-switcher {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  label {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.8);
  }

  select {
    padding: 8px 12px;
    font-size: 14px;
    font-family: inherit;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: white;
    cursor: pointer;
    outline: none;
    transition: all 0.2s ease;
  }

  select:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
  }

  select:focus {
    border-color: rgba(99, 102, 241, 0.5);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
  }

  option {
    background: #1a1a1a;
    color: white;
  }
</style>
