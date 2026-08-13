import { cli } from '@agentrhq/webcmd/registry';
cli({
    site: 'facebook',
    name: 'add-friend',
    access: 'write',
    description: 'Send a friend request on Facebook',
    domain: 'www.facebook.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Facebook username or profile URL',
        },
    ],
    columns: ['status', 'username'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/${{ args.username }}', settleMs: 3000 } },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  // Find "Add Friend" button
  const buttons = Array.from(document.querySelectorAll('[role="button"]'));
  const addBtn = buttons.find(b => {
    const text = b.textContent.trim();
    return text === 'Add friend' || text === 'Add Friend' || text === 'Add friend';
  });

  if (!addBtn) {
    // Check if already friends
    const isFriend = buttons.some(b => {
      const t = b.textContent.trim();
      return t === 'Friends' || t === 'Friends' || t.includes('Pending') || t.includes('Pending');
    });
    if (isFriend) return [{ status: 'Already friends or request pending', username }];
    return [{ status: 'Add Friend button not found', username }];
  }

  addBtn.click();
  await new Promise(r => setTimeout(r, 1500));
  return [{ status: 'Friend request sent', username }];
})()
` },
    ],
});
