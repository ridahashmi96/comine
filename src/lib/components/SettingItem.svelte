<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { fade } from 'svelte/transition';

  interface Props {
    title: string;
    description?: string;
    icon?: IconName;
    value?: any;
    defaultValue?: any;
    onReset?: () => void;
    class?: string;
    children?: import('svelte').Snippet;
    descriptionSnippet?: import('svelte').Snippet;
  }

  let {
    title,
    description,
    icon,
    value,
    defaultValue,
    onReset,
    class: className = '',
    children,
    descriptionSnippet,
  }: Props = $props();

  let showReset = $derived(
    value !== undefined && defaultValue !== undefined && value !== defaultValue
  );
</script>

<div class="setting-item {className}">
  <div class="content-side">
    {#if icon}
      <div class="icon-wrapper">
        <Icon name={icon} size={18} />
      </div>
    {/if}
    <div class="text-content">
      <div class="title">{title}</div>
      {#if description}
        <div class="description">{description}</div>
      {/if}
      {@render descriptionSnippet?.()}
    </div>
  </div>

  <div class="control-side">
    {#if showReset && onReset}
      <button
        class="reset-btn"
        onclick={onReset}
        transition:fade={{ duration: 150 }}
        use:tooltip={'Reset to default'}
        aria-label="Reset setting"
      >
        <Icon name="undo" size={14} />
      </button>
    {/if}
    <div class="control-wrapper">
      {@render children?.()}
    </div>
  </div>
</div>

<style>
  .setting-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    gap: 12px;
    background: transparent;
    border-radius: 6px;
    min-height: 42px;
  }

  .setting-item:last-child {
    border-bottom: none;
  }

  .content-side {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.5);
    flex-shrink: 0;
    width: 24px;
  }

  .text-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    line-height: 1.3;
  }

  .description {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.3;
  }

  .control-side {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    min-height: 24px;
  }

  .control-wrapper {
    display: flex;
    align-items: center;
  }

  .reset-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: transparent;
    border: 1px solid transparent;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    transition: all 0.2s;
  }

  .reset-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }

  @media (max-width: 640px) {
    .setting-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    .content-side {
      width: 100%;
    }

    .control-side {
      width: 100%;
      justify-content: flex-end;
      padding-top: 0;
      min-height: 24px;
    }

    .control-wrapper {
      margin-left: 0;
    }

    .reset-btn {
      margin: 0;
    }
  }
</style>
