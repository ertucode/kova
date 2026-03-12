#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const assetsDir = join(projectRoot, 'assets');
const sourcePng = join(assetsDir, 'kova.png');
const iconsetDir = join(assetsDir, 'kova.iconset');
const icnsFile = join(assetsDir, 'kova.icns');

// Icon sizes required for macOS iconset
const sizes = [
  { size: 16, scales: [1, 2] },
  { size: 32, scales: [1, 2] },
  { size: 128, scales: [1, 2] },
  { size: 256, scales: [1, 2] },
  { size: 512, scales: [1, 2] },
];

function main() {
  console.log('Building macOS icon from kova.png...');

  // Check if source PNG exists
  if (!existsSync(sourcePng)) {
    console.error(`Error: Source file not found at ${sourcePng}`);
    process.exit(1);
  }

  // Clean up existing iconset directory if it exists
  if (existsSync(iconsetDir)) {
    console.log('Cleaning up existing iconset directory...');
    rmSync(iconsetDir, { recursive: true });
  }

  // Create iconset directory
  console.log('Creating iconset directory...');
  mkdirSync(iconsetDir, { recursive: true });

  // Generate all required sizes
  console.log('Generating icon sizes...');
  for (const { size, scales } of sizes) {
    for (const scale of scales) {
      const actualSize = size * scale;
      const suffix = scale === 2 ? '@2x' : '';
      const filename = `icon_${size}x${size}${suffix}.png`;
      const outputPath = join(iconsetDir, filename);

      console.log(`  Creating ${filename} (${actualSize}x${actualSize})...`);
      
      try {
        execSync(
          `sips -z ${actualSize} ${actualSize} "${sourcePng}" --out "${outputPath}"`,
          { stdio: 'pipe' }
        );
      } catch (error) {
        console.error(`Error creating ${filename}:`, error.message);
        process.exit(1);
      }
    }
  }

  // Convert iconset to icns
  console.log('Converting iconset to .icns file...');
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsFile}"`, {
      stdio: 'pipe',
    });
    console.log(`Successfully created ${icnsFile}`);
  } catch (error) {
    console.error('Error creating .icns file:', error.message);
    process.exit(1);
  }

  console.log('\nIcon generation complete!');
  console.log(`  - Iconset: ${iconsetDir}`);
  console.log(`  - ICNS file: ${icnsFile}`);
}

main();
