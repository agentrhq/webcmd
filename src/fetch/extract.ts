import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { articleHtmlToMarkdown } from '../download/article-download.js';
import { CliError } from '../errors.js';
import { DEFAULT_FALLBACK_SELECTORS } from '../browser/article-extract.js';

export interface ExtractFetchedContentInput {
  body: string;
  contentType: string;
  url: string;
}

export interface ExtractFetchedContentResult {
  title: string;
  content: string;
  source: 'readability' | 'fallback' | 'raw';
}

function absolutize(root: ParentNode, url: string): void {
  for (const attr of ['href', 'src', 'poster', 'action']) {
    for (const node of root.querySelectorAll(`[${attr}]`)) {
      const value = node.getAttribute(attr);
      if (!value || /^(?:data:|javascript:|#)/i.test(value)) continue;
      try { node.setAttribute(attr, new URL(value, url).href); } catch { /* keep malformed URLs */ }
    }
  }
}

export function extractFetchedContent(input: ExtractFetchedContentInput): ExtractFetchedContentResult {
  const contentType = input.contentType.toLowerCase().split(';', 1)[0]!.trim();
  if (/^(text\/(plain|markdown)|application\/(json|xml)|text\/xml)$/.test(contentType) || /\+(json|xml)$/.test(contentType)) {
    return { title: '', content: input.body, source: 'raw' };
  }
  if (!['text/html', 'application/xhtml+xml', ''].includes(contentType)) {
    throw new CliError(
      'FETCH_UNSUPPORTED_CONTENT_TYPE',
      `Unsupported content type: ${contentType || 'unknown'}`,
      'Use webcmd web fetch-browser to export this page from a real browser.',
    );
  }

  const dom = new JSDOM(input.body, { url: input.url });
  const document = dom.window.document;
  let title = document.title || '';
  let contentHtml = '';
  let source: ExtractFetchedContentResult['source'] = 'fallback';
  try {
    const article = new Readability(document.cloneNode(true) as Document).parse();
    if (article?.content) {
      title = article.title || title;
      contentHtml = article.content;
      source = 'readability';
    }
  } catch { /* fall through to structural extraction */ }
  if (!contentHtml) {
    const root = DEFAULT_FALLBACK_SELECTORS.map(selector => {
      try { return document.querySelector(selector); } catch { return null; }
    }).find((node): node is Element => !!node) ?? document.body;
    contentHtml = root?.outerHTML ?? '';
  }
  const fragment = new JSDOM(`<body>${contentHtml}</body>`, { url: input.url }).window.document;
  absolutize(fragment, input.url);
  return { title, content: articleHtmlToMarkdown(fragment.body.innerHTML), source };
}
