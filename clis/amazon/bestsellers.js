import { cli } from '@agentrhq/webcmd/registry';
import { createRankingCliOptions } from './rankings.js';
cli(createRankingCliOptions({
    commandName: 'bestsellers',
    access: 'read',
    listType: 'bestsellers',
    description: 'Amazon Best Sellers pages for category candidate discovery',
}));
