import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import '../draft-comment.js';

function makePage(openResult = { kind: 'ok', x: 12, y: 34 }, verifyResult = { kind: 'ok', currentUrl: 'https://www.reddit.com/comments/1abc23/' }) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn()
            .mockResolvedValueOnce(openResult)
            .mockResolvedValueOnce(verifyResult),
        nativeClick: vi.fn().mockResolvedValue(undefined),
        insertText: vi.fn().mockResolvedValue(undefined),
    };
}

describe('reddit draft-comment command', () => {
    const command = getRegistry().get('reddit/draft-comment');

    it('keeps each draft in a fresh persistent Reddit tab', () => {
        expect(command.browser).toBe(true);
        expect(command.access).toBe('write');
        expect(command.siteSession).toBe('persistent');
        expect(command.freshPage).toBe(true);
        expect(command.example).toContain('--window foreground');
    });

    it('rejects invalid post ids and blank text before navigation', async () => {
        const page = makePage();

        await expect(command.func(page, { 'post-id': 't1_notpost', text: 'hello' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(page, { 'post-id': '1abc23', text: '   ' })).rejects.toBeInstanceOf(ArgumentError);

        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
        expect(page.nativeClick).not.toHaveBeenCalled();
        expect(page.insertText).not.toHaveBeenCalled();
    });

    it('opens the post composer and inserts text without submitting', async () => {
        const page = makePage();

        const rows = await command.func(page, { 'post-id': 'https://www.reddit.com/r/webcmd/comments/1abc23/title/', text: 'draft only' });

        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com/comments/1abc23/');
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.nativeClick).toHaveBeenCalledWith(12, 34);
        expect(page.insertText).toHaveBeenCalledWith('draft only');
        expect(page.evaluate.mock.calls[0][0]).toContain('Join the conversation');
        expect(page.evaluate.mock.calls[0][0]).not.toContain('/api/comment');
        expect(rows).toEqual([{
            status: 'drafted',
            message: 'Draft comment inserted; review the visible Reddit tab and click Comment when ready.',
            url: 'https://www.reddit.com/comments/1abc23/',
        }]);
    });

    it('surfaces missing composer and failed verification as command errors', async () => {
        await expect(command.func(makePage({ kind: 'missing', detail: 'No visible composer' }), { 'post-id': '1abc23', text: 'hello' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ kind: 'ok' }, { kind: 'missing', detail: 'Draft not present' }), { 'post-id': '1abc23', text: 'hello' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});
