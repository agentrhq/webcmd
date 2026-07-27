import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('normalizes YC company slugs and URLs', async () => {
    const { __test__ } = await import('./company.js');
    assert.equal(
        __test__.normalizeCompanyUrl('fenrock-ai'),
        'https://www.ycombinator.com/companies/fenrock-ai',
    );
    assert.equal(
        __test__.normalizeCompanyUrl('https://www.ycombinator.com/companies/fenrock-ai'),
        'https://www.ycombinator.com/companies/fenrock-ai',
    );
    assert.throws(() => __test__.normalizeCompanyUrl('https://example.com/companies/fenrock-ai'));
});

test('extracts one company row from YC page state', async () => {
    const { __test__ } = await import('./company.js');
    const dom = new JSDOM('<div id="ycdc_new/pages/Companies/ShowPage-react-component-test"></div>');
    dom.window.document.querySelector('div').setAttribute('data-page', JSON.stringify({
        props: {
            company: {
                slug: 'fenrock-ai',
                name: 'Fenrock AI',
                long_description: 'We build AI agents for banks.',
                batch_name: 'Winter 2026',
                ycdc_status: 'Active',
                location: 'San Francisco',
                year_founded: 2026,
                team_size: 2,
                website: 'https://fenrock.ai/',
                founders: [{ full_name: 'Charu Sharma' }, { full_name: 'Michael M' }],
            },
            jobPostings: [{}, {}],
        },
    }));

    assert.deepEqual(__test__.extractCompanyFromDocument(dom.window.document).row, {
        name: 'Fenrock AI',
        description: 'We build AI agents for banks.',
        batch: 'Winter 2026',
        status: 'Active',
        location: 'San Francisco',
        founded: 2026,
        teamSize: 2,
        website: 'https://fenrock.ai/',
        founders: 'Charu Sharma, Michael M',
        jobCount: 2,
        url: 'https://www.ycombinator.com/companies/fenrock-ai',
    });
});
