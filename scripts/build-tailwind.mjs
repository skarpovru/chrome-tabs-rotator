import { readFile, writeFile } from 'fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const cwd = process.cwd();
const inputPath = path.resolve(cwd, 'src/styles.css');
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
