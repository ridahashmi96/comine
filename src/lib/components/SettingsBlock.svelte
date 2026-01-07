<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import Divider from './Divider.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n';

  interface Props {
    title: string;
    icon?: IconName;
    onResetSection?: () => void;
    children?: import('svelte').Snippet;
  }

  let { title, icon, onResetSection, children }: Props = $props();
</script>

<section class="settings-block">
  <div class="block-header">
    <div class="header-content">
      {#if icon}
        <Icon name={icon} size={18} class="header-icon" />
      {/if}
      <h2 class="block-title">{title}</h2>
    </div>
    
    {#if onResetSection}
      <button 
        class="section-reset-btn" 
        onclick={onResetSection}
        use:tooltip={$t('settings.resetSectionTooltip')}
      >
        <Icon name="undo" size={14} />
        <span class="reset-text">{$t('settings.resetSection')}</span>
      </button>
    {/if}
  </div>
  
  <Divider mt={8} mb={4} />
  
  <div class="block-content">
    {@render children?.()}
  </div>
</section>

<style>
  .settings-block {
    margin-bottom: 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .block-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 28px;
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  :global(.header-icon) {
    color: var(--accent-color, #6366F1);
    opacity: 0.9;
    width: 24px;
    display: flex;
    justify-content: center;
  }

  .block-title {
    font-size: 13px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .section-reset-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 4px;
    background: transparent;
    border: 1px solid transparent;
    color: rgba(255, 255, 255, 0.4);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .section-reset-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.8);
  }

  .block-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  @media (max-width: 640px) {
    .reset-text {
      display: none;
    }
  }
</style>
