const axios = require('axios');

const SERPER_URL = 'https://google.serper.dev/search';

/**
 * Search for blog articles related to a book concept.
 * Returns an array of article objects with title, link, snippet, source.
 */
async function findBlogArticles({ bookTitle, author, conceptQuery, ideasContext = [], count = 6 }) {
  let query;
  if (conceptQuery) {
    // Caller supplied a specific concept — search for it in context of the book
    query = `"${conceptQuery}" ${bookTitle} deep dive analysis`;
  } else if (ideasContext.length > 0) {
    // Build a niche query from distilled idea titles and their top tag
    const topConcepts = ideasContext
      .slice(0, 3)
      .map(i => {
        const tag = (i.tags || [])[0];
        return tag ? `${i.title} ${tag}` : i.title;
      })
      .join(' OR ');
    query = `(${topConcepts}) "${bookTitle}" blog essay analysis`;
  } else {
    query = `"${bookTitle}" ${author} key ideas analysis blog`;
  }

  const response = await axios.post(
    SERPER_URL,
    {
      q: query,
      num: count + 2, // Fetch a few extra, filter below
      gl: 'us',
      hl: 'en'
    },
    {
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );

  const organic = response.data.organic || [];

  // Filter out retail, reference, and video sites — want substantive blog/essay content
  const blocked = ['amazon.com', 'goodreads.com', 'wikipedia.org', 'youtube.com',
                   'reddit.com', 'quora.com', 'twitter.com', 'x.com'];
  const filtered = organic.filter(r => !blocked.some(b => r.link.includes(b)));

  return filtered.slice(0, count).map(r => ({
    title:   r.title,
    url:     r.link,
    snippet: r.snippet,
    domain:  new URL(r.link).hostname.replace('www.', ''),
    favicon: `https://www.google.com/s2/favicons?domain=${r.link}&sz=32`
  }));
}

module.exports = { findBlogArticles };
