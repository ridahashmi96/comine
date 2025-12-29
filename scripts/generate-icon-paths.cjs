const fs = require('fs');
const path = require('path');

const iconsPath = path.join(__dirname, '../static/icons.svg');
const outputPath = path.join(__dirname, '../src/lib/components/iconPaths.ts');

const content = fs.readFileSync(iconsPath, 'utf8');

const symbolRegex = /<symbol id="icon-([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
const icons = {};
let match;
while ((match = symbolRegex.exec(content)) !== null) {
  const name = match[1];
  const innerContent = match[2].trim();
  icons[name] = innerContent;
}

let output = `// Auto-generated icon data - do not edit manually
// Generated from static/icons.svg

export const iconPaths: Record<string, string> = {\n`;

for (const [name, pathContent] of Object.entries(icons)) {
  // Escape backticks and backslashes for template literal safety
  const escaped = pathContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  output += `  "${name}": \`${escaped}\`,\n`;
}

output += `};\n`;

fs.writeFileSync(outputPath, output);
console.log(`Generated iconPaths.ts with ${Object.keys(icons).length} icons`);
