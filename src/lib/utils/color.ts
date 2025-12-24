/**
 * Color extraction utility for thumbnail-based theming
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

// Cache for extracted colors to avoid re-processing
const colorCache = new Map<string, RGB>();

/**
 * Extract the dominant color from an image URL
 * Uses canvas to sample pixels and find the most vibrant/saturated color
 */
export async function extractDominantColor(imageUrl: string): Promise<RGB | null> {
  // Check cache first
  if (colorCache.has(imageUrl)) {
    return colorCache.get(imageUrl)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    const timeout = setTimeout(() => {
      resolve(null);
    }, 5000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        // Sample at a small size for performance
        const sampleSize = 50;
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        
        const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const pixels = imageData.data;
        
        // Find the most vibrant color (high saturation, medium-high lightness)
        let bestColor: RGB = { r: 99, g: 102, b: 241 }; // Default accent
        let bestScore = 0;
        
        // Sample every 4th pixel for performance
        for (let i = 0; i < pixels.length; i += 16) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];
          
          // Skip transparent pixels
          if (a < 128) continue;
          
          // Calculate HSL-like metrics
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const lightness = (max + min) / 2 / 255;
          const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1)) / 255;
          
          // Score based on saturation and avoiding very dark/light colors
          // Prefer saturated colors with lightness between 0.25 and 0.75
          const lightnessScore = 1 - Math.abs(lightness - 0.5) * 2;
          const score = saturation * lightnessScore * (1 - Math.abs(lightness - 0.4));
          
          if (score > bestScore && saturation > 0.2) {
            bestScore = score;
            bestColor = { r, g, b };
          }
        }
        
        // If no good color found, try to find a non-gray color
        if (bestScore < 0.1) {
          for (let i = 0; i < pixels.length; i += 16) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];
            
            if (a < 128) continue;
            
            // Check if it's not too gray
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            if (max - min > 30) {
              bestColor = { r, g, b };
              break;
            }
          }
        }
        
        // Boost saturation slightly for better visual impact
        const boosted = boostSaturation(bestColor, 1.2);
        
        colorCache.set(imageUrl, boosted);
        resolve(boosted);
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };

    img.src = imageUrl;
  });
}

/**
 * Boost the saturation of a color
 */
function boostSaturation(color: RGB, factor: number): RGB {
  // Convert to HSL
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  
  // Boost saturation
  s = Math.min(1, s * factor);
  
  // Convert back to RGB
  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }
  
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  
  return {
    r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1/3) * 255)
  };
}

/**
 * Convert RGB to CSS rgba string with alpha
 */
export function rgbToRgba(color: RGB, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/**
 * Generate CSS variables for an item's color theming
 */
export function generateColorVars(color: RGB): string {
  return `--item-color: ${rgbToRgba(color, 1)}; --item-color-alpha: ${rgbToRgba(color, 0.25)}; --item-color-alpha-light: ${rgbToRgba(color, 0.15)}; --item-color-alpha-lighter: ${rgbToRgba(color, 0.08)}; --item-color-hover: ${rgbToRgba(color, 0.12)};`;
}

/**
 * Clear the color cache (useful when thumbnails change)
 */
export function clearColorCache(): void {
  colorCache.clear();
}

/**
 * Remove a specific URL from the cache
 */
export function removeFromColorCache(url: string): void {
  colorCache.delete(url);
}
