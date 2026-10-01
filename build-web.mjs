import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const base = readFileSync('src/sticky-base.html', 'utf8');
const join = readFileSync('src/tauri-window.js', 'utf8');
const i = base.lastIndexOf('</script>');
if (i < 0) { console.error('no script close'); process.exit(1); }
const out = base.slice(0, i) + '\n' + join + '\n' + base.slice(i);
mkdirSync('dist-web', { recursive: true });
writeFileSync('dist-web/index.html', out);
console.log('dist-web/index.html built:', out.length, 'bytes | joined at last script ✓');
