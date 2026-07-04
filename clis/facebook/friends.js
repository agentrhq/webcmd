import { cli } from '@agentrhq/webcmd/registry';
cli({
    site: 'facebook',
    name: 'friends',
    access: 'read',
    description: 'Get Facebook friend suggestions',
    domain: 'www.facebook.com',
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of friend suggestions' },
    ],
    columns: ['index', 'name', 'mutual'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/friends', settleMs: 3000 } },
        { evaluate: `(() => {
  const limit = \${{ args.limit }};
  const items = document.querySelectorAll('[role="listitem"]');
  return Array.from(items)
    .slice(0, limit)
    .map((el, i) => {
      const text = el.textContent.trim().replace(/\\s+/g, ' ');
      // Extract mutual info if present (before name extraction to avoid pollution)
      const mutualMatch = text.match(/([\\d,]+)\\s*people.*(?:Follow|mutual|mutual)/);
      // Extract name: remove mutual info, action buttons, etc.
      let name = text
        .replace(/[\\d,]+\\s*people.*(?:followed|mutual friends|mutual friends?)/, '')
        .replace(/Add friend.*/, '').replace(/Add [Ff]riend.*/, '')
        .replace(/Remove$/, '').replace(/Remove$/, '')
        .trim();
      return {
        index: i + 1,
        name: name.substring(0, 50),
        mutual: mutualMatch ? mutualMatch[1] : '-',
      };
    })
    .filter(item => item.name.length > 0);
})()
` },
    ],
});
