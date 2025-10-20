/**
 * Manual Tailwind snapshot generator.
 *
 * This script expands Tailwind v4 directives from `src/styles.source.css` (which itself
 * imports `tailwind.preflight.css`) into a fully generated CSS artifact
 * written to `src/styles.tailwind.css`.
 *
 * Normal builds DO NOT rely on this file anymore (Angular + PostCSS process
 * the directives directly). The snapshot is useful when you want to:
 *   - Inspect the final expanded utility output for debugging.
 *   - Compare diffs between Tailwind upgrades.
 *   - Share a one-off artifact via the dedicated GitHub Action.
 *
 * The output file is .gitignored to avoid churn. Run with:
 *   yarn tailwind:generate
 */
import { readFile, writeFile } from 'fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const cwd = process.cwd();
const inputPath = path.resolve(cwd, 'src/styles.source.css');
const outputPath = path.resolve(cwd, 'src/styles.tailwind.css');

try {
  const css = await readFile(inputPath, 'utf8');
  const result = await postcss([tailwind()]).process(css, {
    from: inputPath,
    to: outputPath,
  });
  await writeFile(outputPath, result.css, 'utf8');
  console.log(`Tailwind CSS built to ${outputPath}`);
} catch (err) {
  console.error('Tailwind prebuild failed:', err);
  process.exitCode = 1;
}
