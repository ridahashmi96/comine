/**
 * i18n Translation Keys Reference
 * 
 * This file provides autocomplete hints for translation keys.
 * Import the `t` function from '$lib/i18n' to use translations.
 * 
 * Usage:
 * ```svelte
 * <script>
 *   import { t } from '$lib/i18n';
 * </script>
 * 
 * <h1>{$t('app.name')}</h1>
 * <p>{$t('queue.items', { count: 5 })}</p>
 * ```
 * 
 * All translation keys:
 */

export type TranslationKeys = 
  // App
  | 'app.name'
  | 'app.description'
  
  // Navigation
  | 'nav.download'
  | 'nav.history'
  | 'nav.queue'
  | 'nav.settings'
  | 'nav.info'
  | 'nav.logs'
  
  // Download page
  | 'download.title'
  | 'download.placeholder'
  | 'download.button'
  | 'download.downloading'
  | 'download.success'
  | 'download.error'
  | 'download.pasteFromClipboard'
  
  // History page
  | 'history.title'
  | 'history.empty'
  | 'history.clearAll'
  | 'history.delete'
  | 'history.openFolder'
  | 'history.redownload'
  
  // Queue page
  | 'queue.title'
  | 'queue.empty'
  | 'queue.clearAll'
  | 'queue.pause'
  | 'queue.resume'
  | 'queue.cancel'
  | 'queue.items'
  
  // Settings page
  | 'settings.title'
  | 'settings.general.title'
  | 'settings.general.language'
  | 'settings.general.startOnBoot'
  | 'settings.general.watchClipboard'
  | 'settings.general.showNotifications'
  | 'settings.general.downloadPath'
  | 'settings.general.browse'
  | 'settings.processing.title'
  | 'settings.processing.description'
  | 'settings.appearance.title'
  | 'settings.appearance.theme'
  | 'settings.appearance.themes.system'
  | 'settings.appearance.themes.dark'
  | 'settings.appearance.themes.light'
  | 'settings.extensions.title'
  | 'settings.extensions.warning'
  | 'settings.extensions.installed'
  | 'settings.extensions.browse'
  | 'settings.about.title'
  | 'settings.about.version'
  | 'settings.about.checkUpdates'
  | 'settings.about.changelog'
  | 'settings.about.licenses'
  
  // Info page
  | 'info.title'
  | 'info.supportedSites'
  | 'info.searchPlaceholder'
  
  // Logs page
  | 'logs.title'
  | 'logs.clear'
  | 'logs.copy'
  | 'logs.empty'
  | 'logs.levels.all'
  | 'logs.levels.info'
  | 'logs.levels.warning'
  | 'logs.levels.error'
  
  // Common
  | 'common.save'
  | 'common.cancel'
  | 'common.delete'
  | 'common.confirm'
  | 'common.close'
  | 'common.loading'
  | 'common.error'
  | 'common.success'
  | 'common.warning'
  | 'common.info'
  | 'common.yes'
  | 'common.no'
  | 'common.ok'
  | 'common.retry'
  | 'common.copy'
  | 'common.copied'
  | 'common.search'
  | 'common.noResults'
  
  // Window controls
  | 'window.minimize'
  | 'window.maximize'
  | 'window.close'
  
  // Clipboard
  | 'clipboard.detected'
  | 'clipboard.noValidUrl'
  | 'clipboard.error'
  
  // Tray
  | 'tray.show'
  | 'tray.downloadClipboard'
  | 'tray.quit'
  | 'tray.hiddenToTray'
  
  // Notifications
  | 'notification.mediaDetected'
  | 'notification.clickToDownload'
  | 'notification.loadingFromNotification';
