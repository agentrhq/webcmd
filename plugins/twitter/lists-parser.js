export function extractListEntry(entry, seen) {
    const list = entry?.content?.itemContent?.list
        || entry?.content?.list
        || entry?.item?.itemContent?.list;
    if (!list) return null;
    const id = list.id_str || list.id || '';
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const mode = typeof list.mode === 'string' && /private/i.test(list.mode) ? 'private' : 'public';
    return {
        id: String(id),
        name: list.name || '',
        members: String(list.member_count ?? 0),
        followers: String(list.subscriber_count ?? 0),
        mode,
    };
}

const OWNED_SUBSCRIBED_ENTRY_PREFIX = 'owned-subscribed-list-module-';

export function isOwnedSubscribedEntry(entry) {
    return typeof entry?.entryId === 'string'
        && entry.entryId.startsWith(OWNED_SUBSCRIBED_ENTRY_PREFIX);
}

export function getListsManagementInstructions(data) {
    const instructions = data?.data?.viewer?.list_management_timeline?.timeline?.instructions
        || data?.data?.viewer_v2?.user_results?.result?.list_management_timeline?.timeline?.instructions
        || data?.data?.list_management_timeline?.timeline?.instructions
        || data?.data?.data?.viewer?.list_management_timeline?.timeline?.instructions
        || data?.data?.data?.viewer_v2?.user_results?.result?.list_management_timeline?.timeline?.instructions
        || data?.data?.data?.list_management_timeline?.timeline?.instructions;
    return Array.isArray(instructions) ? instructions : null;
}

export function parseListsManagement(data, seen) {
    const lists = [];
    const instructions = getListsManagementInstructions(data) || [];
    for (const inst of instructions) {
        for (const entry of inst.entries || []) {
            if (!isOwnedSubscribedEntry(entry)) continue;
            const direct = extractListEntry(entry, seen);
            if (direct) {
                lists.push(direct);
                continue;
            }
            for (const item of entry?.content?.items || []) {
                const nested = extractListEntry(item, seen);
                if (nested) lists.push(nested);
            }
        }
    }
    return lists;
}
