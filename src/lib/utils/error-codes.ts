export enum ErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  PROXY_ERROR = 'PROXY_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  INVALID_COOKIES = 'INVALID_COOKIES',
  
  VIDEO_UNAVAILABLE = 'VIDEO_UNAVAILABLE',
  VIDEO_PRIVATE = 'VIDEO_PRIVATE',
  VIDEO_GEOBLOCKED = 'VIDEO_GEOBLOCKED',
  FORMAT_NOT_AVAILABLE = 'FORMAT_NOT_AVAILABLE',
  UNSUPPORTED_SITE = 'UNSUPPORTED_SITE',
  
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  DISK_FULL = 'DISK_FULL',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  
  DEPENDENCY_NOT_INSTALLED = 'DEPENDENCY_NOT_INSTALLED',
  DEPENDENCY_OUTDATED = 'DEPENDENCY_OUTDATED',
  
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INVALID_URL = 'INVALID_URL',
  PARSE_ERROR = 'PARSE_ERROR',
}

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  userMessage: string;
  suggestion?: string;
  retryable: boolean;
}

export const ERROR_MESSAGES: Record<ErrorCode, Omit<ErrorInfo, 'code'>> = {
  [ErrorCode.NETWORK_ERROR]: {
    message: 'Network request failed',
    userMessage: 'Network error. Check your internet connection.',
    suggestion: 'Try again in a few moments or check your connection settings.',
    retryable: true,
  },
  [ErrorCode.PROXY_ERROR]: {
    message: 'Proxy connection failed',
    userMessage: 'Proxy connection failed.',
    suggestion: 'Try disabling proxy or using a different proxy server in Settings.',
    retryable: true,
  },
  [ErrorCode.TIMEOUT_ERROR]: {
    message: 'Request timed out',
    userMessage: 'Request timed out.',
    suggestion: 'The server is taking too long to respond. Try again later.',
    retryable: true,
  },
  [ErrorCode.CONNECTION_REFUSED]: {
    message: 'Connection refused',
    userMessage: 'Could not connect to the server.',
    suggestion: 'Check if the website is accessible and your firewall settings.',
    retryable: true,
  },
  [ErrorCode.AUTH_REQUIRED]: {
    message: 'Authentication required',
    userMessage: 'Authentication required.',
    suggestion: 'This video requires login. Add cookies from your browser in Settings.',
    retryable: false,
  },
  [ErrorCode.INVALID_COOKIES]: {
    message: 'Invalid or expired cookies',
    userMessage: 'Cookies are invalid or expired.',
    suggestion: 'Update your cookies in Settings with fresh ones from your browser.',
    retryable: false,
  },
  [ErrorCode.VIDEO_UNAVAILABLE]: {
    message: 'Video unavailable',
    userMessage: 'Video is unavailable.',
    suggestion: 'The video may have been deleted or made private.',
    retryable: false,
  },
  [ErrorCode.VIDEO_PRIVATE]: {
    message: 'Video is private',
    userMessage: 'Video is private.',
    suggestion: 'You need permission to access this video.',
    retryable: false,
  },
  [ErrorCode.VIDEO_GEOBLOCKED]: {
    message: 'Video is geographically restricted',
    userMessage: 'Video not available in your region.',
    suggestion: 'Try using a proxy server from an allowed region.',
    retryable: false,
  },
  [ErrorCode.FORMAT_NOT_AVAILABLE]: {
    message: 'Requested format not available',
    userMessage: 'Requested quality not available.',
    suggestion: 'Try a different quality setting or use "Auto" quality.',
    retryable: false,
  },
  [ErrorCode.UNSUPPORTED_SITE]: {
    message: 'Site not supported',
    userMessage: 'This website is not supported.',
    suggestion: 'Try switching to a different processor in Settings (Auto/yt-dlp/Lux).',
    retryable: false,
  },
  [ErrorCode.DOWNLOAD_FAILED]: {
    message: 'Download failed',
    userMessage: 'Download failed.',
    suggestion: 'Check the logs for more details.',
    retryable: true,
  },
  [ErrorCode.DISK_FULL]: {
    message: 'Disk full',
    userMessage: 'Not enough disk space.',
    suggestion: 'Free up some space on your drive and try again.',
    retryable: false,
  },
  [ErrorCode.PERMISSION_DENIED]: {
    message: 'Permission denied',
    userMessage: 'Permission denied.',
    suggestion: 'Check folder permissions for your download directory.',
    retryable: false,
  },
  [ErrorCode.FILE_NOT_FOUND]: {
    message: 'File not found',
    userMessage: 'File not found.',
    suggestion: 'The file may have been moved or deleted.',
    retryable: false,
  },
  [ErrorCode.DEPENDENCY_NOT_INSTALLED]: {
    message: 'Required dependency not installed',
    userMessage: 'Required tool not installed.',
    suggestion: 'Install the required dependencies in Settings > Dependencies.',
    retryable: false,
  },
  [ErrorCode.DEPENDENCY_OUTDATED]: {
    message: 'Dependency version outdated',
    userMessage: 'Download tool needs updating.',
    suggestion: 'Update the tool in Settings > Dependencies.',
    retryable: false,
  },
  [ErrorCode.UNKNOWN_ERROR]: {
    message: 'Unknown error',
    userMessage: 'An unexpected error occurred.',
    suggestion: 'Check the logs for more information.',
    retryable: true,
  },
  [ErrorCode.INVALID_URL]: {
    message: 'Invalid URL',
    userMessage: 'Invalid URL.',
    suggestion: 'Make sure you entered a valid video URL.',
    retryable: false,
  },
  [ErrorCode.PARSE_ERROR]: {
    message: 'Failed to parse data',
    userMessage: 'Failed to process the response.',
    suggestion: 'This might be a temporary issue. Try again later.',
    retryable: true,
  },
};

export function detectErrorCode(errorMessage: string): ErrorCode {
  const msg = errorMessage.toLowerCase();
  
  if (msg.includes('proxy') || msg.includes('412')) return ErrorCode.PROXY_ERROR;
  if (msg.includes('timeout') || msg.includes('timed out')) return ErrorCode.TIMEOUT_ERROR;
  if (msg.includes('connection refused')) return ErrorCode.CONNECTION_REFUSED;
  if (msg.includes('network') || msg.includes('request error') || msg.includes('http error')) {
    return ErrorCode.NETWORK_ERROR;
  }
  
  if (msg.includes('cookies') || msg.includes('cookie')) return ErrorCode.INVALID_COOKIES;
  if (msg.includes('login') || msg.includes('sign in') || msg.includes('authenticate')) {
    return ErrorCode.AUTH_REQUIRED;
  }
  
  if (msg.includes('private')) return ErrorCode.VIDEO_PRIVATE;
  if (msg.includes('unavailable') || msg.includes('not available')) return ErrorCode.VIDEO_UNAVAILABLE;
  if (msg.includes('geo') || msg.includes('region') || msg.includes('blocked')) {
    return ErrorCode.VIDEO_GEOBLOCKED;
  }
  if (msg.includes('format') || msg.includes('quality')) return ErrorCode.FORMAT_NOT_AVAILABLE;
  if (msg.includes('unsupported') || msg.includes('not supported')) return ErrorCode.UNSUPPORTED_SITE;
  
  if (msg.includes('disk full') || msg.includes('no space')) return ErrorCode.DISK_FULL;
  if (msg.includes('permission denied') || msg.includes('access denied')) {
    return ErrorCode.PERMISSION_DENIED;
  }
  if (msg.includes('file not found') || msg.includes('no such file')) return ErrorCode.FILE_NOT_FOUND;
  
  if (msg.includes('not installed') || msg.includes('command not found')) {
    return ErrorCode.DEPENDENCY_NOT_INSTALLED;
  }
  
  if (msg.includes('invalid url') || msg.includes('malformed url')) return ErrorCode.INVALID_URL;
  
  if (msg.includes('parse') || msg.includes('json')) return ErrorCode.PARSE_ERROR;
  
  return ErrorCode.UNKNOWN_ERROR;
}

export function getErrorInfo(code: ErrorCode): ErrorInfo {
  return { code, ...ERROR_MESSAGES[code] };
}

export function getErrorInfoFromMessage(errorMessage: string): ErrorInfo {
  const code = detectErrorCode(errorMessage);
  return getErrorInfo(code);
}
