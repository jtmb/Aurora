#!/usr/bin/env node
/**
 * FortuneSheet Dark Mode Patch
 * Patches @fortune-sheet/core/dist/index.esm.js with dark theme colors.
 * Run as postinstall or manually: node scripts/fortune-dark-patch.js
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'node_modules', '@fortune-sheet', 'core', 'dist', 'index.esm.js');

if (!fs.existsSync(TARGET)) {
  console.log('[fortune-dark-patch] Target not found:', TARGET);
  process.exit(0);
}

let src = fs.readFileSync(TARGET, 'utf-8');
let changes = 0;

// ─── 1. Patch defaultStyle object (root of most colors) ───
{
  const oldDefault = `var defaultStyle = {
  fillStyle: "#000000",
  textBaseline: "middle",
  strokeStyle: "#dfdfdf",
  rowFillStyle: "#5e5e5e",
  textAlign: "center"
};`;
  const newDefault = `var defaultStyle = {
  fillStyle: "#fafafa",
  textBaseline: "middle",
  strokeStyle: "#a1a1aa",
  rowFillStyle: "#27272a",
  textAlign: "center"
};`;
  if (src.includes(oldDefault)) {
    src = src.replace(oldDefault, newDefault);
    changes++;
    console.log('[fortune-dark-patch] ✓ Patched defaultStyle object');
  } else {
    console.log('[fortune-dark-patch] ⚠ defaultStyle not found (may be already patched)');
  }
}

// ─── 2. Patch row header cell rendering ───
{
  // Row header: fillStyle = "#ffffff" followed by fillRect with rowHeaderWidth
  const rowHeaderBgPattern = /(renderCtx\.fillStyle\s*=\s*)"#ffffff"(\s*;\s*\n\s*renderCtx\.fillRect\(0,\s*start_r\s*\+)/g;
  const count1 = (src.match(rowHeaderBgPattern) || []).length;
  src = src.replace(rowHeaderBgPattern, '$1"#18181b"$2');
  
  // Row header text: fillStyle = "#000000" followed by fillText in row header
  const rowHeaderTextPattern = /(renderCtx\.fillStyle\s*=\s*)"#000000"(\s*;\s*\n\s*renderCtx\.save\(\).{0,200}?rowHeaderWidth)/gs;
  const count2 = (src.match(rowHeaderTextPattern) || []).length;
  src = src.replace(rowHeaderTextPattern, '$1"#fafafa"$2');
  
  if (count1 || count2) {
    changes += count1 + count2;
    console.log(`[fortune-dark-patch] ✓ Patched row header: ${count1} bg + ${count2} text`);
  }
}

// ─── 3. Patch column header cell rendering ───
{
  // Column header bg: fillStyle = "#ffffff" with fillRect for column header
  const colHeaderBgPattern = /(renderCtx\.fillStyle\s*=\s*)"#ffffff"(\s*;\s*\n\s*renderCtx\.fillRect\(start_c\s*\+)/g;
  const count1 = (src.match(colHeaderBgPattern) || []).length;
  src = src.replace(colHeaderBgPattern, '$1"#18181b"$2');
  
  // Column header text: fillStyle = "#000000" followed by fillText for column letter
  const colHeaderTextPattern = /(renderCtx\.fillStyle\s*=\s*)"#000000"(\s*;\s*\n\s*renderCtx\.save\(\).{0,200}?columnHeaderHeight)/gs;
  const count2 = (src.match(colHeaderTextPattern) || []).length;
  src = src.replace(colHeaderTextPattern, '$1"#fafafa"$2');
  
  if (count1 || count2) {
    changes += count1 + count2;
    console.log(`[fortune-dark-patch] ✓ Patched column header: ${count1} bg + ${count2} text`);
  }
}

// ─── 4. Patch main cell area background ───
{
  const mainBgPattern = /(renderCtx\.fillStyle\s*=\s*)"#ffffff"(\s*;\s*\n\s*renderCtx\.fillRect\(offsetLeft\s*-\s*1,\s*offsetTop\s*-\s*1)/g;
  const count = (src.match(mainBgPattern) || []).length;
  src = src.replace(mainBgPattern, '$1"#18181b"$2');
  if (count) {
    changes += count;
    console.log(`[fortune-dark-patch] ✓ Patched main cell area: ${count} bg`);
  }
}

// ─── 5. Patch remaining standalone renderCtx.fillStyle colors ───
{
  // Remaining #ffffff fill styles
  const remainingWhite = /(renderCtx\.fillStyle\s*=\s*)"#ffffff"/g;
  const count = (src.match(remainingWhite) || []).length;
  src = src.replace(remainingWhite, '$1"#18181b"');
  if (count) {
    changes += count;
    console.log(`[fortune-dark-patch] ✓ Patched remaining #ffffff fill styles: ${count}`);
  }
  
  // Remaining #000000 fill styles
  const remainingBlack = /(renderCtx\.fillStyle\s*=\s*)"#000000"/g;
  const countB = (src.match(remainingBlack) || []).length;
  src = src.replace(remainingBlack, '$1"#fafafa"');
  if (countB) {
    changes += countB;
    console.log(`[fortune-dark-patch] ✓ Patched remaining #000000 fill styles: ${countB}`);
  }
}

// ─── 6. Patch font color defaults ───
{
  // fc: "#000000" → "#fafafa" (font color default)
  const fcCount = (src.match(/fc:\s*"#000000"/g) || []).length;
  src = src.replace(/fc:\s*"#000000"/g, 'fc: "#fafafa"');
  if (fcCount) { changes += fcCount; console.log(`[fortune-dark-patch] ✓ Patched fc defaults: ${fcCount}`); }
  
  // fontColor = "#000000"
  const fc2Count = (src.match(/fontColor\s*=\s*"#000000"/g) || []).length;
  src = src.replace(/fontColor\s*=\s*"#000000"/g, 'fontColor = "#fafafa"');
  if (fc2Count) { changes += fc2Count; console.log(`[fortune-dark-patch] ✓ Patched fontColor defaults: ${fc2Count}`); }
  
  // value || (value = "#000000")
  const fc3Count = (src.match(/(value\s*\|\|\s*\(\s*value\s*=\s*)"#000000"/g) || []).length;
  src = src.replace(/(value\s*\|\|\s*\(\s*value\s*=\s*)"#000000"/g, '$1"#fafafa"');
  if (fc3Count) { changes += fc3Count; console.log(`[fortune-dark-patch] ✓ Patched value defaults: ${fc3Count}`); }
  
  // color: "#000000" in objects
  const fc4Count = (src.match(/(color:\s*)"#000000"/g) || []).length;
  src = src.replace(/(color:\s*)"#000000"/g, '$1"#fafafa"');
  if (fc4Count) { changes += fc4Count; console.log(`[fortune-dark-patch] ✓ Patched color properties: ${fc4Count}`); }
  
  // fillStyle: "#000000" in objects  
  const fc5Count = (src.match(/(fillStyle:\s*)"#000000"/g) || []).length;
  src = src.replace(/(fillStyle:\s*)"#000000"/g, '$1"#fafafa"');
  if (fc5Count) { changes += fc5Count; console.log(`[fortune-dark-patch] ✓ Patched fillStyle properties: ${fc5Count}`); }
}

// ─── 7. Fix color comparisons (value !== "#000000") → keep semantics ───
{
  const cmpCount = (src.match(/(value\s*!==?\s*)"#000000"/g) || []).length;
  src = src.replace(/(value\s*!==?\s*)"#000000"/g, '$1"#fafafa"');
  if (cmpCount) { changes += cmpCount; console.log(`[fortune-dark-patch] ✓ Patched color comparisons: ${cmpCount}`); }
}

// ─── 8. Thicken grid lines ───
{
  // lineWidth = 1 followed by strokeStyle = defaultStyle.strokeStyle
  const gridCount = (src.match(/(lineWidth\s*=\s*)1(\s*;[\s\S]{0,100}?strokeStyle\s*=\s*defaultStyle\.strokeStyle)/g) || []).length;
  src = src.replace(/(lineWidth\s*=\s*)1(\s*;[\s\S]{0,100}?strokeStyle\s*=\s*defaultStyle\.strokeStyle)/g, '$11.5$2');
  if (gridCount) { changes += gridCount; console.log(`[fortune-dark-patch] ✓ Thickened grid lines: ${gridCount}`); }
  
  // Also: lineWidth = 1; then later strokeStyle = defaultStyle.strokeStyle (multiline)
  const gridCount2 = (src.match(/(lineWidth\s*=\s*)1(\s*;\s*\n\s*renderCtx\.strokeStyle\s*=\s*defaultStyle\.strokeStyle)/g) || []).length;
  src = src.replace(/(lineWidth\s*=\s*)1(\s*;\s*\n\s*renderCtx\.strokeStyle\s*=\s*defaultStyle\.strokeStyle)/g, '$11.5$2');
  if (gridCount2) { changes += gridCount2; console.log(`[fortune-dark-patch] ✓ Thickened grid lines (alt): ${gridCount2}`); }
}

// ─── Write ───
if (changes > 0) {
  fs.writeFileSync(TARGET, src, 'utf-8');
  console.log(`[fortune-dark-patch] ✅ Done. ${changes} replacements made.`);
} else {
  console.log('[fortune-dark-patch] ⚠ No changes made. Already patched?');
}
