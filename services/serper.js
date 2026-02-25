const axios = require('axios');

const SERPER_URL = 'https://google.serper.dev/search';

/**
 * Search for blog articles related to a book concept.
 * Returns an array of article objects with title, link, snippet, source.
 */
async function findBlogArticles({ bookTitle, author, conceptQuery, count = 6 }) {
  const query = conceptQuery
    ? `${conceptQuery} ${bookTitle} insights analysis`
    : `${bookTitle} ${author} key ideas summary analysis blog`;

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

  // Filter out Amazon, Goodreads, Wikipedia — want real blog content
  const blocked = ['amazon.com', 'goodreads.com', 'wikipedia.org', 'youtube.com'];
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
