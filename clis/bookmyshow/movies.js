// bookmyshow movies — list currently showing movies in a city.
//
// Uses the movie-listing factory with the `now-showing-movies` endpoint.
// Includes rating and votes columns on top of the base listing.
import { cli } from '@agentrhq/webcmd/registry';
import { makeMovieListingCommand } from './utils.js';

cli(makeMovieListingCommand({
    name: 'movies',
    description: 'List currently showing movies in a city on BookMyShow',
    pageSlug: 'movies',
}));
