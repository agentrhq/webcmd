import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockListNotebooklmNotesFromPage, mockReadNotebooklmVisibleNoteFromPage, mockGetNotebooklmPageState, mockRequireNotebooklmSession, } = vi.hoisted(() => ({
    mockListNotebooklmNotesFromPage: vi.fn(),
    mockReadNotebooklmVisibleNoteFromPage: vi.fn(),
    mockGetNotebooklmPageState: vi.fn(),
    mockRequireNotebooklmSession: vi.fn(),
}));
vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        listNotebooklmNotesFromPage: mockListNotebooklmNotesFromPage,
        readNotebooklmVisibleNoteFromPage: mockReadNotebooklmVisibleNoteFromPage,
        getNotebooklmPageState: mockGetNotebooklmPageState,
        requireNotebooklmSession: mockRequireNotebooklmSession,
    };
});
import { getRegistry } from '@agentrhq/webcmd/registry';
import './notes-get.js';
describe('notebooklm notes-get', () => {
    const command = getRegistry().get('notebooklm/notes-get');
    beforeEach(() => {
        mockListNotebooklmNotesFromPage.mockReset();
        mockReadNotebooklmVisibleNoteFromPage.mockReset();
        mockGetNotebooklmPageState.mockReset();
        mockRequireNotebooklmSession.mockReset();
        mockRequireNotebooklmSession.mockResolvedValue(undefined);
        mockGetNotebooklmPageState.mockResolvedValue({
            url: 'https://notebooklm.google.com/notebook/nb-demo',
            title: 'Browser Automation',
            hostname: 'notebooklm.google.com',
            kind: 'notebook',
            notebookId: 'nb-demo',
            loginRequired: false,
            notebookCount: 1,
        });
    });
    it('returns the currently visible note editor content when the title matches', async () => {
        mockReadNotebooklmVisibleNoteFromPage.mockResolvedValue({
            notebook_id: 'nb-demo',
            title: 'New note',
            content: 'First paragraph\\nSecond paragraph',
            url: 'https://notebooklm.google.com/notebook/nb-demo',
            source: 'studio-editor',
        });
        const result = await command.func({}, { note: 'New note' });
        expect(result).toEqual([
            {
                notebook_id: 'nb-demo',
                title: 'New note',
                content: 'First paragraph\\nSecond paragraph',
                url: 'https://notebooklm.google.com/notebook/nb-demo',
                source: 'studio-editor',
            },
        ]);
    });
    it('explains the current visible-note limitation when the target note is listed but not open', async () => {
        mockReadNotebooklmVisibleNoteFromPage.mockResolvedValue(null);
        mockListNotebooklmNotesFromPage.mockResolvedValue([
            {
                notebook_id: 'nb-demo',
                title: 'New note',
                created_at: '6 minutes ago',
                url: 'https://notebooklm.google.com/notebook/nb-demo',
                source: 'studio-list',
            },
        ]);
        await expect(command.func({}, { note: 'New note' })).rejects.toMatchObject({
            hint: expect.stringMatching(/currently reads note content only from the visible note editor/i),
        });
    });
});
