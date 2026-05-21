const fs = require('fs');

const files = ['CatalogPage.tsx', 'PosPage.tsx', 'SuppliersPage.tsx'];

files.forEach(f => {
  const content = fs.readFileSync('./src/pages/' + f, 'utf8');
  const lines = content.split('\n');
  const untranslated = [];
  
  lines.forEach((line, i) => {
    // skip console.log
    if (line.includes('console.log') || line.includes('console.error')) return;
    
    // matches >Text< where Text has letters but no curly braces
    const match1 = line.match(/>([^<{}]+)</);
    if (match1 && match1[1].trim().length > 1 && /[A-Za-z]/.test(match1[1])) {
      untranslated.push((i + 1) + ': ' + line.trim());
      return;
    }
    
    // matches placeholder="Text" where Text has no curly braces
    const match2 = line.match(/placeholder=["']([^"'{]+)["']/);
    if (match2 && match2[1].trim().length > 1 && /[A-Za-z]/.test(match2[1])) {
      untranslated.push((i + 1) + ': ' + line.trim());
    }
  });
  
  if (untranslated.length) {
    console.log('--- ' + f + ' ---');
    console.log(untranslated.join('\n'));
  }
});
