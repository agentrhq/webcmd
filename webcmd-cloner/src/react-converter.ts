import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

export interface ReactConversionResult {
  outputDir: string;
  components: string[];
  entryFile: string;
}

function convertHtmlToJsx(html: string): string {
  let jsx = html
    .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML comments
    .replace(/\bclass="/g, 'className="')
    .replace(/\bfor="/g, 'htmlFor="')
    .replace(/\btabindex="/g, 'tabIndex="')
    .replace(/\bautocomplete="/g, 'autoComplete="')
    .replace(/\bautofocus="/g, 'autoFocus="')
    .replace(/\breadonly="/g, 'readOnly="')
    .replace(/\bcolspan="/g, 'colSpan="')
    .replace(/\browspan="/g, 'rowSpan="')
    .replace(/\bsvg:([a-zA-Z-]+)/g, '$1')
    .replace(/style="([^"]*)"/g, (match, styleContent) => {
      // Convert style="color: red; margin-top: 10px;" to style={{ color: 'red', marginTop: '10px' }}
      const styles = styleContent.split(';').filter((s: string) => s.trim().length > 0);
      const styleProps = styles.map((s: string) => {
        const [k, v] = s.split(':');
        if (!k || !v) return '';
        const camelK = k.trim().replace(/-([a-z])/g, (g: string) => g[1].toUpperCase());
        return `${camelK}: '${v.trim().replace(/'/g, "\\'")}'`;
      }).filter(Boolean);
      return `style={{ ${styleProps.join(', ')} }}`;
    });

  // Self close void elements: <img ...>, <input ...>, <br>, <hr>, <link ...>, <meta ...>, <source ...>
  const voidTags = ['img', 'input', 'br', 'hr', 'link', 'meta', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'];
  for (const tag of voidTags) {
    const regex = new RegExp(`<(${tag})\\b([^>]*?)(?<!/)>`, 'gi');
    jsx = jsx.replace(regex, '<$1$2 />');
  }

  return jsx;
}

export async function convertCloneToReact(cloneDir: string): Promise<ReactConversionResult> {
  const indexHtmlPath = path.join(cloneDir, 'index.html');
  const rawHtml = await fs.readFile(indexHtmlPath, 'utf-8');

  const dom = new JSDOM(rawHtml);
  const document = dom.window.document;

  const reactDir = path.join(cloneDir, 'react');
  const componentsDir = path.join(reactDir, 'src', 'components');
  await fs.mkdir(componentsDir, { recursive: true });

  const components: string[] = [];

  // 1. Extract Navigation / Header
  const headerEl = document.querySelector('header') || document.querySelector('nav') || document.querySelector('[role="banner"]');
  let headerJsx = '';
  if (headerEl) {
    headerJsx = convertHtmlToJsx(headerEl.outerHTML);
    await fs.writeFile(
      path.join(componentsDir, 'Navbar.tsx'),
      `import React from 'react';\n\nexport const Navbar: React.FC = () => {\n  return (\n    ${headerJsx}\n  );\n};\nexport default Navbar;\n`
    );
    components.push('Navbar.tsx');
  }

  // 2. Extract Main Content / Sections
  const mainEl = document.querySelector('main') || document.body;
  const sections = Array.from(mainEl.querySelectorAll('section, article, [role="main"], #bigbox, .hero, .container'));
  
  if (sections.length > 0) {
    let secIdx = 1;
    for (const sec of sections.slice(0, 4)) {
      const secName = `Section${secIdx}`;
      const secJsx = convertHtmlToJsx(sec.outerHTML);
      await fs.writeFile(
        path.join(componentsDir, `${secName}.tsx`),
        `import React from 'react';\n\nexport const ${secName}: React.FC = () => {\n  return (\n    ${secJsx}\n  );\n};\nexport default ${secName};\n`
      );
      components.push(`${secName}.tsx`);
      secIdx++;
    }
  }

  // 3. Extract Footer
  const footerEl = document.querySelector('footer') || document.querySelector('[role="contentinfo"]');
  let footerJsx = '';
  if (footerEl) {
    footerJsx = convertHtmlToJsx(footerEl.outerHTML);
    await fs.writeFile(
      path.join(componentsDir, 'Footer.tsx'),
      `import React from 'react';\n\nexport const Footer: React.FC = () => {\n  return (\n    ${footerJsx}\n  );\n};\nexport default Footer;\n`
    );
    components.push('Footer.tsx');
  }

  // 4. Generate App.tsx
  const imports = components.map(c => {
    const name = c.replace('.tsx', '');
    return `import { ${name} } from './components/${name}';`;
  }).join('\n');

  const renderedComponents = components.map(c => {
    const name = c.replace('.tsx', '');
    return `      <${name} />`;
  }).join('\n');

  const appTsx = `import React from 'react';
${imports}

export function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 antialiased font-sans selection:bg-cyan-500 selection:text-black">
${renderedComponents || '      <main className="p-8"><h1 className="text-3xl font-bold">Cloned Website</h1></main>'}
    </div>
  );
}

export default App;
`;
  await fs.writeFile(path.join(reactDir, 'src', 'App.tsx'), appTsx);

  // 5. Generate package.json & vite config
  const packageJson = {
    name: "cloned-react-app",
    private: true,
    version: "1.0.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "tsc && vite build",
      preview: "vite preview"
    },
    dependencies: {
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      "lucide-react": "^1.0.0"
    },
    devDependencies: {
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.3.0",
      autoprefixer: "^10.4.20",
      postcss: "^8.4.49",
      tailwindcss: "^3.4.17",
      typescript: "^5.7.0",
      vite: "^6.0.0"
    }
  };
  await fs.writeFile(path.join(reactDir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // 6. Generate Tailwind Config & index.css
  const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`;
  await fs.writeFile(path.join(reactDir, 'tailwind.config.js'), tailwindConfig);

  const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
  await fs.writeFile(path.join(reactDir, 'src', 'index.css'), indexCss);

  const mainTsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
  await fs.writeFile(path.join(reactDir, 'src', 'main.tsx'), mainTsx);

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cloned React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
  await fs.writeFile(path.join(reactDir, 'index.html'), indexHtml);

  return {
    outputDir: reactDir,
    components,
    entryFile: path.join(reactDir, 'src', 'App.tsx'),
  };
}
