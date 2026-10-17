import { createServer } from 'node:http';
import { createYoga, createSchema } from 'graphql-yoga';
import { characters, locations, episodes } from './data.js';

const PAGE_SIZE = 10;

function paginate(items, page = 1) {
  const total = items.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const end   = start + PAGE_SIZE;
  return {
    info: {
      count: total,
      pages,
      next: page < pages ? page + 1 : null,
      prev: page > 1     ? page - 1 : null,
    },
    results: items.slice(start, end),
  };
}

const typeDefs = /* GraphQL */ `
  type Query {
    character(id: ID!): Character
    characters(page: Int, filter: FilterCharacter): Characters
    location(id: ID!):   Location
    locations(page: Int): Locations
    episode(id: ID!):    Episode
    episodes(page: Int, filter: FilterEpisode): Episodes
  }

  input FilterCharacter {
    name:    String
    status:  String
    species: String
    type:    String
    gender:  String
  }

  input FilterEpisode {
    name:    String
    episode: String
  }

  type Characters { info: Info  results: [Character] }
  type Locations  { info: Info  results: [Location]  }
  type Episodes   { info: Info  results: [Episode]   }

  type Info {
    count: Int
    pages: Int
    next:  Int
    prev:  Int
  }

  type Character {
    id:       ID
    name:     String
    status:   String
    species:  String
    type:     String
    gender:   String
    origin:   Location
    location: Location
  }

  type Location {
    id:        ID
    name:      String
    type:      String
    dimension: String
    residents: [Character]
  }

  type Episode {
    id:         ID
    name:       String
    air_date:   String
    episode:    String
    characters: [Character]
  }
`;

function findChar(id)     { return characters.find(c => c.id === String(id)) || null; }
function findLocation(id) { return locations.find(l => l.id === String(id)) || null; }

/**
 * Query arguments, matching the FilterCharacter and FilterEpisode inputs in the schema.
 * @typedef {{ name?: string, status?: string, species?: string, gender?: string }} CharacterFilter
 * @typedef {{ name?: string, episode?: string }} EpisodeFilter
 * @typedef {{ page?: number, filter?: CharacterFilter }} CharactersArgs
 * @typedef {{ page?: number, filter?: EpisodeFilter }} EpisodesArgs
 */

const resolvers = {
  Query: {
    character: (_root, { id }) => findChar(id),

    characters: (_root, /** @type {CharactersArgs} */ { page = 1, filter = {} }) => {
      let list = [...characters];
      if (filter.name)    list = list.filter(c => c.name.toLowerCase().includes(filter.name.toLowerCase()));
      if (filter.status)  list = list.filter(c => c.status  === filter.status);
      if (filter.species) list = list.filter(c => c.species.toLowerCase().includes(filter.species.toLowerCase()));
      if (filter.gender)  list = list.filter(c => c.gender  === filter.gender);
      if (list.length === 0) return { info: { count: 0, pages: 0, next: null, prev: null }, results: [] };
      return paginate(list, page);
    },

    location: (_root, { id }) => findLocation(id),

    locations: (_root, { page = 1 }) => paginate(locations, page),

    episode: (_root, { id }) => episodes.find(e => e.id === String(id)) || null,

    episodes: (_root, /** @type {EpisodesArgs} */ { page = 1, filter = {} }) => {
      let list = [...episodes];
      if (filter.name)    list = list.filter(e => e.name.toLowerCase().includes(filter.name.toLowerCase()));
      if (filter.episode) list = list.filter(e => e.episode === filter.episode);
      return paginate(list, page);
    },
  },

  Character: {
    origin:   (char) => char.originId   ? findLocation(char.originId)   : null,
    location: (char) => char.locationId ? findLocation(char.locationId) : null,
  },

  Location: {
    residents: (loc) => (loc.residentIds || []).map(findChar).filter(Boolean),
  },

  Episode: {
    characters: (ep) => (ep.characterIds || []).map(findChar).filter(Boolean),
  },
};

const yoga = createYoga({ schema: createSchema({ typeDefs, resolvers }) });
const server = createServer(yoga);

const PORT = process.env.GQL_PORT || 4001;
server.listen(PORT, () => {
  console.log(`GraphQL mock server running at http://localhost:${PORT}/graphql`);
});
