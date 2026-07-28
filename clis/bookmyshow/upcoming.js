// bookmyshow upcoming — list upcoming movies in a city.
//
// Uses the movie-listing factory with the `upcoming-movies` endpoint.
// No extra columns beyond the base listing.
import { cli } from '@agentrhq/webcmd/registry';
import { makeMovieListingCommand } from './utils.js';

cli(makeMovieListingCommand({
    name: 'upcoming',
    description: 'List upcoming movies in a city on BookMyShow',
    pageSlug: 'upcoming-movies',
}));
