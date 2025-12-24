<script lang="ts">
  interface Props {
    checked?: boolean;
    disabled?: boolean;
    label?: string;
    onchange?: (checked: boolean) => void;
  }

  let { 
    checked = $bindable(false),
    disabled = false,
    label = '',
    onchange
  }: Props = $props();

  function toggle() {
    if (disabled) return;
    const newValue = !checked;
    // Update local state for bind:checked support
    checked = newValue;
    // Also call onchange callback if provided
    onchange?.(newValue);
  }
</script>

<button 
  type="button"
  class="toggle-wrapper" 
  class:disabled
  class:checked
  onclick={toggle}
  {disabled}
>
  {#if label}
    <span class="label">{label}</span>
  {/if}
  <span class="toggle">
    <span class="slider"></span>
  </span>
</button>

<style>
  .toggle-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    user-select: none;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
  }

  .toggle-wrapper.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .toggle {
    /* Add your Figma styles here */
    position: relative;
    width: 44px;
    height: 24px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    transition: all 0.2s;
  }

  .slider {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .toggle-wrapper.checked .toggle {
    background: var(--accent, #6366F1);
  }

  .toggle-wrapper.checked .slider {
    transform: translateX(20px);
  }

  .label {
    color: rgba(255, 255, 255, 0.9);
    font-size: 14px;
  }
</style>
