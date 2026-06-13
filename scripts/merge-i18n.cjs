// scripts/merge-i18n.cjs
// Merge i18n JSON files: fork keys take priority, upstream adds missing keys
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dir = 'public/i18n/literals';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let merged = 0, skipped = 0;

for (const file of files) {
  const forkPath = path.join(dir, file);
  try {
    const forkContent = JSON.parse(fs.readFileSync(forkPath, 'utf8'));
    let upstreamContent;
    try {
      const raw = execSync(`git show upstream/master:${dir}/${file}`, { encoding: 'utf8' });
      upstreamContent = JSON.parse(raw);
    } catch {
      // File doesn't exist in upstream - keep fork's version
      console.log(`  skip (no upstream): ${file}`);
      skipped++;
      continue;
    }
    // Fork wins on conflicts; upstream adds missing keys
    const result = { ...upstreamContent, ...forkContent };
    const newKeys = Object.keys(upstreamContent).filter(k => !(k in forkContent));
    fs.writeFileSync(forkPath, JSON.stringify(result, null, 2) + '\n');
    if (newKeys.length > 0) {
      console.log(`  ✓ ${file} (+${newKeys.length} new keys: ${newKeys.slice(0, 3).join(', ')}${newKeys.length > 3 ? '...' : ''})`);
    } else {
      console.log(`  ✓ ${file} (no new keys)`);
    }
    merged++;
  } catch (e) {
    console.error(`  ✗ ERROR ${file}: ${e.message}`);
  }
}
console.log(`\nDone: ${merged} merged, ${skipped} skipped`);
