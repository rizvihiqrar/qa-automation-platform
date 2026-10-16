/**
 * Consumer contract tests — defines what our frontend app expects from the Users API.
 * Running these tests generates a pact file in ./pacts/ that the provider must honour.
 */

const { PactV3, MatchersV3 } = require('@pact-foundation/pact');
const { like, eachLike, integer, string } = MatchersV3;
const fetch = require('node-fetch');
const path = require('path');

const provider = new PactV3({
  consumer: 'FrontendApp',
  provider: 'UsersAPI',
  dir: path.resolve(__dirname, '..', 'pacts'),
  logLevel: 'warn',
});

describe('Users API — Consumer contracts', () => {

  describe('GET /users', () => {
    it('returns a paginated list of users', () => {
      return provider
        .addInteraction({
          states: [{ description: 'users exist' }],
          uponReceiving: 'a request for a paginated user list',
          withRequest: {
            method: 'GET',
            path: '/users',
            query: { limit: '10', skip: '0' },
            headers: { Accept: 'application/json' },
          },
          willRespondWith: {
            status: 200,
            headers: { 'Content-Type': like('application/json') },
            body: {
              users: eachLike({
                id:        integer(1),
                firstName: string('Emily'),
                lastName:  string('Johnson'),
                email:     string('emily.johnson@example.com'),
              }),
              total: integer(100),
              skip:  integer(0),
              limit: integer(10),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const res  = await fetch(`${mockServer.url}/users?limit=10&skip=0`, {
            headers: { Accept: 'application/json' },
          });
          const body = await res.json();

          expect(res.status).toBe(200);
          expect(Array.isArray(body.users)).toBe(true);
          expect(body.users[0]).toHaveProperty('id');
          expect(body.users[0]).toHaveProperty('firstName');
          expect(body.users[0]).toHaveProperty('email');
          expect(body).toHaveProperty('total');
        });
    });
  });

  describe('GET /users/:id', () => {
    it('returns a single user by id', () => {
      return provider
        .addInteraction({
          states: [{ description: 'user with id 1 exists' }],
          uponReceiving: 'a request for user with id 1',
          withRequest: {
            method: 'GET',
            path: '/users/1',
            headers: { Accept: 'application/json' },
          },
          willRespondWith: {
            status: 200,
            headers: { 'Content-Type': like('application/json') },
            body: {
              id:        integer(1),
              firstName: string('Emily'),
              lastName:  string('Johnson'),
              email:     string('emily.johnson@example.com'),
            },
          },
        })
        .executeTest(async (mockServer) => {
          const res  = await fetch(`${mockServer.url}/users/1`, {
            headers: { Accept: 'application/json' },
          });
          const body = await res.json();

          expect(res.status).toBe(200);
          expect(body.id).toBe(1);
          expect(body).toHaveProperty('firstName');
          expect(body).toHaveProperty('email');
        });
    });

    it('returns 404 for a non-existent user', () => {
      return provider
        .addInteraction({
          states: [{ description: 'user with id 9999 does not exist' }],
          uponReceiving: 'a request for a non-existent user',
          withRequest: {
            method: 'GET',
            path: '/users/9999',
            headers: { Accept: 'application/json' },
          },
          willRespondWith: {
            status: 404,
            headers: { 'Content-Type': like('application/json') },
            body: { message: string('User with id 9999 not found') },
          },
        })
        .executeTest(async (mockServer) => {
          const res  = await fetch(`${mockServer.url}/users/9999`, {
            headers: { Accept: 'application/json' },
          });
          const body = await res.json();

          expect(res.status).toBe(404);
          expect(body).toHaveProperty('message');
        });
    });
  });

});
